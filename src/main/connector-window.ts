import { BrowserWindow, screen, session } from 'electron'
import type { GameFileContext } from '@shared/types'
import { registerGuestContents, unregisterGuestContents } from './adblock'
import { appIcon } from './app-icon'
import { clearDownloadContext, setDownloadContext } from './download-context'

const WINDOW_TIMEOUT_MS = 90_000
const POLL_MS = 400
const SCRIPT_TIMEOUT_MS = 5_000
const CAPTCHA_REVEAL_MS = 15_000
const REVEALED_TIMEOUT_MS = 5 * 60_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function keepHidden(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  try {
    win.setOpacity(0)
    win.setBounds({ x: -32000, y: -32000, width: 1024, height: 768 })
    if (win.isVisible()) win.hide()
  } catch {
    // Window can close between the check and these calls.
  }
}

function createHiddenWindow(frame: boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    x: -32000,
    y: -32000,
    show: false,
    frame,
    title: 'Verify download',
    icon: appIcon,
    autoHideMenuBar: true,
    skipTaskbar: true,
    focusable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: '#12141a',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })
  keepHidden(win)
  win.setMenuBarVisibility(false)
  win.webContents.setAudioMuted(true)
  // Locker pages fire ad pops; the global handler would open them as visible guests.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  return win
}

/** Run a page script without hanging when the page navigates mid-call. */
export async function runPageScript<T = unknown>(
  win: BrowserWindow,
  code: string,
  timeoutMs = SCRIPT_TIMEOUT_MS
): Promise<T | null> {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return null
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      win.webContents.executeJavaScript(code) as Promise<T>,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs)
      })
    ])
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export type HiddenWindowResolve = {
  timeoutMs?: number
  pollMs?: number
  onReady?: (win: BrowserWindow) => Promise<void>
  readResult: (win: BrowserWindow) => Promise<string | null>
}

/** Load a locker page off-screen and poll until a direct file URL appears. */
export async function resolveFromHiddenWindow(
  pageUrl: string,
  opts: HiddenWindowResolve
): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? WINDOW_TIMEOUT_MS
  const pollMs = opts.pollMs ?? POLL_MS
  const win = createHiddenWindow(false)
  win.on('ready-to-show', () => keepHidden(win))
  win.on('show', () => keepHidden(win))

  const contentsId = win.webContents.id
  registerGuestContents(contentsId)

  let settled = false
  const closed = new Promise<null>((resolve) => {
    win.on('closed', () => {
      unregisterGuestContents(contentsId)
      if (!settled) resolve(null)
    })
  })

  const finish = (href: string | null): string | null => {
    settled = true
    if (!win.isDestroyed()) win.close()
    return href
  }

  try {
    await win.loadURL(pageUrl)
  } catch {
    // Cloudflare and download navigations abort loadURL; keep polling the window.
  }
  if (win.isDestroyed()) return closed

  if (opts.onReady) {
    try {
      await opts.onReady(win)
    } catch {
      // Page may still be usable.
    }
  }

  const startedAt = Date.now()
  while (!win.isDestroyed() && Date.now() - startedAt < timeoutMs) {
    keepHidden(win)
    const href = await opts.readResult(win)
    if (href) return finish(href)
    await Promise.race([sleep(pollMs), closed])
  }

  return finish(null)
}

/** `captcha` means the page is waiting on a human check; anything else is progress. */
export type PageStep = 'captcha' | 'working'

export type PageDownloadDrive = {
  context?: GameFileContext
  timeoutMs?: number
  pollMs?: number
  /** Advance the page one step (click, submit) and report where it is. */
  step: (win: BrowserWindow) => Promise<PageStep>
}

export type PageDownloadResult = 'started' | 'cancel' | null

function revealForUser(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const { workArea } = screen.getPrimaryDisplay()
  const width = Math.min(1024, workArea.width)
  const height = Math.min(768, workArea.height)
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height
  })
  win.setOpacity(1)
  win.setSkipTaskbar(false)
  win.setFocusable(true)
  win.show()
  win.focus()
}

function hideFromUser(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.setSkipTaskbar(true)
  win.setFocusable(false)
  keepHidden(win)
}

/**
 * Drive a host page off-screen until it starts a browser download, which the
 * session's download handler then tracks like any other. The window is only
 * shown when a human check does not pass on its own, and hides again once the
 * download starts.
 *
 * The window stays open (hidden) until the download finishes: closing the
 * initiator while Chromium is still starting the download crashes the app.
 */
export async function driveHiddenWindowToDownload(
  pageUrl: string,
  opts: PageDownloadDrive
): Promise<PageDownloadResult> {
  const pollMs = opts.pollMs ?? POLL_MS
  const win = createHiddenWindow(true)
  const contents = win.webContents
  const contentsId = contents.id
  registerGuestContents(contentsId)
  if (opts.context) setDownloadContext(contentsId, opts.context)

  let revealed = false
  let started = false
  let closedByUser = false
  const keepOffscreen = (): void => {
    if (!revealed) keepHidden(win)
  }
  win.on('ready-to-show', keepOffscreen)
  win.on('show', keepOffscreen)

  const ses = session.defaultSession
  const onWillDownload = (
    _event: Electron.Event,
    item: Electron.DownloadItem,
    initiator: Electron.WebContents
  ): void => {
    if (initiator !== contents || started) return
    // The session handler rejected it (ad, HTML interstitial) without a save path.
    if (!item.getSavePath()) return
    started = true
    hideFromUser(win)
    item.once('done', () => {
      if (!win.isDestroyed()) win.close()
    })
  }
  ses.on('will-download', onWillDownload)

  const closed = new Promise<void>((resolve) => {
    win.on('closed', () => {
      ses.removeListener('will-download', onWillDownload)
      unregisterGuestContents(contentsId)
      clearDownloadContext(contentsId)
      if (!started) closedByUser = revealed
      resolve()
    })
  })

  void win.loadURL(pageUrl).catch(() => {
    // Download navigations abort loadURL; the will-download listener picks them up.
  })

  let deadline = Date.now() + (opts.timeoutMs ?? WINDOW_TIMEOUT_MS)
  let captchaSince: number | null = null
  for (;;) {
    if (started) return 'started'
    if (win.isDestroyed()) return closedByUser ? 'cancel' : null
    if (Date.now() >= deadline) break

    keepOffscreen()
    let step: PageStep = 'working'
    try {
      step = await opts.step(win)
    } catch {
      // Page navigated or the script was not ready; try again next tick.
    }
    if (started) return 'started'

    if (step === 'captcha') {
      captchaSince ??= Date.now()
      if (!revealed && Date.now() - captchaSince >= CAPTCHA_REVEAL_MS) {
        revealed = true
        deadline = Math.max(deadline, Date.now() + REVEALED_TIMEOUT_MS)
        revealForUser(win)
      }
    } else {
      captchaSince = null
    }
    await Promise.race([sleep(pollMs), closed])
  }

  if (!win.isDestroyed()) win.close()
  return null
}
