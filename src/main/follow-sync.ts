import type { CatalogGame, FollowSyncStatus, Subscription } from '@shared/types'
import { fetchCatalog } from './f95/catalog'
import { F95Error } from './f95/errors'
import { fetchLatestRss, type RssGameUpdate } from './f95/rss'
import { sleep } from './f95/parse'
import {
  advanceLastSeenCatalogUpdate,
  applyCatalogGames,
  getLastSeenCatalogUpdate,
  listSubscriptions,
  refreshSubscription
} from './subscriptions-store'
import { sendToRenderer } from './windows'

const RSS_POLL_MS = 5 * 60 * 1000
const RATE_LIMIT_BACKOFF_MS = 45 * 60 * 1000
const LOOKUP_DELAY_MS = 1000
const CATALOG_PAGE_DELAY_MS = 500
const STALE_MS = 24 * 60 * 60 * 1000

type SyncMode = 'rss' | 'manual' | 'catchup'

let timer: ReturnType<typeof setTimeout> | null = null
let started = false
let chain: Promise<unknown> = Promise.resolve()
let nextDelay = RSS_POLL_MS
let cancelRequested = false

const status: FollowSyncStatus = {
  running: false,
  lastRunAt: null,
  lastError: null,
  checked: 0,
  updated: 0,
  pending: 0,
  cancelled: false
}

function wasCancelled(): boolean {
  return cancelRequested
}

/** Interruptible delay so Stop can take effect between catalog pages without waiting out the full backoff. */
async function sleepUnlessCancelled(ms: number): Promise<boolean> {
  const step = 50
  let left = ms
  while (left > 0) {
    if (cancelRequested) return false
    await sleep(Math.min(step, left))
    left -= step
  }
  return !cancelRequested
}

function broadcastStatus(): void {
  sendToRenderer('follow-sync:status', { ...status })
}

export function getFollowSyncStatus(): FollowSyncStatus {
  return { ...status }
}

function isStale(game: Subscription, now = Date.now()): boolean {
  return !game.checkedAt || now - game.checkedAt >= STALE_MS
}

function rssNeedsRefresh(game: Subscription, update: RssGameUpdate, now = Date.now()): boolean {
  if (!game.checkedAt) return true
  if (update.timestamp && update.timestamp > game.checkedAt) return true
  if (update.timestamp && update.timestamp > (game.timestamp || 0)) return true
  return isStale(game, now)
}

async function refreshQueue(threadIds: number[]): Promise<number> {
  status.pending = threadIds.length
  status.checked = threadIds.length
  broadcastStatus()

  let updated = 0
  for (const [index, threadId] of threadIds.entries()) {
    if (wasCancelled()) break
    try {
      await refreshSubscription(threadId)
      updated += 1
    } catch (error) {
      if (error instanceof F95Error && error.code === 'rate_limited') throw error
      status.lastError = error instanceof Error ? error.message : 'Could not refresh a followed game.'
    }
    status.pending = Math.max(0, threadIds.length - index - 1)
    status.updated = updated
    broadcastStatus()
    if (index < threadIds.length - 1 && !(await sleepUnlessCancelled(LOOKUP_DELAY_MS))) break
  }

  return updated
}

/**
 * After shutdown, walk date-sorted catalog pages from newest until past the
 * stored watermark (strictly older than last seen, so equal timestamps are included).
 */
async function catalogCatchUp(): Promise<number> {
  const lastSeen = await getLastSeenCatalogUpdate()
  let page = 1
  let matched = 0
  let newestOnTop = 0
  let done = false

  while (!done) {
    if (wasCancelled()) break
    const result = await fetchCatalog({ page, rows: 90, sort: 'date' })
    if (wasCancelled()) break
    if (!result.games.length) break

    if (page === 1) {
      for (const game of result.games) {
        if (game.timestamp > newestOnTop) newestOnTop = game.timestamp
      }
    }

    if (!lastSeen) {
      // First run: seed watermark from the top page; do not crawl the whole catalog.
      matched += await applyCatalogGames(result.games)
      done = true
      break
    }

    const batch: CatalogGame[] = []
    let sawOlder = false
    for (const game of result.games) {
      if (game.timestamp < lastSeen) {
        sawOlder = true
        break
      }
      batch.push(game)
    }

    if (batch.length) matched += await applyCatalogGames(batch)

    status.checked = matched
    status.updated = matched
    status.pending = sawOlder || page >= result.totalPages ? 0 : 1
    broadcastStatus()

    if (sawOlder || page >= result.totalPages) {
      done = true
    } else {
      page += 1
      if (!(await sleepUnlessCancelled(CATALOG_PAGE_DELAY_MS))) break
    }
  }

  if (newestOnTop && !wasCancelled()) await advanceLastSeenCatalogUpdate(newestOnTop)
  return matched
}

