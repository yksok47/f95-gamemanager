import { session } from 'electron'
import {
  f95BrowserFetch,
  hasF95Browser,
  isCloudflareChallengeHtml,
  resolveBotCheckInWindow
} from './challenge-window'
import { F95Error } from './errors'
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
  const timeoutMs = options.timeoutMs ?? 20000
  const useBrowser = Boolean(options.preferBrowser || hasF95Browser())

  let result: { response: Response; body: string }
  try {
    result = useBrowser
      ? await browserFetchAsResponse(url, init, timeoutMs)
      : await sessionFetch(url, init, timeoutMs)
  } catch (error) {
    if (error instanceof F95Error) throw error
    if (useBrowser) {
      result = await sessionFetch(url, init, timeoutMs)
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
    if (error instanceof F95Error && error.code === 'blocked' && !options.skipChallenge) {
      console.info('[f95] bot-check detected — opening challenge window', url)
      const cleared = await resolveBotCheckInWindow(url)
      if (cleared) {
        return f95Fetch(path, init, { ...options, skipChallenge: true, preferBrowser: true })
      }
      throw new F95Error(
        'F95zone bot-check was not completed. Finish it in the browser window, or close it and try again.',
        'blocked'
      )
    }
    throw error
  }
  return result
}
