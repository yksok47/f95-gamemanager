import { BrowserWindow, shell } from 'electron'
import { isF95DownloadGate } from '@shared/download-providers'
import { appIcon } from '../app-icon'
import { isUsableWindow } from '../windows'
import { coalesceInflight } from './inflight'
import { usableDestination } from './masked'

const CHECK_TIMEOUT_MS = 15 * 60 * 1000

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

function waitForCheck(pageUrl: string): Promise<string | null> {
  const parent = BrowserWindow.getFocusedWindow()
  const win = new BrowserWindow({
    width: 1000,
    height: 820,
    minWidth: 640,
    minHeight: 560,
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
    const timer = setTimeout(() => finish(null), CHECK_TIMEOUT_MS)

    function finish(href: string | null): void {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (isUsableWindow(win)) win.close()
      resolve(href)
    }

    const contents = win.webContents
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
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

    win.loadURL(pageUrl).catch(() => {})
  })
}
