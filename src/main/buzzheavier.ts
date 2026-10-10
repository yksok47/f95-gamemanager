import { BrowserWindow } from 'electron'
import {
  buzzheavierDownloadUrl,
  isBuzzheavierDirectUrl,
  isBuzzheavierPageUrl,
  resolveBuzzheavierFromFetch
} from '@shared/buzzheavier'
import { sessionFetch } from './connector-session'
import { resolveFromHiddenWindow } from './connector-window'
import { isUsableWindow } from './windows'

export { isBuzzheavierPageUrl }

const PAGE_READY_SCRIPT = `(function () {
  var title = (document.title || '').toLowerCase()
  if (title === 'just a moment...' || title.indexOf('attention required') !== -1) return false
  if (document.querySelector('#challenge-running, .cf-browser-verification, #cf-challenge-running, #challenge-error-text')) {
    return false
  }
  var root = document.body ? document.body.innerText : ''
  return Boolean(
    document.querySelector('a[hx-get*="download"], [hx-get*="/download"], a.gay-button, h1') ||
      /download file/i.test(root)
  )
})()`

function pageFetchScript(fallbackDownload: string): string {
  return `(async function () {
    var fallback = ${JSON.stringify(fallbackDownload)}
    var btn = document.querySelector('a[hx-get*="download"], [hx-get*="/download"], a.gay-button')
    var path = btn && (btn.getAttribute('hx-get') || btn.getAttribute('href'))
    var url = fallback
    try {
      if (path && path !== '#' && !/^javascript:/i.test(path)) url = new URL(path, location.href).href
    } catch (error) {}
    async function read(redirect) {
      var response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: '*/*',
          'HX-Request': 'true',
          'HX-Current-URL': location.href
        },
        redirect: redirect
      })
      var loc =
        response.headers.get('HX-Redirect') ||
        response.headers.get('Location') ||
        response.headers.get('HX-Location')
      if (loc && loc.trim().charAt(0) === '{') loc = ''
      if (loc) return new URL(loc, location.href).href
      if (response.url && response.url !== url) return response.url
      return null
    }
    try {
      var fromManual = await read('manual')
      if (fromManual) return fromManual
    } catch (error) {}
    try {
      return await read('follow')
    } catch (error) {
      return null
    }
  })()`
}

async function pageLooksReady(win: BrowserWindow): Promise<boolean> {
  if (!isUsableWindow(win)) return false
  try {
    return (await win.webContents.executeJavaScript(PAGE_READY_SCRIPT)) === true
  } catch {
    return false
  }
}

async function fetchDirectFromPage(win: BrowserWindow, pageUrl: string): Promise<string | null> {
  if (!isUsableWindow(win)) return null
  const fallback = buzzheavierDownloadUrl(pageUrl)
  if (!fallback) return null
  try {
    const href = await win.webContents.executeJavaScript(pageFetchScript(fallback))
    if (typeof href === 'string' && isBuzzheavierDirectUrl(href, pageUrl)) return href
  } catch {
    // Window closed, navigated, or the in-page fetch was blocked.
  }
  return null
}

async function readGeneratedLink(
  win: BrowserWindow,
  pageUrl: string,
  fetchImpl: ReturnType<typeof sessionFetch>
): Promise<string | null> {
  if (!isUsableWindow(win)) return null
  try {
    const current = win.webContents.getURL()
    if (current && isBuzzheavierDirectUrl(current, pageUrl)) return current
    if (!(await pageLooksReady(win))) return null
    const fromHttp = await resolveBuzzheavierFromFetch(pageUrl, fetchImpl)
    if (fromHttp) return fromHttp
    return await fetchDirectFromPage(win, pageUrl)
  } catch {
    return null
  }
}

export async function resolveBuzzheavierDownload(pageUrl: string): Promise<string | null> {
  if (!isBuzzheavierPageUrl(pageUrl)) return null
  const fetchImpl = sessionFetch()
  try {
    const fromHttp = await resolveBuzzheavierFromFetch(pageUrl, fetchImpl)
    if (fromHttp) return fromHttp
    return await resolveFromHiddenWindow(pageUrl, {
      readResult: (win) => readGeneratedLink(win, pageUrl, fetchImpl)
    })
  } catch (error) {
    console.warn('[buzzheavier] could not resolve download URL', error)
    return null
  }
}
