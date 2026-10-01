import { catalogTimestamp } from '@shared/updates'

/**
 * Bump when a stored catalog watermark can no longer be trusted.
 * Older builds could set the watermark to the single newest row (often a game
 * just followed) and then skip every older update.
 */
export const CATALOG_SCAN_VERSION = 2

type DatedRow = {
  timestamp: number
}

/** Drop a watermark written by an older scan. Version 2+ values are kept. */
export function catalogWatermarkFromStore(
  storedVersion: number | undefined,
  storedWatermark: number | undefined
): number {
  if ((storedVersion ?? 0) < CATALOG_SCAN_VERSION) return 0
  return catalogTimestamp(storedWatermark)
}

export function newestCatalogTimestamp(games: DatedRow[]): number {
  let newest = 0
  for (const game of games) {
    const at = catalogTimestamp(game.timestamp)
    if (at > newest) newest = at
  }
  return newest
}

/**
 * True when this date-sorted page is entirely behind `bound`.
 * A missing timestamp does not count, so one undated or out-of-order row
 * cannot end the scan while a later row is still new enough.
 * Equal timestamps are not past the bound.
 */
export function catalogPagePastTimestamp(games: DatedRow[], bound: number): boolean {
  const limit = catalogTimestamp(bound)
  if (!limit) return false
  let newest = 0
  let dated = 0
  for (const game of games) {
    const at = catalogTimestamp(game.timestamp)
    if (!at) continue
    dated += 1
    if (at > newest) newest = at
  }
  return dated > 0 && newest < limit
}

/**
 * Newest timestamp on a date-sorted head page that still overlaps `lastSeen`.
 * Returns 0 when the page must not move the watermark: no previous watermark,
 * the page never reaches it, or a newer row shows up after an older one
 * (the page is not a continuous prefix, so later pages may still be relevant).
 */
export function watermarkFromHeadPage(games: DatedRow[], lastSeen: number): number {
  const watermark = catalogTimestamp(lastSeen)
  if (!watermark) return 0
  let newest = 0
  let crossed = false
  for (const game of games) {
    const at = catalogTimestamp(game.timestamp)
    if (!at) continue
    if (at >= watermark) {
      if (crossed) return 0
      if (at > newest) newest = at
    } else {
      crossed = true
    }
  }
  if (!crossed || !newest) return 0
  return newest
}

/**
 * Oldest followed `checkedAt`. Never-checked games are skipped so they cannot
 * force a full catalog walk when reseeding a missing watermark.
 */
export function oldestFollowedCheckAt(times: Array<number | null | undefined>): number {
  let oldest = 0
  for (const value of times) {
    const at = catalogTimestamp(value)
    if (!at) continue
    if (!oldest || at < oldest) oldest = at
  }
  return oldest
}

/**
 * How far catch-up must walk: the stored watermark, or the oldest followed
 * check when reseeding after the watermark is gone.
 */
export function catalogCatchUpBound(lastSeen: number, seedUntil = 0): number {
  return catalogTimestamp(lastSeen) || catalogTimestamp(seedUntil)
}

/**
 * Automatic catch-up (app start / poll) stops after the newest page when there
 * is no watermark and nothing to reseed from. Otherwise it walks until the
 * page is older than the bound — a missing watermark uses the oldest followed
 * check so we do not have to see every followed game again.
 */
export function catalogCatchUpDone(
  page: number,
  totalPages: number,
  games: DatedRow[],
  lastSeen: number,
  seedUntil = 0
): boolean {
  if (page >= totalPages) return true
  const bound = catalogCatchUpBound(lastSeen, seedUntil)
  if (!bound) return true
  return catalogPagePastTimestamp(games, bound)
}

/** True when catch-up actually covered a bound and may write a new watermark. */
export function catalogCatchUpShouldSeed(
  newestOnTop: number,
  covered: boolean,
  cancelled: boolean,
  lastSeen: number,
  seedUntil = 0
): boolean {
  if (!newestOnTop || !covered || cancelled) return false
  return Boolean(catalogCatchUpBound(lastSeen, seedUntil))
}

/**
 * Oldest followed update that is safe to stop at.
 * If any followed game has no timestamp, return 0: a newly followed title
 * (the only dated row, and the latest one) must not become the cutoff.
 */
export function followedTimestampCutoff(timestamps: Array<number | null | undefined>): number {
  if (!timestamps.length) return 0
  let oldest = 0
  for (const value of timestamps) {
    const at = catalogTimestamp(value)
    if (!at) return 0
    if (!oldest || at < oldest) oldest = at
  }
  return oldest
}
