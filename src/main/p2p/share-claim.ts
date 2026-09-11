import { normalizeInfoHash } from '../../shared/content-address'

/**
 * Share-claim v1 — exact message format locked with Tracker.
 *
 * seederPubkey: lowercase hex 64 chars (raw Ed25519 pubkey)
 * message UTF-8 (exactly 5 lines; no trailing newline after ts):
 *   f95-gm:share:v1
 *   contentHash=<hexSHA256>
 *   infoHash=<hexSHA1 or empty>
 *   normalizedName=<name>
 *   ts=<unixSeconds>
 * signature: standard base64 of raw 64-byte Ed25519 sig over message bytes
 *
 * Metadata may accept without verify for now; clients should keep |skew| ≤ 300s later.
 */

export type ShareClaimV1Input = {
  contentHash: string
  infoHash?: string | null
  normalizedName: string
  /** unix seconds; defaults to now */
  ts?: number
}

export function buildShareClaimMessage(input: ShareClaimV1Input): string {
  const contentHash = input.contentHash.trim().toLowerCase()
  const infoHash = normalizeInfoHash(input.infoHash) ?? ''
  const normalizedName = input.normalizedName
  const ts = input.ts ?? Math.floor(Date.now() / 1000)
  // Exact 5 lines, no trailing newline after ts line
  return [
    'f95-gm:share:v1',
    `contentHash=${contentHash}`,
    `infoHash=${infoHash}`,
    `normalizedName=${normalizedName}`,
    `ts=${ts}`
  ].join('\n')
}

export type ShareClaimPostBody = {
  contentHash: string
  infoHash: string
  normalizedName: string
  seederPubkey: string
  ts: number
  signature: string
  gameName?: string
  gameVersion?: string | null
  f95ThreadId?: number | string | null
  f95ThreadUrl?: string | null
  sizeBytes?: number
}
