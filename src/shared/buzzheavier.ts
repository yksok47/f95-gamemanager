import {
  asRecord,
  firstHttpUrl,
  hostnameOf,
  jsonValue,
  parseHttpUrl,
  redirectUrlFromHeaders,
  type ConnectorFetch
} from './connector'

const PAGE_HOSTS = new Set(['buzzheavier.com', 'bzzhr.co', 'bzzhr.to'])
const SKIP = new Set([
  'developers',
  'proxy',
  'api',
  'login',
  'signup',
  'register',
  'account',
  'pricing',
  'faq',
  'tos',
  'privacy',
  'blog',
  'speedtest',
  'contact',
  'help',
  'terms',
  'index'
])
const MAX_BODY_BYTES = 1_000_000

export function isBuzzheavierHost(hostname: string): boolean {
  return PAGE_HOSTS.has(hostnameOf(hostname))
}

export function buzzheavierIdFromUrl(href: string): string | null {
  const url = parseHttpUrl(href)
  if (!url || !isBuzzheavierHost(url.hostname)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts[0] === 'f' || parts[0] === 'file') parts.shift()
  if (parts[parts.length - 1]?.toLowerCase() === 'download') parts.pop()
  const id = parts[0]?.trim()
  if (!id || SKIP.has(id.toLowerCase())) return null
  return id
}

export function isBuzzheavierPageUrl(href: string): boolean {
  return Boolean(buzzheavierIdFromUrl(href))
}

export function buzzheavierPageUrl(href: string): string | null {
  const url = parseHttpUrl(href)
  const id = buzzheavierIdFromUrl(href)
  if (!url || !id) return null
  return `https://${hostnameOf(url.hostname)}/${id}`
}

export function buzzheavierDownloadUrl(href: string): string | null {
  const page = buzzheavierPageUrl(href)
  return page ? `${page}/download` : null
}

function stripSlash(value: string): string {
  return value.replace(/\/+$/, '')
}

function header(headers: { get(name: string): string | null }, name: string): string {
  return headers.get(name) || ''
}

function isFileLikeResponse(headers: { get(name: string): string | null }): boolean {
  const disposition = header(headers, 'content-disposition')
  if (/attachment/i.test(disposition) || /filename=/i.test(disposition)) return true
  const type = header(headers, 'content-type').split(';')[0].trim().toLowerCase()
  if (!type || /html|json|text\//.test(type)) return false
  return /octet-stream|zip|7z|rar|binary/.test(type)
}

function bodyLooksSafeToRead(headers: { get(name: string): string | null }): boolean {
  const length = Number(header(headers, 'content-length') || '0')
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return false
  if (isFileLikeResponse(headers)) return false
  const type = header(headers, 'content-type').toLowerCase()
  return !type || /html|json|text\/|javascript/.test(type)
}

export function isBuzzheavierChallengeBody(body: string): boolean {
  return /just a moment\.\.\.|cf-mitigated|__cf_chl_opt|cf-browser-verification|challenge-platform/i.test(
    body
  )
}

/** True for a CDN/file URL, not the landing page or the HTMX `/download` endpoint. */
export function isBuzzheavierDirectUrl(href: string, pageUrl: string): boolean {
  const url = parseHttpUrl(href)
  if (!url) return false
  const download = buzzheavierDownloadUrl(pageUrl)
  const page = buzzheavierPageUrl(pageUrl)
  if (download && stripSlash(href) === stripSlash(download)) return false
  if (page && stripSlash(href) === stripSlash(page)) return false
  if (isBuzzheavierHost(url.hostname) && /\/download\/?$/i.test(url.pathname)) return false
  if (
    isBuzzheavierPageUrl(href) &&
    stripSlash(url.pathname) === `/${buzzheavierIdFromUrl(pageUrl)}`
  ) {
    return false
  }
  return true
}

function redirectFromResponse(
  headers: { get(name: string): string | null },
  base: string
): string | null {
  const fromStandard = redirectUrlFromHeaders(headers, base)
  if (fromStandard) return fromStandard
  const location = header(headers, 'hx-location').trim()
  if (!location || location.startsWith('{')) return null
  try {
    return new URL(location, base).href
  } catch {
    return null
  }
}

function urlFromJsonBody(body: string): string | null {
  const json = asRecord(jsonValue(body))
  if (!json) return null
  const data = asRecord(json.data) ?? json
  return (
    firstHttpUrl(data.url) ||
    firstHttpUrl(data.link) ||
    firstHttpUrl(data.download_url) ||
    firstHttpUrl(json.url) ||
    firstHttpUrl(json.link)
  )
}

export function buzzheavierDirectUrlFromResponse(
  pageUrl: string,
  response: {
    status: number
    url: string
    headers: { get(name: string): string | null }
  },
  body = ''
): string | null {
  const redirected = redirectFromResponse(response.headers, buzzheavierPageUrl(pageUrl) || pageUrl)
  if (redirected && isBuzzheavierDirectUrl(redirected, pageUrl)) return redirected
  if (isBuzzheavierDirectUrl(response.url, pageUrl)) return response.url
  if (body && isBuzzheavierChallengeBody(body)) return null
  const fromJson = urlFromJsonBody(body)
  if (fromJson && isBuzzheavierDirectUrl(fromJson, pageUrl)) return fromJson
  return null
}

function htmxHeaders(page: string, trailingSlash: boolean): Record<string, string> {
  const current = trailingSlash ? `${page}/` : page
  return {
    Accept: '*/*',
    Referer: current,
    'HX-Current-URL': current,
    'HX-Request': 'true'
  }
}

export async function resolveBuzzheavierFromFetch(
  pageUrl: string,
  fetchImpl: ConnectorFetch
): Promise<string | null> {
  const download = buzzheavierDownloadUrl(pageUrl)
  const page = buzzheavierPageUrl(pageUrl)
  if (!download || !page) return null
  const attempts: Array<{ headers: Record<string, string>; redirect: RequestRedirect }> = [
    { headers: htmxHeaders(page, false), redirect: 'manual' },
    { headers: htmxHeaders(page, true), redirect: 'manual' },
    { headers: htmxHeaders(page, false), redirect: 'follow' }
  ]
  try {
    for (const attempt of attempts) {
      const response = await fetchImpl(download, {
        method: 'GET',
        headers: attempt.headers,
        redirect: attempt.redirect
      })
      let body = ''
      if (bodyLooksSafeToRead(response.headers) && !redirectFromResponse(response.headers, page)) {
        body = await response.text()
      }
      const found = buzzheavierDirectUrlFromResponse(pageUrl, response, body)
      if (found) return found
      if (body && isBuzzheavierChallengeBody(body)) return null
    }
    return null
  } catch (error) {
    console.warn('[buzzheavier] could not resolve download URL', error)
    return null
  }
}
