import { BrowserWindow, shell } from 'electron'
import { isF95DownloadGate } from '@shared/download-providers'
import { appIcon } from '../app-icon'
import { isUsableWindow } from '../windows'
import { coalesceInflight } from './inflight'
import { usableDestination } from './masked'

const CHECK_TIMEOUT_MS = 15 * 60 * 1000
const QUIET_MS = 10_000
const POLL_MS = 250
const CLICK_SETTLE_MS = 300
const CLICK_RETRY_MS = 3_000
const MAX_CLICKS = 3

const resolved = new Map<string, string>()
const inflight = new Map<string, Promise<string | null>>()

function gateKey(pageUrl: string): string {
  try {
    const url = new URL(pageUrl)
    return `${url.pathname.replace(/\/+$/, '')}:${url.searchParams.get('k') || url.search}`
  } catch {
    return pageUrl
  }
}

export function resolvedGateDestination(pageUrl: string): string | null {
  return resolved.get(gateKey(pageUrl)) ?? null
}

export async function resolveF95DownloadGate(pageUrl: string): Promise<string | null> {
  if (!isF95DownloadGate(pageUrl)) return pageUrl
  const key = gateKey(pageUrl)
  const known = resolved.get(key)
  if (known) return known
  return coalesceInflight(inflight, key, async () => {
    const dest = await waitForCheck(pageUrl)
    if (dest) resolved.set(key, dest)
    return dest
  })
}

export function publicSourceLinks(urls: readonly string[]): string[] {
  const out: string[] = []
  for (const url of urls) {
    const link = isF95DownloadGate(url) ? resolvedGateDestination(url) : url
    if (link && !out.includes(link)) out.push(link)
  }
  return out
}

function isCaptchaHost(href: string): boolean {
  try {
    return /(^|\.)hcaptcha\.com$/i.test(new URL(href).hostname)
  } catch {
    return false
  }
}

function destination(href: string | null | undefined): string | null {
  if (!href || isCaptchaHost(href)) return null
  return usableDestination(href)
}

type GateSnapshot = {
  found: boolean
  href: string | null
  disabled: boolean
  check: boolean
}

const READ_GATE = `(() => {
  var text = function (el) {
    return String(el.textContent || el.value || '').replace(/\\s+/g, ' ').trim()
  }
  var nodes = Array.prototype.slice.call(
    document.querySelectorAll('a, button, input[type="submit"], input[type="button"], [role="button"]')
  )
  var el = nodes.find(function (node) { return /^continue to\\b/i.test(text(node)) }) ||
    document.querySelector('a.host_link, .host_link')
  var check = Boolean(
    document.querySelector(
      'iframe[src*="hcaptcha"], iframe[src*="recaptcha"], iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"], .h-captcha, .g-recaptcha, .cf-turnstile, #challenge-form, form[action*="login"]'
    )
  )
  if (!el) return { found: false, href: null, disabled: false, check: check }
  var href =
    el.getAttribute('data-href') ||
    el.getAttribute('data-url') ||
    (el.tagName === 'A' ? el.href : '') ||
    (el.form && el.form.method.toLowerCase() === 'get' ? el.form.action : '') ||
    ''
  var disabled = Boolean(
    el.disabled ||
      el.getAttribute('aria-disabled') === 'true' ||
      /\\bis-disabled\\b|\\bdisabled\\b/.test(el.className || '')
  )
  return { found: true, href: href, disabled: disabled, check: check }
})()`

const CLICK_GATE = `(() => {
  var text = function (el) {
    return String(el.textContent || el.value || '').replace(/\\s+/g, ' ').trim()
  }
  var nodes = Array.prototype.slice.call(
    document.querySelectorAll('a, button, input[type="submit"], input[type="button"], [role="button"]')
  )
  var el = nodes.find(function (node) { return /^continue to\\b/i.test(text(node)) }) ||
    document.querySelector('a.host_link, .host_link')
  if (!el) return false
  if (el.tagName === 'A') el.removeAttribute('target')
  el.click()
  return true
})()`

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function waitForCheck(pageUrl: string): Promise<string | null> {
  const parent = BrowserWindow.getFocusedWindow()
  const win = new BrowserWindow({
    width: 1000,
    height: 820,
    minWidth: 640,
    minHeight: 560,
    show: false,
    ...(isUsableWindow(parent) ? { parent } : {}),
    title: 'F95zone download check',
    icon: appIcon,
    autoHideMenuBar: true,
    backgroundColor: '#12141a',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  return new Promise((resolve) => {
    let settled = false
    let revealed = false
    const timer = setTimeout(() => finish(null), CHECK_TIMEOUT_MS)

    function finish(href: string | null): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (isUsableWindow(win)) win.close()
      resolve(href)
    }

    function reveal(): void {
      if (settled || revealed || !isUsableWindow(win)) return
      revealed = true
      win.show()
      win.focus()
    }

    const contents = win.webContents
    contents.setWindowOpenHandler(({ url }) => {
      const dest = destination(url)
      if (dest) {
        finish(dest)
        return { action: 'deny' }
      }
      if (revealed && /^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    contents.on('will-navigate', (event) => {
      if (!event.isMainFrame) return
      const dest = destination(event.url)
      if (!dest) return
      event.preventDefault()
      finish(dest)
    })
    contents.on('will-redirect', (event) => {
      if (!event.isMainFrame) return
      const dest = destination(event.url)
      if (!dest) return
      event.preventDefault()
      finish(dest)
    })
    contents.on('did-navigate', (_event, url) => {
      const dest = destination(url)
      if (dest) finish(dest)
    })
    win.on('closed', () => finish(null))

    const quietUntil = Date.now() + QUIET_MS
    void (async () => {
      await win.loadURL(pageUrl).catch(() => {})
      let readySince = 0
      let clicks = 0
      let lastClick = 0
      while (!settled && isUsableWindow(win)) {
        if (!revealed && Date.now() > quietUntil) reveal()
        try {
          const now = destination(contents.getURL())
          if (now) {
            finish(now)
            return
          }
          const snap = (await contents.executeJavaScript(READ_GATE)) as GateSnapshot | null
          if (settled) return
          const fromLink = snap?.href ? destination(snap.href) : null
          if (fromLink) {
            finish(fromLink)
            return
          }
          if (snap?.check && (!snap.found || snap.disabled)) reveal()
          if (snap?.found && !snap.disabled) {
            if (!readySince) readySince = Date.now()
            const due = clicks === 0 ? CLICK_SETTLE_MS : CLICK_RETRY_MS
            if (clicks < MAX_CLICKS && Date.now() - Math.max(readySince, lastClick) >= due) {
              clicks += 1
              lastClick = Date.now()
              await contents.executeJavaScript(CLICK_GATE)
            }
          } else {
            readySince = 0
          }
        } catch {
          if (settled) return
        }
        await sleep(POLL_MS)
      }
    })()
  })
}
