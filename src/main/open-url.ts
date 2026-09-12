import { app, BrowserWindow } from 'electron'
import type { GameFileContext } from '@shared/types'
import { clearDownloadContext, getDownloadContext, setDownloadContext } from './download-context'
import { appIcon } from './app-icon'
import { isUsableWindow } from './windows'

type GuestInfo = {
  /** Guest window that spawned this one, so a download can dismiss the whole chain. */
  opener: BrowserWindow | null
  downloadStarted: boolean
}

const guests = new Map<BrowserWindow, GuestInfo>()
let primary: BrowserWindow | null = null
let mainContentsId: number | null = null

const CLOSE_AFTER_DOWNLOAD_MS = 250

function parseHttpUrl(url: string): URL | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed
  } catch {
    return null
  }
}

function isDirectFileUrl(url: URL): boolean {
  return /\.(zip|7z|rar|exe)(\?|$)/i.test(url.pathname)
}

function downloadInContents(
  contents: Electron.WebContents,
  url: string,
  context?: GameFileContext
): void {
  if (contents.isDestroyed()) return
  const next = context ?? getDownloadContext(contents)
  if (next) setDownloadContext(contents.id, next)
  contents.downloadURL(url)
}

function closeGuest(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.hide()
  win.close()
}

function guestForContents(contents?: Electron.WebContents | null): BrowserWindow | null {
  if (!contents || contents.isDestroyed()) return null
  const win = BrowserWindow.fromWebContents(contents)
  if (!win || win.isDestroyed() || !guests.has(win)) return null
  return win
}

function createGuest(show: boolean, opener: BrowserWindow | null): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    show,
    title: 'Browser',
    icon: appIcon,
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const contentsId = win.webContents.id

  win.webContents.on('will-navigate', (event, url) => {
    if (!parseHttpUrl(url)) event.preventDefault()
  })

  win.webContents.on('did-finish-load', () => {
    if (!isUsableWindow(win)) return
    if (guests.get(win)?.downloadStarted) return
    const loaded = win.webContents.getURL()
    if (!loaded || loaded === 'about:blank') return
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
  })

  win.on('page-title-updated', (_event, title) => {
    if (!isUsableWindow(win) || !title.trim()) return
    win.setTitle(title)
  })

  win.on('close', () => {
    clearDownloadContext(contentsId)
  })

  win.on('closed', () => {
    guests.delete(win)
    for (const info of guests.values()) {
      if (info.opener === win) info.opener = null
    }
    if (primary === win) primary = null
  })

  guests.set(win, { opener, downloadStarted: false })
  return win
}

function rootGuest(start: BrowserWindow): BrowserWindow {
  let root = start
  const seen = new Set<BrowserWindow>([root])
  for (;;) {
    const opener = guests.get(root)?.opener
    if (!opener || opener.isDestroyed() || !guests.has(opener) || seen.has(opener)) return root
    root = opener
    seen.add(root)
  }
}

/** Every guest window spawned from the same original link, in any direction. */
function guestTree(start: BrowserWindow): BrowserWindow[] {
  const tree = [rootGuest(start)]
  for (let index = 0; index < tree.length; index += 1) {
    for (const [win, info] of guests) {
      if (info.opener && tree.includes(info.opener) && !tree.includes(win)) tree.push(win)
    }
  }
  if (!tree.includes(start)) tree.push(start)
  return tree
}

function isBlankGuest(win: BrowserWindow): boolean {
  if (!isUsableWindow(win)) return false
  const url = win.webContents.getURL()
  return !url || url === 'about:blank'
}

/**
 * A download is all we wanted from the provider, so dismiss the window that started it
 * plus everything it opened along the way, and any leftover blank popup. Windows are
 * hidden right away and closed once the download item is underway.
 */
export function dismissGuestsAfterDownload(contents?: Electron.WebContents | null): void {
  const source = guestForContents(contents)
  const doomed = source ? guestTree(source) : []
  for (const win of guests.keys()) {
    if (!doomed.includes(win) && isBlankGuest(win)) doomed.push(win)
  }
  if (!doomed.length) return

  for (const win of doomed) {
    const info = guests.get(win)
    if (info) info.downloadStarted = true
    if (!win.isDestroyed() && win.isVisible()) win.hide()
  }

  setTimeout(() => {
    for (const win of doomed) closeGuest(win)
  }, CLOSE_AFTER_DOWNLOAD_MS)
}

export async function openInAppWindow(
  url: string,
  options: {
    reuse?: boolean
    context?: GameFileContext
    show?: boolean
    opener?: BrowserWindow | null
  } = {}
): Promise<void> {
  const parsed = parseHttpUrl(url)
  if (!parsed) {
    throw new Error('Invalid link')
  }

  const reuse = options.reuse !== false
  const show = options.show !== false
  let win = reuse && isUsableWindow(primary) ? primary : null
  if (!win) {
    win = createGuest(show, options.opener ?? null)
    if (reuse || !primary || !isUsableWindow(primary)) primary = win
  }

  if (!isUsableWindow(win)) return
  if (options.context) setDownloadContext(win.webContents.id, options.context)
  else clearDownloadContext(win.webContents.id)

  if (show) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }

  try {
    await win.loadURL(parsed.href)
  } catch {
    // A navigation that turned into a download is dismissed by dismissGuestsAfterDownload.
    if (isUsableWindow(win) && !win.isVisible() && !guests.get(win)?.downloadStarted) {
      closeGuest(win)
    }
    return
  }
}

export function closeAllInAppWindows(): void {
  for (const win of [...guests.keys()]) {
    if (!win.isDestroyed()) win.close()
  }
  guests.clear()
  primary = null
}

export function attachMainWindowGuards(
  mainWindow: BrowserWindow,
  isRendererUrl: (url: string) => boolean
): void {
  mainContentsId = mainWindow.webContents.id
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isRendererUrl(url)) return
    event.preventDefault()
    void openInAppWindow(url).catch(() => undefined)
  })

  mainWindow.on('close', () => {
    closeAllInAppWindows()
  })
}

export function attachGuestWindowOpenHandler(): void {
  app.on('web-contents-created', (_event, contents) => {
    contents.setWindowOpenHandler((details) => {
      if (contents.isDestroyed()) return { action: 'deny' }
      const parsed = parseHttpUrl(details.url)
      if (!parsed) return { action: 'deny' }

      const opener = guestForContents(contents)
      // The opener already handed us a download and is on its way out.
      if (opener && guests.get(opener)?.downloadStarted) return { action: 'deny' }

      const fromAppRenderer = contents.id === mainContentsId
      const context = getDownloadContext(contents)
      if (isDirectFileUrl(parsed)) {
        downloadInContents(contents, parsed.href, context)
        return { action: 'deny' }
      }

      void openInAppWindow(details.url, {
        reuse: fromAppRenderer,
        context,
        show: fromAppRenderer,
        opener
      }).catch(() => undefined)
      return { action: 'deny' }
    })
  })
}
