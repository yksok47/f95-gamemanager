import {
  asRecord,
  firstHttpUrl,
  hostnameOf,
  jsonValue,
  parseHttpUrl,
  redirectUrlFromHeaders,
  type ConnectorFetch
} from './connector'

const PAGE_HOSTS = new Set([
  'mixdrop.ag',
  'mixdrop.co',
  'mixdrop.sx',
  'mixdrop.top',
  'mixdrop.to',
  'mxdrop.top',
  'mxdrop.to'
])
const SKIP = new Set([
  'faq',
  'news',
  'panel',
  'login',
  'signup',
  'api',
  'contact',
  'premium',
  'tos',
  'privacy',
  'upload',
  'embed'
])
const PAGE_PATH = /^\/([fe])\/([^/?#]+)/i
const CSRF_META = /<meta\s+name=["']csrf["']\s+content=["']([^"']+)["']/i
const CSRF_META_BEFORE = /<meta\s+content=["']([^"']+)["']\s+name=["']csrf["']/i
const RECAPTCHA_RENDER = /recaptcha\/api\.js\?[^"'>\s]*render=([A-Za-z0-9_-]+)/i
const RECAPTCHA_EXECUTE = /grecaptcha\.execute\(\s*["']([A-Za-z0-9_-]+)["']/i

export const MIXDROP_RECAPTCHA_SITE_KEY = '6LetXaoUAAAAAB6axgg4WLG9oZ_6QLTsFXZj-5sd'

export function isMixdropHost(hostname: string): boolean {
  const host = hostnameOf(hostname)
  if (PAGE_HOSTS.has(host)) return true
  return /^(mixdrop|mxdrop|m1xdrop|miixdrop)\.[a-z0-9.-]+$/.test(host)
}

export function mixdropIdFromUrl(href: string): string | null {
  const url = parseHttpUrl(href)
  if (!url || !isMixdropHost(url.hostname)) return null
  const match = url.pathname.match(PAGE_PATH)
  const id = match?.[2]?.trim()
  if (!id || SKIP.has(id.toLowerCase())) return null
  return id
}

export function isMixdropPageUrl(href: string): boolean {
  return Boolean(mixdropIdFromUrl(href))
}

export function mixdropPageUrl(href: string): string | null {
  const url = parseHttpUrl(href)
  const id = mixdropIdFromUrl(href)
  if (!url || !id) return null
  return `https://${hostnameOf(url.hostname)}/f/${id}`
}

/** True for a CDN/file URL, not `/f/` or `/e/` landing pages. */
export function isMixdropDirectUrl(href: string): boolean {
  const url = parseHttpUrl(href)
  if (!url) return false
  return !isMixdropPageUrl(href)
}

export function isMixdropChallengeBody(body: string): boolean {
  return /just a moment\.\.\.|cf-mitigated|__cf_chl_opt|cf-browser-verification|challenge-platform/i.test(
    body
  )
}

export function isMixdropMissingBody(body: string): boolean {
  return /we are sorry|can'?t find the (video|file)/i.test(body)
}

export function mixdropCsrfFromHtml(html: string): string | null {
  const token = html.match(CSRF_META)?.[1] || html.match(CSRF_META_BEFORE)?.[1]
  return token?.trim() || null
}

export function mixdropRecaptchaSiteKeyFromHtml(html: string): string {
  return html.match(RECAPTCHA_RENDER)?.[1] || html.match(RECAPTCHA_EXECUTE)?.[1] || MIXDROP_RECAPTCHA_SITE_KEY
}

export function mixdropGenticketBody(csrf: string, recaptchaToken = ''): string {
  return new URLSearchParams({
    csrf,
    token: recaptchaToken,
    a: 'genticket'
  }).toString()
}

export function mixdropDirectUrlFromBody(body: string): string | null {
  const json = asRecord(jsonValue(body))
  if (json) {
    const url = firstHttpUrl(json.url) || firstHttpUrl(json.link) || firstHttpUrl(json.download_url)
    if (url && isMixdropDirectUrl(url)) return url
  }
  return null
}

export async function resolveMixdropFromFetch(
  pageUrl: string,
  fetchImpl: ConnectorFetch,
  recaptchaToken = ''
): Promise<string | null> {
  const page = mixdropPageUrl(pageUrl)
  if (!page) return null
  try {
    const landing = await fetchImpl(page, {
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow'
    })
    if (isMixdropDirectUrl(landing.url)) return landing.url
    const html = await landing.text()
    if (isMixdropChallengeBody(html) || isMixdropMissingBody(html)) return null
    const csrf = mixdropCsrfFromHtml(html)
    if (!csrf) return mixdropDirectUrlFromBody(html)
    const ticketUrl = landing.url && isMixdropPageUrl(landing.url) ? landing.url : page
    const response = await fetchImpl(ticketUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Origin: new URL(ticketUrl).origin,
        Referer: ticketUrl,
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: mixdropGenticketBody(csrf, recaptchaToken),
      redirect: 'manual'
    })
    const redirected = redirectUrlFromHeaders(response.headers, ticketUrl)
    if (redirected && isMixdropDirectUrl(redirected)) return redirected
    if (isMixdropDirectUrl(response.url)) return response.url
    return mixdropDirectUrlFromBody(await response.text())
  } catch (error) {
    console.warn('[mixdrop] could not resolve download URL', error)
    return null
  }
}