/**
 * Manual refresh: walk date-sorted catalog pages (90 rows) from newest until every
 * followed game has been seen, or past the oldest followed update timestamp.
 */
async function catalogRefreshFollowed(): Promise<number> {
  const games = await listSubscriptions()
  if (!games.length) return 0

  const remaining = new Set(games.map((game) => game.threadId))
  let oldestCutoff = 0
  for (const game of games) {
    const at = game.timestamp || 0
    if (at > 0 && (oldestCutoff === 0 || at < oldestCutoff)) oldestCutoff = at
  }

  let page = 1
  let found = 0

  status.checked = 0
  status.updated = 0
  status.pending = remaining.size
  broadcastStatus()

  while (remaining.size > 0) {
    if (wasCancelled()) break
    const result = await fetchCatalog({ page, rows: 90, sort: 'date' })
    if (wasCancelled()) break
    if (!result.games.length) break

    const batch: CatalogGame[] = []
    let pastCutoff = false
    for (const game of result.games) {
      if (oldestCutoff > 0 && game.timestamp > 0 && game.timestamp < oldestCutoff) {
        pastCutoff = true
        break
      }
      batch.push(game)
      if (remaining.delete(game.threadId)) found += 1
    }

    if (batch.length) await applyCatalogGames(batch)

    status.checked = found
    status.updated = found
    status.pending = remaining.size
    broadcastStatus()

    if (pastCutoff || page >= result.totalPages || remaining.size === 0) break
    page += 1
    if (!(await sleepUnlessCancelled(CATALOG_PAGE_DELAY_MS))) break
  }

  status.pending = 0
  return found
}

async function doRun(mode: SyncMode): Promise<FollowSyncStatus> {
  cancelRequested = false
  status.running = true
  status.lastError = null
  status.checked = 0
  status.updated = 0
  status.pending = 0
  status.cancelled = false
  broadcastStatus()
  try {
    if (mode === 'catchup') {
      status.updated = await catalogCatchUp()
      status.checked = status.updated
      status.lastRunAt = Date.now()
      nextDelay = RSS_POLL_MS
    } else if (mode === 'manual') {
      status.updated = await catalogRefreshFollowed()
      status.checked = status.updated
      status.lastRunAt = Date.now()
      nextDelay = RSS_POLL_MS
    } else {
      const games = await listSubscriptions()
      if (wasCancelled()) {
        status.lastRunAt = Date.now()
      } else {
        const updates = await fetchLatestRss()
        if (wasCancelled()) {
          status.lastRunAt = Date.now()
        } else {
          const followed = new Map(games.map((game) => [game.threadId, game]))
          const queue = updates
            .filter((update) => {
              const game = followed.get(update.threadId)
              return game ? rssNeedsRefresh(game, update) : false
            })
            .map((update) => update.threadId)
          status.updated = await refreshQueue(queue)
          status.lastRunAt = Date.now()
        }
      }
      nextDelay = RSS_POLL_MS
    }
    status.cancelled = wasCancelled()
  } catch (error) {
    const rateLimited = error instanceof F95Error && error.code === 'rate_limited'
    status.lastError = error instanceof Error ? error.message : 'Followed-game check failed.'
    status.lastRunAt = Date.now()
    status.cancelled = wasCancelled()
    if (rateLimited) nextDelay = RATE_LIMIT_BACKOFF_MS
  } finally {
    cancelRequested = false
    status.running = false
    status.pending = 0
    broadcastStatus()
  }
  return getFollowSyncStatus()
}

function runFollowSync(mode: SyncMode): Promise<FollowSyncStatus> {
  const run = chain.then(() => doRun(mode))
  chain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

/** Refresh all followed titles from catalog pages (manual toolbar button). */
export function checkStaleFollowed(): Promise<FollowSyncStatus> {
  return runFollowSync('manual')
}

/** Request the in-flight sync to stop after the current catalog/network step. */
export function cancelFollowSyncRun(): FollowSyncStatus {
  if (!status.running) return getFollowSyncStatus()
  cancelRequested = true
  status.cancelled = true
  broadcastStatus()
  return getFollowSyncStatus()
}

export function startFollowSync(): Promise<FollowSyncStatus> {
  const run = runFollowSync('catchup')
  if (!started) {
    started = true
    void run.finally(scheduleNext)
  }
  return run
}

function scheduleNext(): void {
  if (!started) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void runFollowSync('rss').finally(scheduleNext)
  }, nextDelay)
}

export function stopFollowSync(): void {
  started = false
  cancelRequested = true
  if (!timer) return
  clearTimeout(timer)
  timer = null
}
