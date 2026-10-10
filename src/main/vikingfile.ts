import { BrowserWindow, session } from 'electron'
import { isVikingFilePageUrl, resolveVikingFileFromFetch } from '@shared/vikingfile'
import { registerGuestContents, unregisterGuestContents } from './adblock'
import { isUsableWindow } from './windows'

const WINDOW_TIMEOUT_MS = 90_000
const POLL_MS = 400

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function sessionFetch(
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    redirect?: RequestRedirect
  }
): Promise<Pick<Response, 'ok' | 'url' | 'headers' | 'text'>> {
  return session.defaultSession.fetch(input, {
    method: init?.method,
    headers: {
      'User-Agent': session.defaultSession.getUserAgent(),
      ...init?.headers
    },
    body: init?.body,
    redirect: init?.redirect
  })
}

async function readGeneratedLink(win: BrowserWindow): Promise<string | null> {
  if (!isUsableWindow(win)) return null
  try {
    const href = await win.webContents.executeJavaScript(
      `(function () {
        var el = document.getElementById('download-link')
        return el && el.getAttribute('href') ? el.getAttribute('href') : null
      })()`
    )
    if (typeof href === 'string' && /^https?:\/\//i.test(href) && !isVikingFilePageUrl(href)) {
      return href
    }
  } catch {
    // Window closed or script not ready.
  }
  return null
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

async function resolveVikingFileFromWindow(pageUrl: string): Promise<string | null> {
  const win = new BrowserWindow({
    width: 1024,
    height: 768,
    x: -32000,
    y: -32000,
    show: false,
    frame: false,
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

  try {
    await win.loadURL(pageUrl)
  } catch {
    if (!win.isDestroyed()) win.close()
    return closed
  }

  const startedAt = Date.now()
  while (!win.isDestroyed() && Date.now() - startedAt < WINDOW_TIMEOUT_MS) {
    keepHidden(win)
    const href = await readGeneratedLink(win)
    if (href) {
      settled = true
      if (!win.isDestroyed()) win.close()
      return href
    }
    await Promise.race([sleep(POLL_MS), closed])
  }

  settled = true
  if (!win.isDestroyed()) win.close()
  return null
}

/** Fetch the landing page, then finish a Turnstile wait in a hidden window if needed. */
export async function resolveVikingFileDownload(pageUrl: string): Promise<string | null> {
  if (!isVikingFilePageUrl(pageUrl)) return null
  try {
    const fromHttp = await resolveVikingFileFromFetch(pageUrl, sessionFetch)
    if (fromHttp) return fromHttp
    return await resolveVikingFileFromWindow(pageUrl)
  } catch (error) {
    console.warn('[vikingfile] could not resolve download URL', error)
    return null
  }
}

export { isVikingFilePageUrl }
