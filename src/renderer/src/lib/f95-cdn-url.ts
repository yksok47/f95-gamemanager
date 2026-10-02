const ATTACHMENTS_HOST = /^attachments\.f95zone\.(to|com|ninja)$/i

/**
 * XenForo thread galleries show `/YYYY/MM/thumb/file` tiles; the parser stores the full file.
 * Put `/thumb/` back for grid/lightbox previews so we don't download 4K shots for 180px cells.
 */
export function f95AttachmentThumbUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (!ATTACHMENTS_HOST.test(parsed.hostname)) return url
    if (/\/thumb(nails?)?\//i.test(parsed.pathname)) return url
    const slash = parsed.pathname.lastIndexOf('/')
    if (slash <= 0 || slash === parsed.pathname.length - 1) return url
    parsed.pathname = `${parsed.pathname.slice(0, slash)}/thumb${parsed.pathname.slice(slash)}`
    return parsed.href
  } catch {
    return url
  }
}
