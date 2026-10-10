import { hostnameOf, parseHttpUrl } from './connector'

const PAGE_HOSTS = new Set(['datanodes.to'])
const SKIP = new Set([
  'download',
  'download.htm',
  'download.html',
  'file',
  'files',
  'pages',
  'login',
  'register',
  'premium',
  'api',
  'app',
  'tos',
  'faq'
])
const HTML_NAME = /\.html?$/i
const LANDING_PATH = /^\/(download|premium|login|register)?$/i

export function isDataNodesHost(hostname: string): boolean {
  return PAGE_HOSTS.has(hostnameOf(hostname))
}

export function dataNodesIdFromUrl(href: string): string | null {
  const url = parseHttpUrl(href)
  if (!url || !isDataNodesHost(url.hostname)) return null
  const parts = url.pathname.split('/').filter(Boolean)
  for (const raw of parts) {
    const part = raw.trim()
    if (!part || SKIP.has(part.toLowerCase())) continue
    // `/id/Game.zip` — the file id is the first path segment, not the filename.
    if (part.includes('.')) continue
    return part
  }
  return null
}

export function isDataNodesPageUrl(href: string): boolean {
  return Boolean(dataNodesIdFromUrl(href))
}

function lastPathSegment(url: URL): string {
  return url.pathname.split('/').filter(Boolean).pop() || ''
}

function isDataNodesLandingUrl(url: URL): boolean {
  if (!isDataNodesHost(url.hostname)) return false
  const path = url.pathname.replace(/\/+$/, '') || '/'
  if (LANDING_PATH.test(path)) return true
  return HTML_NAME.test(lastPathSegment(url))
}

/** True when Chromium is saving DataNodes' `/download` HTML as `download.htm`. */
export function isDataNodesInterstitialDownload(
  url: string,
  filename = '',
  mimeType = ''
): boolean {
  const parsed = parseHttpUrl(url)
  if (!parsed) return false
  const host = hostnameOf(parsed.hostname)
  if (host !== 'datanodes.to' && !host.endsWith('.datanodes.to')) return false
  const name = filename.toLowerCase()
  if (name === 'download.htm' || name === 'download.html') return true
  const mime = mimeType.toLowerCase()
  const html = !mime || mime.includes('text/html') || mime.includes('application/xhtml')
  return html && isDataNodesLandingUrl(parsed)
}
