import { BrowserWindow } from 'electron'
import { hostLinkFromHtml, isF95GateUrl, normalizeUnmaskedUrl } from '@shared/f95-masked'
import { isMaskedDownloadLink } from '@shared/download-providers'
import { isMegaPageUrl, megaHasKey } from '@shared/mega'
import { isUsableWindow } from '../windows'
import { F95Error } from './errors'
import { f95Fetch } from './http'
import { coalesceInflight } from './inflight'

const inflight = new Map<string, Promise<string | null>>()
const recent = new Map<string, { at: number; url: string | null }>()
const RECENT_MS = 30_000

const WINDOW_TIMEOUT_MS = 20_000
const POLL_MS = 300
const CLICK_SETTLE_MS = 400

const READ_HOST_LINK = `(() => {
  var el = document.querySelector('a.host_link, .host_link')
  if (!el) return { found: false, href: null }
  var href =
    el.getAttribute('data-href') ||
    el.getAttribute('data-url') ||
    el.getAttribute('href') ||
    el.href ||
    ''
  return { found: true, href: href }
})()`

const CLICK_HOST_LINK = `(() => {
  var el = document.querySelector('a.host_link, .host_link')
  if (!el) return false
  el.click()
  return true
})()`

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

/** Drop MEGA URLs that lost the fragment key — they cannot be decrypted. */
function usableDestination(href: string | null | undefined, base?: string): string | null {
  if (!href) return null
  const dest = normalizeUnmaskedUrl(href, base)
  if (!dest) return null
  if (isMegaPageUrl(dest) && !megaHasKey(dest)) return null
  return dest
}

/**
 * Follow an F95 `/masked/<host>/…` interstitial to the real host URL.
 * Preserves MEGA `#key` fragments from the Continue link / navigation events.
 */
export async function resolveF95MaskedUrl(pageUrl: string): Promise<string | null> {
  if (!isMaskedDownloadLink(pageUrl)) return pageUrl
  const cached = recent.get(pageUrl)
  const ttl = cached?.url ? RECENT_MS : 2_000
  if (cached && Date.now() - cached.at < ttl) return cached.url
  return coalesceInflight(inflight, pageUrl, async () => {
    const url = await resolveF95MaskedUrlOnce(pageUrl)
    recent.set(pageUrl, { at: Date.now(), url })
    return url
  })
}

async function resolveF95MaskedUrlOnce(pageUrl: string): Promise<string | null> {
  try {
    const { response, body } = await f95Fetch(pageUrl, {}, { timeoutMs: 20000 })
    const fromFinal = usableDestination(response.url)
    if (fromFinal) return fromFinal
    const fromHtml = hostLinkFromHtml(body, pageUrl)
    if (fromHtml) return fromHtml
  } catch (error) {
    if (error instanceof F95Error && error.code === 'login_required') {
      console.warn('[f95] masked link needs login')
      return null
    }
    console.warn('[f95] could not fetch masked page', error)
  }
  return resolveMaskedFromWindow(pageUrl)
}

async function resolveMaskedFromWindow(pageUrl: string): Promise<string | null> {
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

  return new Promise((resolve) => {
    let settled = false
    let clicked = false
    let hostLinkSeenAt = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (href: string | null): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (!win.isDestroyed()) win.close()
      resolve(href)
    }

    const take = (raw: string | null | undefined, base = pageUrl): string | null => {
      return usableDestination(raw, isF95GateUrl(base) ? pageUrl : base)
    }

    const contents = win.webContents
    contents.setWindowOpenHandler(({ url }) => {
      const dest = take(url)
      if (dest) finish(dest)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event, url) => {
      const dest = take(url)
      if (!dest) return
      event.preventDefault()
      finish(dest)
    })
    contents.on('will-redirect', (event, url) => {
      const dest = take(url)
      if (!dest) return
      event.preventDefault()
      finish(dest)
    })
    contents.on('did-navigate', (_event, url) => {
      const dest = take(url)
      if (dest) finish(dest)
    })
    contents.on('did-navigate-in-page', (_event, url) => {
      const dest = take(url)
      if (dest) finish(dest)
    })
    win.on('closed', () => finish(null))

    timer = setTimeout(() => finish(null), WINDOW_TIMEOUT_MS)

    void (async () => {
      try {
        await win.loadURL(pageUrl)
      } catch {
        if (!settled) finish(null)
        return
      }

      while (isUsableWindow(win) && !settled) {
        keepHidden(win)
        try {
          const current = take(contents.getURL())
          if (current) {
            finish(current)
            return
          }
          const snapshot = (await contents.executeJavaScript(READ_HOST_LINK)) as {
            found?: boolean
            href?: string | null
          } | null
          const fromLink = snapshot?.href ? take(snapshot.href, contents.getURL() || pageUrl) : null
          if (fromLink) {
            finish(fromLink)
            return
          }
          if (snapshot?.found) {
            if (!hostLinkSeenAt) hostLinkSeenAt = Date.now()
            if (!clicked && Date.now() - hostLinkSeenAt >= CLICK_SETTLE_MS) {
              clicked = true
              if (isUsableWindow(win) && !settled) {
                await contents.executeJavaScript(CLICK_HOST_LINK)
              }
            }
          }
        } catch {
          if (settled) return
        }
        await sleep(POLL_MS)
      }
    })()
  })
}
