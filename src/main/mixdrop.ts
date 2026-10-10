import { BrowserWindow } from 'electron'
import {
  isMixdropDirectUrl,
  isMixdropPageUrl,
  mixdropPageUrl,
  mixdropRecaptchaSiteKeyFromHtml,
  resolveMixdropFromFetch
} from '@shared/mixdrop'
import { sessionFetch } from './connector-session'
import { resolveFromHiddenWindow } from './connector-window'
import { isUsableWindow } from './windows'

export { isMixdropPageUrl }

const PAGE_READY_SCRIPT = `(function () {
  var title = (document.title || '').toLowerCase()
  if (title === 'just a moment...' || title.indexOf('attention required') !== -1) return false
  if (document.querySelector('#challenge-running, .cf-browser-verification, #cf-challenge-running, #challenge-error-text')) {
    return false
  }
  var root = document.body ? document.body.innerText : ''
  if (/we are sorry/i.test(root) && /can'?t find the (video|file)/i.test(root)) return false
  return Boolean(
    document.querySelector('.download-btn, a.download-btn, meta[name="csrf"]') ||
      /download file/i.test(root)
  )
})()`

const PREPARE_SCRIPT = `(function () {
  try {
    if (window.MDCore) {
      MDCore.adblock = 0
      MDCore.blockAB = false
    }
  } catch (error) {}
  var btn = document.querySelector('.download-btn')
  if (btn) btn.classList.remove('player')
  return true
})()`

function ticketFetchScript(siteKey: string): string {
  return `(async function () {
    try {
      if (window.MDCore) {
        MDCore.adblock = 0
        MDCore.blockAB = false
      }
      var btn = document.querySelector('.download-btn')
      if (btn) btn.classList.remove('player')
      var href = btn && btn.getAttribute('href')
      if (href && href !== '#' && !/^javascript:/i.test(href)) {
        return new URL(href, location.href).href
      }
      var csrfEl = document.querySelector('meta[name="csrf"]')
      var csrf = csrfEl && csrfEl.getAttribute('content')
      if (!csrf || typeof grecaptcha === 'undefined' || !grecaptcha.execute) return null
      var siteKey = ${JSON.stringify(siteKey)}
      var recaptchaScript = document.querySelector('script[src*="recaptcha/api.js"]')
      var fromScript = recaptchaScript && recaptchaScript.src && recaptchaScript.src.match(/[?&]render=([^&]+)/)
      if (fromScript && fromScript[1]) siteKey = decodeURIComponent(fromScript[1])
      var token = await new Promise(function (resolve, reject) {
        grecaptcha.ready(function () {
          grecaptcha.execute(siteKey, { action: 'download' }).then(resolve).catch(reject)
        })
      })
      var response = await fetch(location.href, {
        method: 'POST',
        headers: {
          Accept: 'application/json, text/javascript, */*; q=0.01',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: new URLSearchParams({ csrf: csrf, token: String(token || ''), a: 'genticket' }).toString()
      })
      var data = await response.json()
      return data && data.url ? data.url : null
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

async function preparePage(win: BrowserWindow): Promise<void> {
  if (!isUsableWindow(win)) return
  await win.webContents.executeJavaScript(PREPARE_SCRIPT)
}

async function clickDownload(win: BrowserWindow): Promise<void> {
  await preparePage(win)
  if (!isUsableWindow(win)) return
  await win.webContents.executeJavaScript(
    `(function () {
      var btn = document.querySelector('.download-btn')
      if (btn) btn.click()
      return true
    })()`
  )
}

async function fetchDirectFromPage(win: BrowserWindow, siteKey: string): Promise<string | null> {
  if (!isUsableWindow(win)) return null
  try {
    const href = await win.webContents.executeJavaScript(ticketFetchScript(siteKey))
    if (typeof href === 'string' && isMixdropDirectUrl(href)) return href
  } catch {
    // Window closed, navigated, or recaptcha/fetch was blocked.
  }
  return null
}

async function readGeneratedLink(win: BrowserWindow): Promise<string | null> {
  if (!isUsableWindow(win)) return null
  try {
    const current = win.webContents.getURL()
    if (current && isMixdropDirectUrl(current)) return current
    if (!(await pageLooksReady(win))) return null
    await preparePage(win)
    const recaptchaSrc = await win.webContents.executeJavaScript(
      `(function () {
        var el = document.querySelector('script[src*="recaptcha/api.js"]')
        return el && el.src ? el.src : ''
      })()`
    )
    const siteKey = mixdropRecaptchaSiteKeyFromHtml(
      typeof recaptchaSrc === 'string' ? recaptchaSrc : ''
    )
    return await fetchDirectFromPage(win, siteKey)
  } catch {
    return null
  }
}

export async function resolveMixdropDownload(pageUrl: string): Promise<string | null> {
  const page = mixdropPageUrl(pageUrl)
  if (!page) return null
  const fetchImpl = sessionFetch()
  try {
    const fromHttp = await resolveMixdropFromFetch(page, fetchImpl)
    if (fromHttp) return fromHttp
    return await resolveFromHiddenWindow(page, {
      onReady: clickDownload,
      readResult: readGeneratedLink
    })
  } catch (error) {
    console.warn('[mixdrop] could not resolve download URL', error)
    return null
  }
}
