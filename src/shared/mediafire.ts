const PAGE_HOST = 'mediafire.com'
const PAGE_PATH = /^\/(file|download|view|file_premium)\//i
const CDN_HOST = /^download\d*\.mediafire\.com$/i
const BUTTON_HREF =
  /id=["']downloadButton["'][^>]*href=["']([^"']+)["']/i
const BUTTON_HREF_BEFORE =
  /href=["']([^"']+)["'][^>]*id=["']downloadButton["']/i
const ARIA_HREF =
  /aria-label=["']Download file["'][^>]*href=["']([^"']+)["']/i
const CDN_HREF = /https?:\/\/download\d+\.mediafire\.com\/[^\s"'<>]+/i

function hostnameOf(value: string): string {
  return value.toLowerCase().replace(/\.$/, '').replace(/^(www|m)\./, '')
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

export function isMediaFireCdnHost(hostname: string): boolean {
  return CDN_HOST.test(hostname.toLowerCase().replace(/\.$/, ''))
}

export function isMediaFireCdnUrl(href: string): boolean {
  try {
    return isMediaFireCdnHost(new URL(href).hostname)
  } catch {
    return false
  }
}

/** True for MediaFire interstitial pages, not `download*.mediafire.com` CDNs. */
export function isMediaFirePageUrl(href: string): boolean {
  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (hostnameOf(url.hostname) !== PAGE_HOST) return false
    if (PAGE_PATH.test(url.pathname)) return true
    return Boolean(url.searchParams.get('ukey') || /^[?&]?[a-z0-9]{8,}$/i.test(url.search))
  } catch {
    return false
  }
}

export function mediaFireDirectUrlFromHtml(html: string): string | null {
  const candidates = [
    html.match(BUTTON_HREF)?.[1],
    html.match(BUTTON_HREF_BEFORE)?.[1],
    html.match(ARIA_HREF)?.[1],
    html.match(CDN_HREF)?.[0]
  ]
  for (const raw of candidates) {
    if (!raw) continue
    const href = decodeHtml(raw).trim()
    if (isMediaFireCdnUrl(href)) return href
  }
  return null
}
