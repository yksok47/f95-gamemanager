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
