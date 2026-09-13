/**
 * Parse helpers for WebSocket tracker scrape (binary ↔ hex infoHash).
 * Kept free of ws/env imports so unit tests can run under bun.
 */
import { normalizeInfoHash } from '../../shared/content-address'

type ScrapeFile = {
  complete?: number
  incomplete?: number
}

/** Hex infoHash → 20-byte binary string for WS tracker scrape/announce. */
export function hexInfoHashToBinary(hex: string): string | null {
  const normalized = normalizeInfoHash(hex)
  if (!normalized) return null
  return Buffer.from(normalized, 'hex').toString('binary')
}

export function toHexInfoHash(key: unknown): string | null {
  if (typeof key === 'string') {
    const hex = normalizeInfoHash(key)
    if (hex) return hex
    if (key.length === 20) return Buffer.from(key, 'latin1').toString('hex')
    return null
  }
  if (Buffer.isBuffer(key) || key instanceof Uint8Array) {
    return Buffer.from(key).toString('hex')
  }
  return null
}

export function scrapeCounts(files: Record<string, ScrapeFile> | undefined): Map<string, number> {
  const out = new Map<string, number>()
  if (!files) return out
  for (const [key, file] of Object.entries(files)) {
    const hash = toHexInfoHash(key)
    if (!hash) continue
    const n = Number(file?.complete)
    out.set(hash, Number.isFinite(n) ? Math.max(0, n) : 0)
  }
  return out
}
