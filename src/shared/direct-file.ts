/** Archives, installers, and Ren'Py overlay files that should download rather than display. */
const DIRECT_FILE_EXT = /\.(zip|7z|rar|exe|rpy|rpyc|rpa|rpu)$/i

/**
 * File lockers that put a filename in the path but still serve an HTML interstitial.
 * CDN subdomains (`download1234.mediafire.com`) are not listed here.
 */
const FILE_LOCKER_LANDING_HOSTS = new Set([
  '1fichier.com',
  'akirabox.com',
  'anonfiles.com',
  'bowfile.com',
  'buzzheavier.com',
  'bzzhr.co',
  'cancerads.com',
  'datanodes.to',
  'ddownload.com',
  'docs.google.com',
  'drive.google.com',
  'dropbox.com',
  'file-upload.com',
  'filehn.com',
  'gofile.io',
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
  'uploadev.com',
  'uploadhaven.com',
  'vikingfile.com',
  'workupload.com'
])

function lastPathSegment(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop()?.trim() || ''
}

function hostnameOf(value: string): string {
  return value.toLowerCase().replace(/\.$/, '').replace(/^(www|m)\./, '')
}

/** True when the host is a locker landing page, not a file CDN. */
export function isFileLockerLandingHost(hostname: string): boolean {
  return FILE_LOCKER_LANDING_HOSTS.has(hostnameOf(hostname))
}

/** True when a filename (or XenForo `name.ext.id` slug) should be saved, not opened. */
export function isDirectDownloadName(name: string): boolean {
  const base = lastPathSegment(name)
  if (!base) return false
  if (DIRECT_FILE_EXT.test(base)) return true
  return DIRECT_FILE_EXT.test(base.replace(/\.\d+$/, ''))
}

/** True when a URL or an extra filename (link title / text) points at a direct file. */
export function isDirectFileHref(href: string, extraName = ''): boolean {
  try {
    const url = new URL(href)
    // MediaFire (and similar) pages look like `/file/id/Game.zip` but are HTML.
    if (isFileLockerLandingHost(url.hostname)) return false
    const last = lastPathSegment(decodeURIComponent(url.pathname))
    if (isDirectDownloadName(last)) return true
  } catch {
    if (isDirectDownloadName(href)) return true
  }
  return Boolean(extraName && isDirectDownloadName(extraName))
}
