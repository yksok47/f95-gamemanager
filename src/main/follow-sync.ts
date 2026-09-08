import type { FollowSyncStatus, Subscription } from '@shared/types'
import { F95Error } from './f95/errors'
import { fetchLatestRss, type RssGameUpdate } from './f95/rss'
import { sleep } from './f95/parse'
import { listSubscriptions, refreshSubscription } from './subscriptions-store'
import { sendToRenderer } from './windows'

const RSS_POLL_MS = 15 * 60 * 1000
const RATE_LIMIT_BACKOFF_MS = 45 * 60 * 1000
const LOOKUP_DELAY_MS = 1000
const STALE_MS = 24 * 60 * 60 * 1000

type SyncMode = 'rss' | 'manual'

let timer: ReturnType<typeof setTimeout> | null = null
let started = false
let chain: Promise<unknown> = Promise.resolve()
let nextDelay = RSS_POLL_MS

const status: FollowSyncStatus = {
  running: false,
  lastRunAt: null,
  lastError: null,
  checked: 0,
  updated: 0,
  pending: 0
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
    if (index < threadIds.length - 1) await sleep(LOOKUP_DELAY_MS)
  }

  return updated
}

async function doRun(mode: SyncMode): Promise<FollowSyncStatus> {
  status.running = true
  status.lastError = null
  status.checked = 0
  status.updated = 0
  status.pending = 0
  broadcastStatus()
  try {
    const games = await listSubscriptions()
    let queue: number[]
    if (mode === 'manual') {
      queue = games.filter((game) => isStale(game)).map((game) => game.threadId)
    } else {
      const updates = await fetchLatestRss()
      const followed = new Map(games.map((game) => [game.threadId, game]))
      queue = updates
        .filter((update) => {
          const game = followed.get(update.threadId)
          return game ? rssNeedsRefresh(game, update) : false
        })
        .map((update) => update.threadId)
    }
    status.updated = await refreshQueue(queue)
    status.lastRunAt = Date.now()
    nextDelay = RSS_POLL_MS
  } catch (error) {
    const rateLimited = error instanceof F95Error && error.code === 'rate_limited'
    status.lastError = error instanceof Error ? error.message : 'Followed-game check failed.'
    status.lastRunAt = Date.now()
    if (rateLimited) nextDelay = RATE_LIMIT_BACKOFF_MS
  } finally {
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

export function checkStaleFollowed(): Promise<FollowSyncStatus> {
  return runFollowSync('manual')
}

export function startFollowSync(): Promise<FollowSyncStatus> {
  const run = runFollowSync('rss')
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
  if (!timer) return
  clearTimeout(timer)
  timer = null
}
