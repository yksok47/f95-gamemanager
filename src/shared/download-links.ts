/** Same rules as the metadata API's `NormalizeLinkURL`, so client lookups hit server keys. */
export function downloadLinkKey(raw: string): string | null {
  const value = raw.trim()
  if (!value || value.length > 2048 || /[ \t\r\n]/.test(value)) return null
  const match = value.match(/^(https?):\/\/([^/?#]+)(.*)$/i)
  if (!match) return null
  const scheme = match[1].toLowerCase()
  let host = match[2].toLowerCase()
  const defaultPort = scheme === 'https' ? ':443' : ':80'
  if (host.endsWith(defaultPort)) host = host.slice(0, -defaultPort.length)
  let tail = match[3]
  if (!/[?#]/.test(tail)) tail = tail.replace(/\/+$/, '')
  return `${scheme}://${host}${tail}`
}

/** Clicked link first, then its mirrors; deduped by link key and capped like the API. */
export function sourceLinksFor(clicked: string, mirrors: readonly string[]): string[] {
  const seen = new Set<string>()
  const links: string[] = []
  for (const url of [clicked, ...mirrors]) {
    const key = downloadLinkKey(url)
    if (!key || seen.has(key)) continue
    seen.add(key)
    links.push(url)
    if (links.length >= 16) break
  }
  return links
}
