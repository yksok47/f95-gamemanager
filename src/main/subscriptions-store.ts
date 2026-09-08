import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { GAME_RARITIES, type CatalogGame, type GameRarity, type Subscription, type SubscriptionSource } from '@shared/types'
import { engineFromTitle } from '@shared/engines'
import { engineFromPrefixIds } from '@shared/prefixes'
import { catalogTimestamp, isRelativeDate } from '@shared/updates'
import { uniqueScreenUrls } from './f95/catalog'
import { lookupGame, isWeakCover } from './f95/lookup'
import { pickLikeCount, pickViewCount, saneLikeCount, saneViewCount } from '@shared/counts'
import { parseGameTitle, sleep } from './f95/parse'
import { getAppPaths } from './paths'
import { sendToRenderer } from './windows'

let loaded: Subscription[] | null = null
const METADATA_CHECK_VERSION = 1
let metadataCheckVersion = 0

function isRarity(value: unknown): value is GameRarity {
  return typeof value === 'string' && GAME_RARITIES.includes(value as GameRarity)
}

function resolveEngine(game: {
  engine?: string
  prefixes?: number[]
  title?: string
}): string {
  return game.engine || engineFromPrefixIds(game.prefixes) || engineFromTitle(game.title || '')
}

function emptyDetails(): Pick<
  Subscription,
  | 'creator'
  | 'version'
  | 'coverUrl'
  | 'rating'
  | 'likes'
  | 'views'
  | 'updatedAt'
  | 'timestamp'
  | 'rarity'
  | 'tags'
  | 'prefixes'
  | 'engine'
  | 'lastPlayedVersion'
  | 'lastPlayedAt'
  | 'playtimeMs'
  | 'checkedAt'
  | 'screens'
> {
  return {
    creator: '',
    version: '',
    coverUrl: null,
    rating: 0,
    likes: 0,
    views: 0,
    updatedAt: '',
    timestamp: 0,
    rarity: 'regular',
    tags: [],
    prefixes: [],
    engine: '',
    lastPlayedVersion: '',
    lastPlayedAt: 0,
    playtimeMs: 0,
    checkedAt: 0,
    screens: []
  }
}

export function subscriptionFromCatalog(
  game: CatalogGame,
  source: SubscriptionSource,
  addedAt = Date.now()
): Subscription {
  return {
    threadId: game.threadId,
    title: game.title,
    creator: game.creator,
    version: game.version,
    coverUrl: game.coverUrl,
    rating: game.rating,
    likes: saneLikeCount(game.likes),
    views: saneViewCount(game.views),
    updatedAt: game.updatedAt,
    timestamp: game.timestamp,
    threadUrl: game.threadUrl,
    source,
    addedAt,
    rarity: 'regular',
    tags: game.tags ?? [],
    prefixes: game.prefixes ?? [],
    engine: resolveEngine(game),
    lastPlayedVersion: '',
    lastPlayedAt: 0,
    playtimeMs: 0,
    checkedAt: 0,
    screens: uniqueScreenUrls(game.screens)
  }
}

function needsDetails(game: Subscription): boolean {
  if (!game.coverUrl || isWeakCover(game.coverUrl) || !game.creator) return true
  const parsed = parseGameTitle(game.title)
  return parsed.title !== game.title.replace(/\s+/g, ' ').trim()
}

let enriching: Promise<Subscription[]> | null = null

async function readStore(): Promise<Subscription[]> {
  if (loaded) return loaded
  try {
    const raw = await readFile(getAppPaths().subscriptionsFile, 'utf8')
    const parsed = JSON.parse(raw) as
      | { games?: Subscription[]; metadataCheckVersion?: number }
      | Subscription[]
    const stored = Array.isArray(parsed) ? parsed : (parsed.games ?? [])
    metadataCheckVersion = Array.isArray(parsed) ? 0 : (parsed.metadataCheckVersion ?? 0)
    const resetChecks = metadataCheckVersion < METADATA_CHECK_VERSION
    loaded = stored.map((game) => ({
      ...emptyDetails(),
      ...game,
      rarity: isRarity(game.rarity) ? game.rarity : 'regular',
      tags: Array.isArray(game.tags) ? game.tags.filter((id) => Number.isFinite(id)) : [],
      prefixes: Array.isArray(game.prefixes) ? game.prefixes.filter((id) => Number.isFinite(id)) : [],
      engine: resolveEngine(game),
      lastPlayedVersion: typeof game.lastPlayedVersion === 'string' ? game.lastPlayedVersion : '',
      lastPlayedAt: Number(game.lastPlayedAt) || 0,
      playtimeMs: Number(game.playtimeMs) || 0,
      checkedAt: resetChecks ? 0 : Number(game.checkedAt) || 0,
      likes: saneLikeCount(game.likes),
      views: saneViewCount(game.views),
      screens: uniqueScreenUrls(game.screens),
      timestamp: catalogTimestamp(game.timestamp),
      updatedAt: isRelativeDate(game.updatedAt) ? '' : game.updatedAt || ''
    }))
    const healed = loaded.some((game, index) => {
      const prev = stored[index]
      return game.likes !== (Number(prev?.likes) || 0) || game.views !== (Number(prev?.views) || 0)
    })
    if (resetChecks || healed) {
      metadataCheckVersion = METADATA_CHECK_VERSION
      await writeStore(loaded)
    }
  } catch {
    loaded = []
    metadataCheckVersion = METADATA_CHECK_VERSION
  }
  return loaded
}

