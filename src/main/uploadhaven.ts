import type { GameFileContext } from '@shared/types'
import { isUploadHavenPageUrl, uploadHavenPageUrl } from '@shared/uploadhaven'
import { driveHiddenWindowToDownload, runPageScript, type PageStep } from './connector-window'

export { isUploadHavenPageUrl }

/**
 * The free form only POSTs successfully with a Turnstile token and after the
 * page countdown, so the page itself has to run. Submitting natively lets the
 * POST's redirect turn into a session download.
 */
const STEP_SCRIPT = `(function () {
  var title = (document.title || '').toLowerCase()
  if (title === 'just a moment...' || title.indexOf('attention required') !== -1) return 'captcha'
  var form = document.getElementById('form-download')
  if (!form) return 'working'
  if (form.querySelector('.cf-turnstile')) {
    var token = form.querySelector('[name="cf-turnstile-response"]')
    if (!token || !token.value) return 'captcha'
  }
  var btn = document.getElementById('submitFree')
  if (!btn) return 'working'
  var ready = btn.getAttribute('type') === 'submit' || (btn.classList && btn.classList.contains('ready'))
  if (!ready || window.__gmSubmitted) return 'working'
  window.__gmSubmitted = true
  var type = document.createElement('input')
  type.type = 'hidden'
  type.name = 'type'
  type.value = 'free'
  form.appendChild(type)
  HTMLFormElement.prototype.submit.call(form)
  return 'working'
})()`

async function step(win: Electron.BrowserWindow): Promise<PageStep> {
  return (await runPageScript<PageStep>(win, STEP_SCRIPT)) === 'captcha' ? 'captcha' : 'working'
}

export async function resolveUploadHavenDownload(
  pageUrl: string,
  context?: GameFileContext
): Promise<'started' | 'cancel' | null> {
  const page = uploadHavenPageUrl(pageUrl)
  if (!page) return null
  try {
    return await driveHiddenWindowToDownload(page, { context, step })
  } catch (error) {
    console.warn('[uploadhaven] could not start download', error)
    return null
  }
}
