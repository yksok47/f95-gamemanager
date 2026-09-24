import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { CatalogGame, RosterGame } from '@shared/types'
import { pickLikeCount, pickViewCount, saneLikeCount, saneViewCount } from '@shared/counts'
import { catalogTimestamp } from '@shared/updates'
import { uniqueScreenUrls } from './f95/catalog'
import { getAppPaths } from './paths'
import { sendToRenderer } from './windows'
import { notifyUserDataChanged } from './cloud-user-data/notify'
import { tombstoneRoster, touchRoster, touchRosterMany } from './cloud-user-data/state'

type RosterFile = {
  version: 1
  games: RosterGame[]
}

let loaded: RosterGame[] | null = null
let writeChain: Promise<void> = Promise.resolve()
let writeGen = 0

function empty(): RosterGame[] {
  return []
}

function asIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is number => Number.isFinite(id))
}

function normalizeGame(value: unknown): RosterGame | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<RosterGame>
  const threadId = Number(raw.threadId)
  if (!Number.isFinite(threadId) || threadId <= 0) return null
  const title = typeof raw.title === 'string' ? raw.title : ''
  return {
    threadId,
    title,
    creator: typeof raw.creator === 'string' ? raw.creator : '',
    version: typeof raw.version === 'string' ? raw.version : '',
    coverUrl: typeof raw.coverUrl === 'string' && raw.coverUrl ? raw.coverUrl : null,
    rating: Number(raw.rating) || 0,
    likes: saneLikeCount(raw.likes),
    views: saneViewCount(raw.views),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    timestamp: catalogTimestamp(raw.timestamp),
    threadUrl:
      typeof raw.threadUrl === 'string' && raw.threadUrl
        ? raw.threadUrl
        : `https://f95zone.to/threads/${threadId}/`,
    prefixes: asIdList(raw.prefixes),
    tags: asIdList(raw.tags),
    screens: uniqueScreenUrls(raw.screens),
    engine: typeof raw.engine === 'string' ? raw.engine : '',
    addedAt: Number(raw.addedAt) || Date.now(),
    ...(Number.isFinite(Number(raw.order)) ? { order: Number(raw.order) } : {})
  }
}

/** Games without a saved position stay at the front, newest first. Saved positions follow. */
function compareManual(a: RosterGame, b: RosterGame): number {
  const aOrdered = Number.isFinite(a.order)
  const bOrdered = Number.isFinite(b.order)
  if (aOrdered !== bOrdered) return aOrdered ? 1 : -1
  if (aOrdered && bOrdered && a.order !== b.order) return (a.order as number) - (b.order as number)
  return b.addedAt - a.addedAt || b.threadId - a.threadId
}

function assignOrder(games: RosterGame[]): RosterGame[] {
  return games.map((game, index) => (game.order === index ? game : { ...game, order: index }))
}

function arrangeRoster(games: RosterGame[]): RosterGame[] {
  return assignOrder([...games].sort(compareManual))
}

export function rosterFromCatalog(game: CatalogGame, addedAt = Date.now()): RosterGame {
  const threadId = Number(game.threadId)
  return {
    threadId,
    title: (game.title || '').trim(),
    creator: (game.creator || '').trim(),
    version: (game.version || '').trim(),
    coverUrl: game.coverUrl || null,
    rating: Number(game.rating) || 0,
    likes: saneLikeCount(game.likes),
    views: saneViewCount(game.views),
    updatedAt: game.updatedAt || '',
    timestamp: catalogTimestamp(game.timestamp),
    threadUrl: game.threadUrl || `https://f95zone.to/threads/${threadId}/`,
    prefixes: asIdList(game.prefixes),
    tags: asIdList(game.tags),
    screens: uniqueScreenUrls(game.screens),
    engine: game.engine || '',
    addedAt
  }
}

function mergeRosterSnapshot(existing: RosterGame, incoming: CatalogGame): RosterGame {
  const next = rosterFromCatalog(incoming, existing.addedAt)
  return {
    ...existing,
    title: next.title || existing.title,
    creator: next.creator || existing.creator,
    version: next.version || existing.version,
    coverUrl: next.coverUrl || existing.coverUrl,
    rating: next.rating || existing.rating,
    likes: pickLikeCount(next.likes, existing.likes),
    views: pickViewCount(next.views, existing.views),
    updatedAt: next.updatedAt || existing.updatedAt,
    timestamp: next.timestamp || existing.timestamp,
    threadUrl: next.threadUrl || existing.threadUrl,
    prefixes: next.prefixes.length ? next.prefixes : existing.prefixes,
    tags: next.tags.length ? next.tags : existing.tags,
    screens: next.screens.length ? next.screens : existing.screens,
    engine: next.engine || existing.engine
  }
}