async function writeStore(games: Subscription[]): Promise<void> {
  loaded = games
  const file = getAppPaths().subscriptionsFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(
    file,
    JSON.stringify({ games, metadataCheckVersion: METADATA_CHECK_VERSION }, null, 2),
    'utf8'
  )
  sendToRenderer('subscriptions:changed', [...games].sort((a, b) => b.addedAt - a.addedAt))
}

export async function listSubscriptions(): Promise<Subscription[]> {
  const games = await readStore()
  return [...games].sort((a, b) => b.addedAt - a.addedAt)
}

export async function isSubscribed(threadId: number): Promise<boolean> {
  const games = await readStore()
  return games.some((game) => game.threadId === threadId)
}

export async function upsertSubscription(entry: Subscription): Promise<Subscription[]> {
  const games = await readStore()
  const index = games.findIndex((game) => game.threadId === entry.threadId)
  if (index >= 0) {
    games[index] = {
      ...games[index],
      ...entry,
      addedAt: games[index].addedAt,
      title: entry.title || games[index].title,
      creator: entry.creator || games[index].creator,
      coverUrl: entry.coverUrl || games[index].coverUrl,
      version: entry.version || games[index].version,
      rarity: entry.rarity ?? games[index].rarity ?? 'regular',
      tags: entry.tags?.length ? entry.tags : (games[index].tags ?? []),
      prefixes: entry.prefixes?.length ? entry.prefixes : (games[index].prefixes ?? []),
      engine: resolveEngine(entry) || games[index].engine || '',
      lastPlayedVersion: games[index].lastPlayedVersion,
      lastPlayedAt: games[index].lastPlayedAt,
      playtimeMs: games[index].playtimeMs,
      checkedAt: games[index].checkedAt || 0,
      likes: pickLikeCount(entry.likes, games[index].likes),
      views: pickViewCount(entry.views, games[index].views),
      screens: uniqueScreenUrls(entry.screens).length
        ? uniqueScreenUrls(entry.screens)
        : games[index].screens ?? []
    }
  } else {
    games.push({
      ...entry,
      likes: saneLikeCount(entry.likes),
      views: saneViewCount(entry.views),
      screens: uniqueScreenUrls(entry.screens)
    })
  }
  await writeStore(games)
  return listSubscriptions()
}

export async function removeSubscription(threadId: number): Promise<Subscription[]> {
  const games = (await readStore()).filter((game) => game.threadId !== threadId)
  await writeStore(games)
  return listSubscriptions()
}

export async function addSubscriptions(entries: Subscription[]): Promise<{
  added: number
  alreadyFollowed: number
}> {
  const games = await readStore()
  const known = new Set(games.map((game) => game.threadId))
  let added = 0
  let alreadyFollowed = 0

  for (const entry of entries) {
    if (known.has(entry.threadId)) {
      alreadyFollowed += 1
      continue
    }
    games.push({ ...emptyDetails(), ...entry })
    known.add(entry.threadId)
    added += 1
  }

  await writeStore(games)
  return { added, alreadyFollowed }
}

export async function enrichIncompleteSubscriptions(): Promise<Subscription[]> {
  if (enriching) return enriching
  enriching = runEnrichment().finally(() => {
    enriching = null
  })
  return enriching
}

