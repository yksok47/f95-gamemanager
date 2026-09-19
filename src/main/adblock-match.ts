import { Request, type FiltersEngine, type RequestType } from '@ghostery/adblocker'

/** File lockers used on F95 download rows — popups to these stay allowed. */
export const FILE_HOST_SUFFIXES = [
  '1fichier.com',
  'akirabox.com',
  'anonfiles.com',
  'bowfile.com',
  'buzzheavier.com',
  'bzzhr.co',
  'cancerads.com',
  'datanodes.to',
  'ddownload.com',
  'dropbox.com',
  'dropboxusercontent.com',
  'f95zone.com',
  'f95zone.ninja',
  'f95zone.to',
  'file-upload.com',
  'filehn.com',
  'gofile.io',
  'google.com',
  'googleapis.com',
  'googleusercontent.com',
  'hexupload.net',
  'katfile.com',
  'mediafire.com',
  'mega.co.nz',
  'mega.io',
  'mega.nz',
  'mirrored.to',
  'mixdrop.ag',
  'mixdrop.co',
  'mixdrop.sx',
  'nitroflare.com',
  'nopy.to',
  'pixeldrain.com',
  'pixeldrain.net',
  'rapidgator.net',
  'send.cm',
  'send.now',
  'uploadhaven.com',
  'uploadev.com',
  'vikingfile.com',
  'workupload.com'
]

/** Object-storage CDNs that sometimes serve the real file in a new window. */
export const FILE_CDN_SUFFIXES = [
  'amazonaws.com',
  'backblazeb2.com',
  'cloudflarestorage.com',
  'cloudfront.net',
  'digitaloceanspaces.com',
  'r2.dev',
  'storage.googleapis.com'
]

const EXECUTABLE_EXT = /\.(exe|msi|scr|bat|cmd|pif|com|apk|dmg|pkg)(?:$|\?)/i

export type AdblockEngine = Pick<FiltersEngine, 'match'>

export type PopupCheck = {
  url: string
  pageUrl: string
  engines: Array<AdblockEngine | null | undefined>
}

export type DownloadCheck = {
  url: string
  pageUrl: string
  filename?: string
  mimeType?: string
  urlChain?: string[]
  engines: Array<AdblockEngine | null | undefined>
}

export type NetworkCheck = {
  url: string
  pageUrl: string
  resourceType: string
  engines: Array<AdblockEngine | null | undefined>
}

export type NetworkDecision = {
  cancel: boolean
  redirectURL?: string
}

function hostMatches(hostname: string, suffixes: readonly string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (!host) return false
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

export function isKnownFileHost(hostname: string): boolean {
  return hostMatches(hostname, FILE_HOST_SUFFIXES)
}

export function isLikelyFileCdn(hostname: string): boolean {
  return hostMatches(hostname, FILE_CDN_SUFFIXES)
}

export function isExecutableDownload(filename: string, url: string, mimeType = ''): boolean {
  const mime = mimeType.toLowerCase()
  if (
    mime.includes('application/x-msdownload') ||
    mime.includes('application/x-msdos-program') ||
    mime.includes('application/vnd.microsoft.portable-executable') ||
    mime.includes('application/x-apple-diskimage')
  ) {
    return true
  }
  if (filename && EXECUTABLE_EXT.test(filename)) return true
  try {
    return EXECUTABLE_EXT.test(new URL(url).pathname)
  } catch {
    return EXECUTABLE_EXT.test(url)
  }
}

function engineMatch(
  engines: Array<AdblockEngine | null | undefined>,
  url: string,
  pageUrl: string,
  type: RequestType
): { match: boolean; exception: boolean; redirectURL?: string } {
  const request = Request.fromRawDetails({ url, sourceUrl: pageUrl, type })
  for (const engine of engines) {
    if (!engine) continue
    const result = engine.match(request)
    if (result.match) {
      return {
        match: true,
        exception: false,
        redirectURL: result.redirect?.dataUrl
      }
    }
    if (result.exception) return { match: false, exception: true }
  }
  return { match: false, exception: false }
}

function popupIsAllowedTarget(url: string, pageUrl: string): boolean {
  const request = Request.fromRawDetails({ url, sourceUrl: pageUrl, type: 'other' })
  if (request.isFirstParty) return true
  if (isKnownFileHost(request.hostname)) return true
  if (isLikelyFileCdn(request.hostname)) return true
  return false
}

/** Guest `window.open` — block ad-network URLs and unknown third-party popunders. */
export function shouldBlockPopup({ url, pageUrl, engines }: PopupCheck): boolean {
  const blocked = engineMatch(engines, url, pageUrl, 'other')
  if (blocked.match) return true
  if (blocked.exception) return false
  if (popupIsAllowedTarget(url, pageUrl)) return false
  return true
}

function downloadUrlBlocked(
  engines: Array<AdblockEngine | null | undefined>,
  url: string,
  pageUrl: string
): boolean {
  return engineMatch(engines, url, pageUrl, 'other').match
}

/**
 * Cancel drive-by adware binaries. Archives from any host stay allowed unless
 * EasyList matches the URL; same-site / known-hoster executables stay allowed.
 */
export function shouldBlockDownload({
  url,
  pageUrl,
  filename = '',
  mimeType = '',
  urlChain = [],
  engines
}: DownloadCheck): boolean {
  const urls = [url, ...urlChain].filter(Boolean)
  if (urls.some((item) => downloadUrlBlocked(engines, item, pageUrl))) return true

  if (!isExecutableDownload(filename, url, mimeType)) return false

  const request = Request.fromRawDetails({ url, sourceUrl: pageUrl, type: 'other' })
  if (request.isFirstParty) return false
  if (isKnownFileHost(request.hostname)) return false
  return true
}

/** Subresource requests on guest pages. Main frames always load. */
export function matchNetworkRequest({
  url,
  pageUrl,
  resourceType,
  engines
}: NetworkCheck): NetworkDecision {
  if (resourceType === 'mainFrame') return { cancel: false }
  const type = (resourceType || 'other') as RequestType
  const result = engineMatch(engines, url, pageUrl, type)
  if (result.redirectURL) return { cancel: false, redirectURL: result.redirectURL }
  if (result.match) return { cancel: true }
  return { cancel: false }
}
