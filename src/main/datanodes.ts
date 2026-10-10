import type { GameFileContext } from '@shared/types'
import { isDataNodesPageUrl } from '@shared/datanodes'
import { driveHiddenWindowToDownload, runPageScript, type PageStep } from './connector-window'

export { isDataNodesPageUrl }

/**
 * DataNodes gates the file behind a `download1` form, a Turnstile check, and a
 * countdown whose `dl_token` the server validates, so the page has to run.
 *
 * The `download1` form is submitted natively (bypassing ad click handlers that
 * swallow the first click). On the countdown page the Vue button shows only
 * once Turnstile passes: one click starts the timer, the next POSTs `download2`
 * and navigates to the file, which becomes a session download.
 */
const STEP_SCRIPT = `(function () {
  var form = document.getElementById('downloadForm')
  var op = form && form.querySelector('input[name="op"]')
  if (op && op.value === 'download1') {
    var submit = form.querySelector('#method_free')
    if (!submit || submit.disabled || window.__gmSubmitted) return 'working'
    window.__gmSubmitted = true
    var method = document.createElement('input')
    method.type = 'hidden'
    method.name = 'method_free'
    method.value = submit.value || 'Free Download >>'
    form.appendChild(method)
    HTMLFormElement.prototype.submit.call(form)
    return 'working'
  }
  var buttons = document.querySelectorAll('button')
  for (var i = 0; i < buttons.length; i++) {
    var label = (buttons[i].textContent || '').trim()
    if (/^(free download|start download)/i.test(label)) {
      buttons[i].click()
      return 'working'
    }
    if (/^(ready in|starting download|download started)/i.test(label)) return 'working'
  }
  var captcha = document.querySelector('.dn-captcha')
  if (captcha && captcha.offsetParent !== null) return 'captcha'
  return 'working'
})()`

async function step(win: Electron.BrowserWindow): Promise<PageStep> {
  return (await runPageScript<PageStep>(win, STEP_SCRIPT)) === 'captcha' ? 'captcha' : 'working'
}

export async function resolveDataNodesDownload(
  pageUrl: string,
  context?: GameFileContext
): Promise<'started' | 'cancel' | null> {
  if (!isDataNodesPageUrl(pageUrl)) return null
  try {
    return await driveHiddenWindowToDownload(pageUrl, { context, step })
  } catch (error) {
    console.warn('[datanodes] could not start download', error)
    return null
  }
}
