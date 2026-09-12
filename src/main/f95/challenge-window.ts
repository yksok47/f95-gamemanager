import { BrowserWindow, session } from 'electron'
import { pullCookiesFromElectron, scheduleSaveSession } from '../session-store'
import { isUsableWindow } from '../windows'

const CLOUDFLARE_MARKERS = [
  '<title>Just a moment...</title>',
  '<title>Attention Required! | Cloudflare</title>',
  'window._cf_chl_opt',
  'cf-browser-verification'
]

const MAX_WAIT_MS = 5 * 60 * 1000
const POLL_MS = 900

let inflightChallenge: Promise<boolean> | null = null
let f95Win: BrowserWindow | null = null

export function isCloudflareChallengeHtml(body: string): boolean {
  if (!body) return false
  return CLOUDFLARE_MARKERS.some((m) => body.includes(m))
}

function looksLikeChallengeTitle(title: string): boolean {
  const t = title.trim().toLowerCase()
  return t === 'just a moment...' || t.includes('attention required!')
}

async function hasClearanceCookie(): Promise<boolean> {
  try {
    const cookies = await session.defaultSession.cookies.get({ domain: 'f95zone.to' })
    const dotted = await session.defaultSession.cookies.get({ domain: '.f95zone.to' })
    const all = [...cookies, ...dotted]
    return all.some((c) => c.name === 'cf_clearance' && Boolean(c.value))
  } catch {
    return false
  }
}

function ensureF95Window(show: boolean): BrowserWindow {
  if (isUsableWindow(f95Win)) {
    if (show) {
      if (f95Win.isMinimized()) f95Win.restore()
      f95Win.show()
      f95Win.focus()
    }
    return f95Win
  }

  f95Win = new BrowserWindow({
    width: 980,
    height: 780,
    minWidth: 720,
    minHeight: 520,
    show,
    title: 'F95zone security check',
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  try {
    const ua = f95Win.webContents.getUserAgent()
    if (ua) session.defaultSession.setUserAgent(ua)
  } catch {
    /* ignore */
  }
  f95Win.on('closed', () => {
    f95Win = null
  })
  return f95Win
}

async function pageSnapshot(win: BrowserWindow): Promise<{ title: string; html: string }> {
  return (await win.webContents.executeJavaScript(
    `(() => ({
      title: document.title || '',
      html: document.documentElement ? document.documentElement.outerHTML.slice(0, 16000) : ''
    }))()`
  )) as { title: string; html: string }
}

async function pageLooksClear(win: BrowserWindow): Promise<boolean> {
  if (!isUsableWindow(win) || win.webContents.isDestroyed()) return false
  const snapshot = await pageSnapshot(win)
  if (!snapshot?.html) return false
  if (isCloudflareChallengeHtml(snapshot.html) || looksLikeChallengeTitle(snapshot.title || '')) {
    return false
  }
  const cleared = await hasClearanceCookie()
  return cleared || snapshot.html.length > 2000
}

export async function resolveBotCheckInWindow(url: string): Promise<boolean> {
  if (inflightChallenge) return inflightChallenge

  inflightChallenge = (async () => {
    const win = ensureF95Window(true)
    try {
      await win.loadURL(url)
    } catch {
      /* navigation aborted / download */
    }

    return await new Promise<boolean>((resolve) => {
      let settled = false
      const finish = (ok: boolean): void => {
        if (settled) return
        settled = true
        clearInterval(poll)
        clearTimeout(timeout)
        if (isUsableWindow(win)) {
          try {
            win.removeListener('closed', onClosed)
          } catch {
            /* ignore */
          }
          if (ok) {
            win.hide()
          }
        }
        resolve(ok)
      }

      const onClosed = (): void => finish(false)
      win.on('closed', onClosed)

      const check = (): void => {
        void (async () => {
          try {
            if (await pageLooksClear(win)) {
              await pullCookiesFromElectron()
              scheduleSaveSession()
              await new Promise((r) => setTimeout(r, 400))
              await pullCookiesFromElectron()
              scheduleSaveSession()
              finish(true)
            }
          } catch {
            /* mid-navigation */
          }
        })()
      }

      const poll = setInterval(check, POLL_MS)
      const timeout = setTimeout(() => finish(false), MAX_WAIT_MS)
      win.webContents.on('did-finish-load', check)
      check()
    })
  })().finally(() => {
    inflightChallenge = null
  })

  return inflightChallenge
}

export function hasF95Browser(): boolean {
  return isUsableWindow(f95Win)
}

type BrowserFetchResult = {
  status: number
  ok: boolean
  url: string
  body: string
}

export async function f95BrowserFetch(
  url: string,
  init: RequestInit = {},
  options: { timeoutMs?: number } = {}
): Promise<BrowserFetchResult> {
  const win = ensureF95Window(false)
  if (!isUsableWindow(win)) {
    throw new Error('F95 browser window unavailable')
  }

  const current = win.webContents.getURL()
  if (!current || current === 'about:blank' || !/f95zone\.to/i.test(current)) {
    try {
      await win.loadURL('https://f95zone.to/')
    } catch {
      /* ignore */
    }
  }

  const timeoutMs = options.timeoutMs ?? 30000
  const method = (init.method || 'GET').toUpperCase()
  const headers: Record<string, string> = {}
  if (init.headers) {
    const h = new Headers(init.headers)
    h.forEach((value, key) => {
      headers[key] = value
    })
  }
  delete headers['user-agent']
  delete headers['User-Agent']

  let body: string | undefined
  if (init.body != null) {
    body = typeof init.body === 'string' ? init.body : String(init.body)
  }

  const script = `
    (async () => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), ${timeoutMs})
      try {
        const res = await fetch(${JSON.stringify(url)}, {
          method: ${JSON.stringify(method)},
          headers: ${JSON.stringify(headers)},
          body: ${body === undefined ? 'undefined' : JSON.stringify(body)},
          credentials: 'include',
          redirect: 'follow',
          signal: ctrl.signal
        })
        const text = await res.text()
        return {
          status: res.status,
          ok: res.ok,
          url: res.url,
          body: text
        }
      } finally {
        clearTimeout(timer)
      }
    })()
  `

  const result = (await win.webContents.executeJavaScript(script, true)) as BrowserFetchResult
  await pullCookiesFromElectron()
  scheduleSaveSession()
  return result
}
