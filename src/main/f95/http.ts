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
import { recordRequest } from '../request-log'
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

const inFlightGets = new Map<string, Promise<FetchResult>>()

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

type Transport = 'session' | 'browser'

type FetchResult = { response: Response; body: string }

type AttemptOutcome = { ok: boolean; status?: number; error?: unknown; result?: FetchResult }

const TRANSPORT_NOTES: Record<Transport, string> = {
  session:
    "Sent from the app's browser session. It adds the F95zone cookies and standard browser headers, which aren't listed here.",
  browser:
    "Sent from the hidden F95zone browser window. It adds the F95zone cookies and its own browser headers, which aren't listed here."
}

function sessionRequestHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers)
  headers.set('User-Agent', electronUserAgent())
  headers.set('Accept-Language', 'en-US,en;q=0.9')
  if (!headers.has('Accept')) {
    headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
  }
  return headers
}

function browserRequestHeaders(init: RequestInit): Headers {
  const headers = new Headers(init.headers)
  headers.delete('User-Agent')
  return headers
}

function attemptLogger(
  url: string,
  method: string,
  init: RequestInit,
  transport: Transport,
  requestHeaders: Headers = transport === 'browser'
    ? browserRequestHeaders(init)
    : sessionRequestHeaders(init)
): (outcome: AttemptOutcome) => void {
  const startedAt = Date.now()
  return (outcome) => {
    recordRequest({
      service: 'f95zone',
      method,
      url,
      ok: outcome.ok,
      status: outcome.status ?? outcome.result?.response.status,
      startedAt,
      error: outcome.error,
      note: TRANSPORT_NOTES[transport],
      requestHeaders,
      requestBody: init.body,
      responseHeaders: outcome.result?.response.headers,
      responseBody: outcome.result?.body
    })
  }
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
): Promise<FetchResult> {
  const headers = sessionRequestHeaders(init)

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
): Promise<FetchResult> {
  const result = await f95BrowserFetch(url, init, { timeoutMs })
  const response = new Response(result.body, {
    status: result.status,
    statusText: result.ok ? 'OK' : 'Error',
    headers: result.headers
  })
  return { response, body: result.body }
}

export async function f95Fetch(
  path: string,
  init: RequestInit = {},
  options: { timeoutMs?: number; skipChallenge?: boolean; preferBrowser?: boolean } = {}
): Promise<FetchResult> {
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
): Promise<FetchResult> {
  const url = f95Url(path)
  const method = requestMethod(init)
  const timeoutMs = options.timeoutMs ?? 20000
  const useBrowser = Boolean(options.preferBrowser || hasF95Browser())

  let log = attemptLogger(url, method, init, useBrowser ? 'browser' : 'session')
  let result: FetchResult
  try {
    result = useBrowser
      ? await browserFetchAsResponse(url, init, timeoutMs)
      : await sessionFetch(url, init, timeoutMs)
  } catch (error) {
    log({ ok: false, error })
    if (error instanceof F95Error) throw error
    if (useBrowser) {
      log = attemptLogger(url, method, init, 'session')
      try {
        result = await sessionFetch(url, init, timeoutMs)
      } catch (fallbackError) {
        log({ ok: false, error: fallbackError })
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
    log({ ok: false, error, result })
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
  log({ ok: result.response.ok, result })
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
): Promise<FetchResult> {
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

  const logged = new FormData()
  for (const [name, value] of Object.entries(form.fields)) logged.append(name, value)
  if (form.file) logged.append(form.file.fieldName, new Blob([payload]), form.file.filename)
  const log = attemptLogger(url, 'POST', { method: 'POST', body: logged }, 'session', headers)

  let response: Response
  try {
    response = await session.defaultSession.fetch(url, {
      method: 'POST',
      headers,
      body: new Blob([payload]),
      signal: AbortSignal.timeout(timeoutMs)
    })
  } catch (error) {
    log({ ok: false, error })
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
    log({ ok: false, error, result: { response, body } })
    throw error
  }
  log({ ok: response.ok, result: { response, body } })
  return { response, body }
}
