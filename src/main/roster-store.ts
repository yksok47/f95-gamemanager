import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { CatalogGame, RosterGame } from '@shared/types'
import { pickLikeCount, pickViewCount, saneLikeCount, saneViewCount } from '@shared/counts'
import { catalogTimestamp } from '@shared/updates'
import { uniqueScreenUrls } from './f95/catalog'
import { getAppPaths } from './paths'
import { sendToRenderer } from './windows'

type RosterFile = {
  version: 1
  games: RosterGame[]
}

let loaded: RosterGame[] | null = null
let writeChain: Promise<void> = Promise.resolve()

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
    addedAt: Number(raw.addedAt) || Date.now()
  }
}

function sortRoster(games: RosterGame[]): RosterGame[] {
  return [...games].sort((a, b) => b.addedAt - a.addedAt || b.threadId - a.threadId)
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

async function writeStore(games: RosterGame[]): Promise<RosterGame[]> {
  loaded = games
  const listed = sortRoster(games)
  writeChain = writeChain
    .then(() => persist(games))
    .catch((error) => {
      console.warn('[roster] persist failed', error)
    })
  await writeChain
  sendToRenderer('roster:changed', listed)
  return listed
}

export async function listRoster(): Promise<RosterGame[]> {
  const games = await readStore()
  return sortRoster(games)
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
  const games = await readStore()
  const index = games.findIndex((item) => item.threadId === next.threadId)
  if (index >= 0) {
    games.splice(index, 1)
  } else {
    games.push(next)
  }
  return writeStore(games)
}

export async function removeFromRoster(threadId: number): Promise<RosterGame[]> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Invalid thread id.')
  }
  const games = (await readStore()).filter((game) => game.threadId !== id)
  return writeStore(games)
}

/** Refresh stored roster snapshots when catalog rows are already in hand. */
export async function applyCatalogGamesToRoster(games: CatalogGame[]): Promise<number> {
  if (!games.length) return 0
  const stored = await readStore()
  if (!stored.length) return 0
  const byId = new Map(games.map((game) => [game.threadId, game]))
  let changed = 0
  for (let i = 0; i < stored.length; i += 1) {
    const incoming = byId.get(stored[i].threadId)
    if (!incoming) continue
    const merged = mergeRosterSnapshot(stored[i], incoming)
    if (JSON.stringify(merged) !== JSON.stringify(stored[i])) {
      stored[i] = merged
      changed += 1
    }
  }
  if (changed) await writeStore(stored)
  return changed
}
