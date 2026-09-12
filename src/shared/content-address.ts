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

function bytesToHex(bytes: Uint8Array): string | null {
  if (bytes.byteLength !== 20) return null
  let hex = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0')
  }
  return hex
}

/**
 * Normalize to lowercase 40-char hex infoHash for metadata/share POSTs and UI.
 * Accepts bare hex, urn:btih:<hex>, or a 20-byte Buffer/Uint8Array from WebTorrent.
 */
export function normalizeInfoHash(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    const bare = trimmed.replace(/^urn:btih:/i, '').trim()
    if (/^[a-f0-9]{40}$/i.test(bare)) return bare.toLowerCase()
    return null
  }
  if (value instanceof Uint8Array) return bytesToHex(value)
  if (value && typeof value === 'object' && ArrayBuffer.isView(value)) {
    const view = value as ArrayBufferView
    return bytesToHex(new Uint8Array(view.buffer, view.byteOffset, view.byteLength))
  }
  return null
}
