import { session } from 'electron'
import {
  f95BrowserFetch,
  hasF95Browser,
  isCloudflareChallengeHtml,
  resolveBotCheckInWindow
} from './challenge-window'
import { F95Error } from './errors'
import { encodeMultipartForm, type MultipartFile } from './multipart'
import { coalesceInflight, f95InflightGetKey } from './inflight'
import { recordF95Request } from './request-log'
import { pullCookiesFromElectron, scheduleSaveSession } from '../session-store'

const HOST = 'https://f95zone.to'

const LOGIN_WALL =
  '<pre>Sorry, you have to be <a href="/login">logged in</a> to access this page</a></pre>'

const RATE_LIMIT_MARKERS = [
  '<title>429 Too Many Requests</title>',
  '<h1>429 Too Many Requests</h1>',
  '<title>DDoS-GUARD</title>',
  '<title>DDoS-Guard</title>'
]

export { F95Error }

const inFlightGets = new Map<string, Promise<{ response: Response; body: string }>>()

export function f95Url(path: string): string {
  if (path.startsWith('http')) return path
  return new URL(path, HOST).href
}

function electronUserAgent(): string {
  try {
    return session.defaultSession.getUserAgent()
  } catch {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  }
}

function requestMethod(init: RequestInit): string {
  return String(init.method || 'GET').toUpperCase()
}

function logF95Attempt(
  url: string,
  method: string,
  outcome: { ok: boolean; status?: number }
): void {
  recordF95Request({
    url,
    method,
    ok: outcome.ok,
    status: outcome.status
  })
}

function detectTransportError(status: number, body: string): void {
  if (status === 429 || RATE_LIMIT_MARKERS.some((m) => body.includes(m))) {
    throw new F95Error('F95zone is rate-limiting requests. Try again in a moment.', 'rate_limited')
  }
  if (isCloudflareChallengeHtml(body)) {
    throw new F95Error(
      'F95zone served a bot-check page. Complete the check in the browser window, then retry.',
      'blocked'
    )
  }
  if (body.includes(LOGIN_WALL)) {
    throw new F95Error('Not logged in to F95zone.', 'login_required')
  }
}

async function sessionFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ response: Response; body: string }> {
  const headers = new Headers(init.headers)
  headers.set('User-Agent', electronUserAgent())
  headers.set('Accept-Language', 'en-US,en;q=0.9')
  if (!headers.has('Accept')) {
    headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
  }

  let response: Response
  try {
    response = await session.defaultSession.fetch(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    throw new F95Error(
      error instanceof Error ? error.message : 'Network request to F95zone failed.',
      'network'
    )
  }

  await pullCookiesFromElectron()
  scheduleSaveSession()
  const body = await response.text()
  return { response, body }
}

async function browserFetchAsResponse(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<{ response: Response; body: string }> {
  const result = await f95BrowserFetch(url, init, { timeoutMs })
  const response = new Response(result.body, {
    status: result.status,
    statusText: result.ok ? 'OK' : 'Error'
  })
  return { response, body: result.body }
}

export async function f95Fetch(
  path: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; skipChallenge?: boolean; preferBrowser?: boolean } = {}
): Promise<{ response: Response; body: string }> {
  const url = f95Url(path)
  const method = requestMethod(init)
  const key = f95InflightGetKey(method, url)
  if (!key) return f95FetchOnce(path, init, options)
  return coalesceInflight(inFlightGets, key, () => f95FetchOnce(path, init, options))
}

async function f95FetchOnce(
  path: string,
  init: RequestInit,
  options: { timeoutMs?: number; skipChallenge?: boolean; preferBrowser?: boolean }
): Promise<{ response: Response; body: string }> {
  const url = f95Url(path)
  const method = requestMethod(init)
  const timeoutMs = options.timeoutMs ?? 20000
  const useBrowser = Boolean(options.preferBrowser || hasF95Browser())

  let result: { response: Response; body: string }
  try {
    result = useBrowser
      ? await browserFetchAsResponse(url, init, timeoutMs)
      : await sessionFetch(url, init, timeoutMs)
  } catch (error) {
    logF95Attempt(url, method, { ok: false })
    if (error instanceof F95Error) throw error
    if (useBrowser) {
      try {
        result = await sessionFetch(url, init, timeoutMs)
      } catch (fallbackError) {
        logF95Attempt(url, method, { ok: false })
        if (fallbackError instanceof F95Error) throw fallbackError
        throw new F95Error(
          fallbackError instanceof Error
            ? fallbackError.message
            : 'Network request to F95zone failed.',
          'network'
        )
      }
    } else {
      throw new F95Error(
        error instanceof Error ? error.message : 'Network request to F95zone failed.',
        'network'
      )
    }
  }

  try {
    detectTransportError(result.response.status, result.body)
  } catch (error) {
    logF95Attempt(url, method, { ok: false, status: result.response.status })
    if (error instanceof F95Error && error.code === 'blocked' && !options.skipChallenge) {
      console.info('[f95] bot-check detected — opening challenge window', url)
      const cleared = await resolveBotCheckInWindow(url)
      if (cleared) {
        return f95FetchOnce(path, init, { ...options, skipChallenge: true, preferBrowser: true })
      }
      throw new F95Error(
        'F95zone bot-check was not completed. Finish it in the browser window, or close it and try again.',
        'blocked'
      )
    }
    throw error
  }
  logF95Attempt(url, method, { ok: result.response.ok, status: result.response.status })
  return result
}

/**
 * Multipart POST on Chromium session.fetch. Node FormData is not a reliable body
 * there, so this encodes the body the same way Drive uploads do.
 */
export async function f95PostForm(
  path: string,
  form: { fields: Record<string, string>; file?: MultipartFile },
  options: { referer: string; timeoutMs?: number } = { referer: HOST }
): Promise<{ response: Response; body: string }> {
  const url = f95Url(path)
  const timeoutMs = options.timeoutMs ?? 120000
  const encoded = encodeMultipartForm(form.fields, form.file)
  const headers = new Headers()
  headers.set('User-Agent', electronUserAgent())
  headers.set('Accept-Language', 'en-US,en;q=0.9')
  headers.set('Accept', 'application/json, text/javascript, */*; q=0.01')
  headers.set('X-Requested-With', 'XMLHttpRequest')
  headers.set('Origin', HOST)
  headers.set('Referer', options.referer || HOST)
  headers.set('Content-Type', encoded.contentType)

  const payload = new Uint8Array(encoded.body.byteLength)
  payload.set(encoded.body)

  let response: Response
  try {
    response = await session.defaultSession.fetch(url, {
      method: 'POST',
      headers,
      body: new Blob([payload]),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    logF95Attempt(url, 'POST', { ok: false })
    throw new F95Error(
      error instanceof Error ? error.message : 'Network request to F95zone failed.',
      'network'
    )
  }

  await pullCookiesFromElectron()
  scheduleSaveSession()
  const body = await response.text()
  try {
    detectTransportError(response.status, body)
  } catch (error) {
    logF95Attempt(url, 'POST', { ok: false, status: response.status })
    throw error
  }
  logF95Attempt(url, 'POST', { ok: response.ok, status: response.status })
  return { response, body }
}
