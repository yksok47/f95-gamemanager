/** Archives, installers, and Ren'Py overlay files that should download rather than display. */
const DIRECT_FILE_EXT = /\.(zip|7z|rar|exe|rpy|rpyc|rpa|rpu)$/i

function lastPathSegment(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop()?.trim() || ''
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
  if (extraName && isDirectDownloadName(extraName)) return true
  try {
    const url = new URL(href)
    const last = lastPathSegment(decodeURIComponent(url.pathname))
    return isDirectDownloadName(last)
  } catch {
    return isDirectDownloadName(href)
  }
}
