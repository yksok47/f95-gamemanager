import { session } from 'electron'
import { F95Error } from './errors'
import { pullCookiesFromElectron, scheduleSaveSession } from '../session-store'

const HOST = 'https://f95zone.to'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const LOGIN_WALL =
  '<pre>Sorry, you have to be <a href="/login">logged in</a> to access this page</a></pre>'

const CLOUDFLARE_MARKERS = [
  '<title>Just a moment...</title>',
  '<title>Attention Required! | Cloudflare</title>',
  'window._cf_chl_opt'
]

const RATE_LIMIT_MARKERS = [
  '<title>429 Too Many Requests</title>',
  '<h1>429 Too Many Requests</h1>',
  '<title>DDoS-Guard</title>'
]

export { F95Error }

export function f95Url(path: string): string {
  if (path.startsWith('http')) return path
  return new URL(path, HOST).href
}

function detectTransportError(status: number, body: string): void {
  if (status === 429 || RATE_LIMIT_MARKERS.some((m) => body.includes(m))) {
    throw new F95Error('F95zone is rate-limiting requests. Try again in a moment.', 'rate_limited')
  }
  if (CLOUDFLARE_MARKERS.some((m) => body.includes(m))) {
    throw new F95Error(
      'F95zone served a bot-check page. Wait a bit and retry, or log in again.',
      'blocked'
    )
  }
  if (body.includes(LOGIN_WALL)) {
    throw new F95Error('Not logged in to F95zone.', 'login_required')
  }
}

export async function f95Fetch(
  path: string,
  init: RequestInit = {},
  options: { timeoutMs?: number } = {}
): Promise<{ response: Response; body: string }> {
  const url = f95Url(path)
  const headers = new Headers(init.headers)
  headers.set('User-Agent', USER_AGENT)
  headers.set('Accept-Language', 'en-US,en;q=0.9')
  if (!headers.has('Accept')) {
    headers.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')
  }

  const timeoutMs = options.timeoutMs ?? 20000
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
  detectTransportError(response.status, body)
  return { response, body }
}
