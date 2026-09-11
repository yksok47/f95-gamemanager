/**
 * Content-address helpers for package matching.
 * contentHash = SHA-256 of file bytes (see main/hash.ts) — NOT WebTorrent infoHash.
 */

/** Lowercase basename, collapse whitespace, strip unsafe path/filename chars. */
export function normalizePackageFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '').trim().toLowerCase()
  return base
    .replace(/\s+/g, ' ')
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .trim()
}

export function isContentHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

export function isInfoHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{40}$/i.test(value)
}

/**
 * Normalize to lowercase 40-char hex infoHash for metadata/share POSTs and UI.
 * Accepts bare hex or urn:btih:<hex>. Base32 conversion stays in the WT client (Buffer).
 */
export function normalizeInfoHash(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const bare = trimmed.replace(/^urn:btih:/i, '').trim()
  if (/^[a-f0-9]{40}$/i.test(bare)) return bare.toLowerCase()
  return null
}
