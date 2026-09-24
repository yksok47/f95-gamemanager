import type { FollowSyncStatus } from '@shared/types'
import {
  catalogPagePastTimestamp,
  followedTimestampCutoff,
  newestCatalogTimestamp
} from './catalog-scan'
import { fetchCatalog } from './f95/catalog'
import { F95Error } from './f95/errors'
import { sleep } from './f95/parse'
import {
  advanceLastSeenCatalogUpdate,
  applyCatalogGames,
  getLastSeenCatalogUpdate,
  listSubscriptions
} from './subscriptions-store'
import { sendToRenderer } from './windows'

const FOLLOW_POLL_MS = 5 * 60 * 1000
const RATE_LIMIT_BACKOFF_MS = 45 * 60 * 1000
const CATALOG_PAGE_DELAY_MS = 500

type SyncMode = 'manual' | 'catchup'

let timer: ReturnType<typeof setTimeout> | null = null
let started = false
let chain: Promise<unknown> = Promise.resolve()
let nextDelay = FOLLOW_POLL_MS
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

/**
 * After shutdown, walk date-sorted catalog pages from newest until past the
 * stored watermark (strictly older than last seen, so equal timestamps are included).
 * With no watermark yet, walk until every followed game has been seen or until
 * past the oldest followed timestamp — never stop just because the newest row
 * is a game we already follow.
 */
async function catalogCatchUp(): Promise<number> {
  const lastSeen = await getLastSeenCatalogUpdate()
  const followed = lastSeen ? [] : await listSubscriptions()
  const pendingIds = new Set(followed.map((game) => game.threadId))
  const cutoff = followedTimestampCutoff(followed.map((game) => game.timestamp))

  let page = 1
  let matched = 0
  let newestOnTop = 0
  let covered = false

  while (true) {
    if (wasCancelled()) break
    const result = await fetchCatalog({ page, rows: 90, sort: 'date' })
    if (wasCancelled()) break
    if (!result.games.length) break

    if (page === 1) newestOnTop = newestCatalogTimestamp(result.games)

    matched += await applyCatalogGames(result.games)

    let done = page >= result.totalPages
    if (!done && lastSeen) {
      done = catalogPagePastTimestamp(result.games, lastSeen)
    } else if (!done) {
      for (const game of result.games) pendingIds.delete(game.threadId)
      const pastOldest = cutoff > 0 && catalogPagePastTimestamp(result.games, cutoff)
      done = pendingIds.size === 0 || pastOldest
    }

    status.checked = matched
    status.updated = matched
    status.pending = done ? 0 : lastSeen ? 1 : pendingIds.size
    broadcastStatus()

    if (done) {
      covered = true
      break
    }
    page += 1
    if (!(await sleepUnlessCancelled(CATALOG_PAGE_DELAY_MS))) break
  }

  if (newestOnTop && covered && !wasCancelled()) await advanceLastSeenCatalogUpdate(newestOnTop)
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
  const cutoff = followedTimestampCutoff(games.map((game) => game.timestamp))

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

    await applyCatalogGames(result.games)
    for (const game of result.games) {
      if (remaining.delete(game.threadId)) found += 1
    }

    status.checked = found
    status.updated = found
    status.pending = remaining.size
    broadcastStatus()

    const pastOldest = cutoff > 0 && catalogPagePastTimestamp(result.games, cutoff)
    if (pastOldest || page >= result.totalPages || remaining.size === 0) break
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
      nextDelay = FOLLOW_POLL_MS
    } else {
      status.updated = await catalogRefreshFollowed()
      status.checked = status.updated
      status.lastRunAt = Date.now()
      nextDelay = FOLLOW_POLL_MS
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
    void runFollowSync('catchup').finally(scheduleNext)
  }, nextDelay)
}

export function stopFollowSync(): void {
  started = false
  cancelRequested = true
  if (!timer) return
  clearTimeout(timer)
  timer = null
}
