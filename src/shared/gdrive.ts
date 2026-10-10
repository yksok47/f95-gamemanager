import {
  absoluteUrl,
  hostnameOf,
  parseHttpUrl,
  redirectUrlFromHeaders,
  type ConnectorFetch
} from './connector'

const PAGE_HOSTS = new Set(['drive.google.com', 'docs.google.com', 'drive.usercontent.google.com'])
const FILE_PATH = /\/file\/d\/([^/?#]+)/i
const FOLDER_PATH = /\/(?:drive\/)?folders\//i
const CONFIRM = /[?&]confirm=([0-9A-Za-z_-]+)/
const CONFIRM_INPUT = /name=["']confirm["'][^>]*value=["']([^"']+)["']/i
const CONFIRM_INPUT_BEFORE = /value=["']([^"']+)["'][^>]*name=["']confirm["']/i
const UUID_INPUT = /name=["']uuid["'][^>]*value=["']([^"']+)["']/i
const UUID_INPUT_BEFORE = /value=["']([^"']+)["'][^>]*name=["']uuid["']/i
const FORM_ACTION = /id=["']download-form["'][^>]*action=["']([^"']+)["']/i
const UC_HREF = /id=["']uc-download-link["'][^>]*href=["']([^"']+)["']/i
const UC_HREF_BEFORE = /href=["']([^"']+)["'][^>]*id=["']uc-download-link["']/i

export function isGoogleDriveHost(hostname: string): boolean {
  return PAGE_HOSTS.has(hostnameOf(hostname))
}

export function googleDriveFileIdFromUrl(href: string): string | null {
  const url = parseHttpUrl(href)
  if (!url || !isGoogleDriveHost(url.hostname)) return null
  const fromPath = url.pathname.match(FILE_PATH)?.[1]
  if (fromPath) return decodeURIComponent(fromPath)
  const fromQuery = url.searchParams.get('id')
  if (fromQuery) return fromQuery
  return null
}

export function isGoogleDriveFolderUrl(href: string): boolean {
  const url = parseHttpUrl(href)
  if (!url || !isGoogleDriveHost(url.hostname)) return false
  return FOLDER_PATH.test(url.pathname)
}

/** True for a Google Drive *file* share, not a folder. */
export function isGoogleDrivePageUrl(href: string): boolean {
  if (isGoogleDriveFolderUrl(href)) return false
  return Boolean(googleDriveFileIdFromUrl(href))
}

export function googleDriveExportUrl(fileId: string, confirm = 't', uuid?: string): string {
  const url = new URL('https://drive.usercontent.google.com/download')
  url.searchParams.set('id', fileId)
  url.searchParams.set('export', 'download')
  url.searchParams.set('confirm', confirm)
  if (uuid) url.searchParams.set('uuid', uuid)
  return url.href
}

function isHtmlContentType(headers: { get(name: string): string | null }): boolean {
  const type = headers.get('content-type')?.toLowerCase() ?? ''
  return type.includes('text/html') || type.includes('application/xhtml')
}

function isDriveInterstitial(href: string): boolean {
  const url = parseHttpUrl(href)
  if (!url) return true
  const host = hostnameOf(url.hostname)
  if (host === 'drive.google.com' || host === 'docs.google.com') return true
  if (host === 'drive.usercontent.google.com') {
    return url.searchParams.has('id') && !url.searchParams.get('confirm')
  }
  return false
}

export function googleDriveDirectUrlFromHtml(html: string, fileId: string): string | null {
  const confirm =
    html.match(CONFIRM)?.[1] || html.match(CONFIRM_INPUT)?.[1] || html.match(CONFIRM_INPUT_BEFORE)?.[1]
  const uuid = html.match(UUID_INPUT)?.[1] || html.match(UUID_INPUT_BEFORE)?.[1]
  const formAction = html.match(FORM_ACTION)?.[1]
  if (formAction) {
    const action = absoluteUrl(formAction, 'https://drive.usercontent.google.com/')
    if (action) {
      try {
        const url = new URL(action)
        if (!url.searchParams.get('id')) url.searchParams.set('id', fileId)
        if (!url.searchParams.get('export')) url.searchParams.set('export', 'download')
        if (confirm && !url.searchParams.get('confirm')) url.searchParams.set('confirm', confirm)
        if (uuid && !url.searchParams.get('uuid')) url.searchParams.set('uuid', uuid)
        return url.href
      } catch {
        // Fall through.
      }
    }
  }
  const uc = html.match(UC_HREF)?.[1] || html.match(UC_HREF_BEFORE)?.[1]
  if (uc) {
    const href = absoluteUrl(uc, 'https://drive.google.com/')
    if (href) return href
  }
  if (confirm) return googleDriveExportUrl(fileId, confirm, uuid)
  return null
}

export async function resolveGoogleDriveFromFetch(
  pageUrl: string,
  fetchImpl: ConnectorFetch
): Promise<string | null> {
  const fileId = googleDriveFileIdFromUrl(pageUrl)
  if (!fileId || isGoogleDriveFolderUrl(pageUrl)) return null
  const candidates = [
    googleDriveExportUrl(fileId),
    `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}&confirm=t`
  ]
  try {
    for (const start of candidates) {
      const response = await fetchImpl(start, {
        method: 'GET',
        headers: { Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
        redirect: 'manual'
      })
      const redirected = redirectUrlFromHeaders(response.headers, start)
      if (redirected && !isDriveInterstitial(redirected)) return redirected
      if (!isHtmlContentType(response.headers) && response.status >= 200 && response.status < 300) {
        return response.url
      }
      if (isHtmlContentType(response.headers) || response.status === 200) {
        const html = await response.text()
        const fromHtml = googleDriveDirectUrlFromHtml(html, fileId)
        if (fromHtml) return fromHtml
      }
    }
    return googleDriveExportUrl(fileId)
  } catch (error) {
    console.warn('[gdrive] could not resolve download URL', error)
    return null
  }
}