async function runEnrichment(): Promise<Subscription[]> {
  const games = await readStore()
  let changed = false

  for (const game of games) {
    if (!needsDetails(game)) continue
    const details = await lookupGame(game.threadId, game.title, game.creator)
    if (!details) continue
    Object.assign(game, {
      title: details.title || game.title,
      creator: details.creator || game.creator,
      version: details.version || game.version,
      coverUrl: details.coverUrl || game.coverUrl,
      rating: details.rating || game.rating,
      likes: pickLikeCount(details.likes, game.likes),
      views: pickViewCount(details.views, game.views),
      updatedAt: details.updatedAt && !isRelativeDate(details.updatedAt) ? details.updatedAt : '',
      timestamp: catalogTimestamp(details.timestamp) || game.timestamp,
      tags: details.tags?.length ? details.tags : game.tags,
      prefixes: details.prefixes?.length ? details.prefixes : game.prefixes,
      engine: resolveEngine({ ...game, ...details }),
      screens: uniqueScreenUrls(details.screens).length
        ? uniqueScreenUrls(details.screens)
        : game.screens
    })
    changed = true
    await writeStore(games)
    await sleep(400)
  }

  if (changed) await writeStore(games)
  return listSubscriptions()
}

export async function refreshSubscription(threadId: number): Promise<Subscription[]> {
  if (enriching) await enriching
  const games = await readStore()
  const index = games.findIndex((game) => game.threadId === threadId)
  if (index < 0) {
    throw new Error('That game is not in the followed list.')
  }

  const current = games[index]
  const details = await lookupGame(current.threadId, current.title, current.creator)
  if (!details) {
    throw new Error('Could not refresh metadata from F95zone.')
  }

  games[index] = {
    ...current,
    title: details.title || current.title,
    creator: details.creator || current.creator,
    version: details.version || current.version,
    coverUrl: !isWeakCover(details.coverUrl) ? details.coverUrl : current.coverUrl,
    rating: details.rating || current.rating,
    likes: pickLikeCount(details.likes, current.likes),
    views: pickViewCount(details.views, current.views),
    updatedAt: details.updatedAt && !isRelativeDate(details.updatedAt) ? details.updatedAt : '',
    timestamp: catalogTimestamp(details.timestamp) || current.timestamp,
    tags: details.tags?.length ? details.tags : current.tags ?? [],
    prefixes: details.prefixes?.length ? details.prefixes : current.prefixes ?? [],
    engine: resolveEngine({ ...current, ...details }),
    checkedAt: Date.now(),
    screens: uniqueScreenUrls(details.screens).length
      ? uniqueScreenUrls(details.screens)
      : current.screens ?? []
  }
  await writeStore(games)
  return listSubscriptions()
}

export async function setSubscriptionRarity(
  threadId: number,
  rarity: GameRarity
): Promise<Subscription[]> {
  if (!isRarity(rarity)) {
    throw new Error('Unknown rarity.')
  }
  const games = await readStore()
  const game = games.find((item) => item.threadId === threadId)
  if (!game) {
    throw new Error('That game is not in the followed list.')
  }
  game.rarity = rarity
  await writeStore(games)
  return listSubscriptions()
}

export async function recordSubscriptionPlay(threadId: number, version: string): Promise<void> {
  const games = await readStore()
  const game = games.find((item) => item.threadId === threadId)
  if (!game) return
  game.lastPlayedVersion = version || game.lastPlayedVersion
  game.lastPlayedAt = Date.now()
  await writeStore(games)
}

export async function addSubscriptionPlaytime(threadId: number, deltaMs: number): Promise<void> {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return
  const games = await readStore()
  const game = games.find((item) => item.threadId === threadId)
  if (!game) return
  game.playtimeMs = (game.playtimeMs || 0) + Math.round(deltaMs)
  await writeStore(games)
}

function sameScreens(left?: string[], right?: string[]): boolean {
  if (!left?.length && !right?.length) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((url, index) => url === right[index])
}

export async function applyCatalogScreens(
  games: Array<{ threadId: number; screens?: string[]; likes?: number; views?: number }>
): Promise<void> {
  if (!games.length) return
  const byId = new Map(games.map((game) => [game.threadId, game]))
  const stored = await readStore()
  let changed = false
  for (const game of stored) {
    const incoming = byId.get(game.threadId)
    if (!incoming) continue
    const screens = uniqueScreenUrls(incoming.screens)
    if (screens.length && !sameScreens(game.screens, screens)) {
      game.screens = screens
      changed = true
    }
    const likes = saneLikeCount(incoming.likes)
    if (likes && likes !== game.likes) {
      game.likes = likes
      changed = true
    }
    const views = saneViewCount(incoming.views)
    if (views && views !== game.views) {
      game.views = views
      changed = true
    }
  }
  if (changed) await writeStore(stored)
}
