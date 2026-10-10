import { absoluteUrl, decodeHtml, hostnameOf, parseHttpUrl } from './connector'
import { isMaskedDownloadLink } from './download-providers'
import { isMegaHost } from './mega'

const F95_HOST = /(^|\.)f95zone\.(to|com|ninja)$/

export function isF95GateUrl(href: string): boolean {
  const url = parseHttpUrl(href)
  if (!url) return false
  return F95_HOST.test(hostnameOf(url.hostname))
}

function htmlAttr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'))
  const raw = match?.[1] ?? match?.[2]
  if (raw == null) return null
  return decodeHtml(raw).trim()
}

function isPlaceholderHref(href: string): boolean {
  const trimmed = href.trim()
  return !trimmed || trimmed === '#' || /^javascript:/i.test(trimmed)
}

/** Off-F95 destination, with MEGA `#key` restored when the interstitial encoded it as `%23`. */
export function normalizeUnmaskedUrl(href: string, base?: string): string | null {
  const resolved = base ? absoluteUrl(href, base) : parseHttpUrl(href)?.href ?? null
  if (!resolved) return null
  let parsed = parseHttpUrl(resolved)
  if (!parsed) return null
  if (isF95GateUrl(parsed.href) || isMaskedDownloadLink(parsed.href)) return null
  if (isMegaHost(parsed.hostname) && !parsed.hash && /%23/i.test(parsed.href)) {
    parsed = parseHttpUrl(parsed.href.replace('%23', '#'))
    if (!parsed) return null
  }
  return parsed.href
}

/** Reads the "Continue to …" target from an F95 `/masked/` landing page. */
export function hostLinkFromHtml(html: string, pageUrl: string): string | null {
  const tags = html.match(/<[a-z][^>]*\bhost_link\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const href = htmlAttr(tag, 'data-href') || htmlAttr(tag, 'data-url') || htmlAttr(tag, 'href')
    if (!href || isPlaceholderHref(href)) continue
    const dest = normalizeUnmaskedUrl(href, pageUrl)
    if (dest) return dest
  }

  const continueMatch = html.match(/<a\b([^>]*)>\s*Continue to\b/i)
  if (continueMatch?.[1]) {
    const href = htmlAttr(`<a ${continueMatch[1]}>`, 'href')
    if (href && !isPlaceholderHref(href)) {
      const dest = normalizeUnmaskedUrl(href, pageUrl)
      if (dest) return dest
    }
  }

  const refresh =
    html.match(/http-equiv=["']refresh["'][^>]*content=["'][^"']*url=([^"';\s]+)/i) ||
    html.match(/content=["'][^"']*url=([^"';\s]+)[^"']*["'][^>]*http-equiv=["']refresh["']/i)
  if (refresh?.[1]) {
    const dest = normalizeUnmaskedUrl(refresh[1], pageUrl)
    if (dest) return dest
  }

  return null
}