async function readStore(): Promise<RosterGame[]> {
  if (loaded) return loaded
  try {
    const raw = await readFile(getAppPaths().rosterFile, 'utf8')
    const parsed = JSON.parse(raw) as RosterFile | RosterGame[]
    const stored = Array.isArray(parsed) ? parsed : parsed.games ?? []
    loaded = stored.map(normalizeGame).filter((game): game is RosterGame => Boolean(game))
  } catch {
    loaded = empty()
  }
  return loaded
}

async function persist(games: RosterGame[]): Promise<void> {
  const file = getAppPaths().rosterFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ version: 1, games }, null, 2), 'utf8')
}

async function writeStore(games: RosterGame[], keepOrder = false): Promise<RosterGame[]> {
  const listed = keepOrder ? assignOrder(games) : arrangeRoster(games)
  loaded = listed
  const gen = ++writeGen
  writeChain = writeChain
    .then(() => persist(listed))
    .catch((error) => {
      console.warn('[roster] persist failed', error)
    })
  await writeChain
  if (gen === writeGen) sendToRenderer('roster:changed', loaded)
  return loaded ?? listed
}

export async function listRoster(): Promise<RosterGame[]> {
  const games = await readStore()
  return arrangeRoster(games)
}

export async function reorderRoster(threadIds: number[]): Promise<RosterGame[]> {
  const games = await readStore()
  const byId = new Map(games.map((game) => [game.threadId, game]))
  const next: RosterGame[] = []
  const seen = new Set<number>()
  for (const raw of threadIds) {
    const id = Number(raw)
    const game = byId.get(id)
    if (!game || seen.has(id)) continue
    next.push(game)
    seen.add(id)
  }
  for (const game of arrangeRoster(games)) {
    if (!seen.has(game.threadId)) next.push(game)
  }
  const ordered = assignOrder(next)
  const moved = ordered
    .filter((game) => byId.get(game.threadId)?.order !== game.order)
    .map((game) => game.threadId)
  if (moved.length) await touchRosterMany(moved)
  const listed = await writeStore(ordered, true)
  if (moved.length) notifyUserDataChanged('data')
  return listed
}

export async function isOnRoster(threadId: number): Promise<boolean> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) return false
  const games = await readStore()
  return games.some((game) => game.threadId === id)
}

export async function toggleRoster(game: CatalogGame): Promise<RosterGame[]> {
  const next = rosterFromCatalog(game)
  if (!Number.isFinite(next.threadId) || next.threadId <= 0) {
    throw new Error('Invalid thread id.')
  }
  const games = [...(await readStore())]
  const index = games.findIndex((item) => item.threadId === next.threadId)
  if (index >= 0) {
    games.splice(index, 1)
    await tombstoneRoster(next.threadId)
  } else {
    games.push(next)
    await touchRoster(next.threadId)
  }
  const listed = await writeStore(games)
  notifyUserDataChanged('data')
  return listed
}

export async function removeFromRoster(threadId: number): Promise<RosterGame[]> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Invalid thread id.')
  }
  const games = (await readStore()).filter((game) => game.threadId !== id)
  await tombstoneRoster(id)
  const listed = await writeStore(games)
  notifyUserDataChanged('data')
  return listed
}

export async function replaceRoster(games: RosterGame[]): Promise<void> {
  await writeStore(games)
}

/** Refresh stored roster snapshots when catalog rows are already in hand. */
export async function applyCatalogGamesToRoster(games: CatalogGame[]): Promise<number> {
  if (!games.length) return 0
  const stored = await readStore()
  if (!stored.length) return 0
  const byId = new Map(games.map((game) => [game.threadId, game]))
  const changedIds: number[] = []
  for (const item of stored) {
    const incoming = byId.get(item.threadId)
    if (!incoming) continue
    const merged = mergeRosterSnapshot(item, incoming)
    if (JSON.stringify(merged) !== JSON.stringify(item)) changedIds.push(item.threadId)
  }
  if (!changedIds.length) return 0
  const latest = await readStore()
  const next = latest.map((item) => {
    const incoming = byId.get(item.threadId)
    if (!incoming) return item
    return mergeRosterSnapshot(item, incoming)
  })
  await writeStore(next, true)
  return changedIds.length
}
