/** F95 likes never reach timestamp-scale values; those are scrape bugs. */
export const MAX_LIKE_COUNT = 5_000_000
/** Even the biggest threads stay well under a unix timestamp. */
export const MAX_VIEW_COUNT = 500_000_000

function applyUnit(amountText: string, unit?: string): number {
  const amount = Number(amountText)
  if (!Number.isFinite(amount) || amount < 0) return 0
  const key = (unit || '').toLowerCase()
  const factor = key === 'k' ? 1e3 : key === 'm' ? 1e6 : key === 'b' ? 1e9 : 1
  const value = Math.round(amount * factor)
  return Number.isFinite(value) ? value : 0
}

/**
 * Parse one count such as `1,234`, `12K`, or `1.2M`.
 * Never concatenates every digit in a blob of text (that produced billion-like junk).
 */
export function parseCountText(value: string | undefined | null): number {
  if (!value) return 0
  const text = value.replace(/,/g, '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return 0

  const whole = text.match(/^([\d.]+)\s*([kmb])?$/i)
  if (whole) return applyUnit(whole[1], whole[2])

  const others = text.match(/\band\s+([\d.]+)\s+others\b/i)
  if (others) return applyUnit(others[1])

  if (text.length <= 48) {
    const compact = text.match(/([\d.]+)\s*([kmb])\b/i)
    if (compact && !text.match(/[\d.]+.*[\d.]/)) return applyUnit(compact[1], compact[2])
    const lone = text.match(/^.*?([\d.]+)\s*$/)
    if (lone && !text.match(/[\d.]+.*[\d.]/)) return applyUnit(lone[1])
  }

  return 0
}

export function saneCount(value: number | string | undefined | null, max: number): number {
  const n = typeof value === 'string' ? parseCountText(value) : Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  if (n >= 1e9 || n > max) return 0
  return Math.round(n)
}

export function saneLikeCount(value: number | string | undefined | null): number {
  return saneCount(value, MAX_LIKE_COUNT)
}

export function saneViewCount(value: number | string | undefined | null): number {
  return saneCount(value, MAX_VIEW_COUNT)
}

export function pickLikeCount(...values: Array<number | string | undefined | null>): number {
  for (const value of values) {
    const n = saneLikeCount(value)
    if (n) return n
  }
  return 0
}

export function pickViewCount(...values: Array<number | string | undefined | null>): number {
  for (const value of values) {
    const n = saneViewCount(value)
    if (n) return n
  }
  return 0
}

export function maxLikeCount(...values: Array<number | string | undefined | null>): number {
  return values.reduce<number>((max, value) => Math.max(max, saneLikeCount(value)), 0)
}

export function maxViewCount(...values: Array<number | string | undefined | null>): number {
  return values.reduce<number>((max, value) => Math.max(max, saneViewCount(value)), 0)
}
