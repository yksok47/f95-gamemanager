import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { GAME_RARITIES, type CatalogGame, type GameRarity, type Subscription, type SubscriptionSource, type VersionPlayStatus } from '@shared/types'
import { engineFromTitle } from '@shared/engines'
import { engineFromPrefixIds } from '@shared/prefixes'
import {
  addVersionAlias,
  addVersionPlaytime,
  canonicalVersionName,
  catalogTimestamp,
  ensureKnownVersion,
  isRelativeDate,
  latestKnownVersion,
  mergeVersionNames,
  preferNewerVersion,
  normalizeVersionPlayStats,
  removeVersionAlias,
  setVersionPlayStatus,
  setVersionReleasedAt,
  touchVersionPlayStat
} from '@shared/updates'
import { uniqueScreenUrls } from './f95/catalog'
import { lookupGame, isWeakCover } from './f95/lookup'
import { pickLikeCount, pickViewCount, saneLikeCount, saneViewCount } from '@shared/counts'
import { parseGameTitle, sleep } from './f95/parse'
import { getAppPaths } from './paths'
import { sendToRenderer } from './windows'
import { notifyUserDataChanged } from './cloud-user-data/notify'
import { tombstoneSubscription, touchSubscription } from './cloud-user-data/state'
import {
  CATALOG_SCAN_VERSION,
  catalogWatermarkFromStore,
  watermarkFromHeadPage
} from './catalog-scan'

let loaded: Subscription[] | null = null
const METADATA_CHECK_VERSION = 1
let metadataCheckVersion = 0
/** Newest catalog update timestamp we have continuously scanned down from. */
let lastSeenCatalogUpdate = 0
let catalogScanVersion = 0

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
  | 'playedVersions'
  | 'checkedAt'
  | 'screens'
  | 'archived'
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
    playedVersions: [],
    checkedAt: 0,
    screens: [],
    archived: false
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
    playedVersions: ensureKnownVersion([], game.version, game.timestamp),
    checkedAt: 0,
    screens: uniqueScreenUrls(game.screens),
    archived: false
  }
}

function seedPlayedVersions(game: Partial<Subscription>): Subscription['playedVersions'] {
  let existing = normalizeVersionPlayStats(game.playedVersions)
  if (!existing.length) {
    const version = typeof game.lastPlayedVersion === 'string' ? game.lastPlayedVersion.trim() : ''
    const lastPlayedAt = Number(game.lastPlayedAt) || 0
    if (version || lastPlayedAt) {
      // Keep last-played version history, but do not re-attribute aggregate playtime
      // (that would over-count once per-file stats are merged in the UI).
      existing = normalizeVersionPlayStats([{ version, releasedAt: 0, lastPlayedAt, playtimeMs: 0 }])
    }
  }
  return ensureKnownVersion(existing, game.version, game.timestamp)
}

function recordKnownVersion(
  game: Pick<Subscription, 'playedVersions' | 'version' | 'timestamp'>,
  version?: string | null,
  timestamp?: number | string | null
): Subscription['playedVersions'] {
  return ensureKnownVersion(
    game.playedVersions || [],
    version || game.version,
    catalogTimestamp(timestamp) || game.timestamp
  )
}

function needsDetails(game: Subscription): boolean {
  if (!game.coverUrl || isWeakCover(game.coverUrl) || !game.creator) return true
  const parsed = parseGameTitle(game.title)
  return parsed.title !== game.title.replace(/\s+/g, ' ').trim()
}

let enriching: Promise<Subscription[]> | null = null

type SubscriptionsFile = {
  games?: Subscription[]
  metadataCheckVersion?: number
  lastSeenCatalogUpdate?: number
  catalogScanVersion?: number
}

async function readStore(): Promise<Subscription[]> {
  if (loaded) return loaded
  try {
    const raw = await readFile(getAppPaths().subscriptionsFile, 'utf8')
    const parsed = JSON.parse(raw) as SubscriptionsFile | Subscription[]
    const stored = Array.isArray(parsed) ? parsed : (parsed.games ?? [])
    metadataCheckVersion = Array.isArray(parsed) ? 0 : (parsed.metadataCheckVersion ?? 0)
    catalogScanVersion = Array.isArray(parsed) ? 0 : (parsed.catalogScanVersion ?? 0)
    lastSeenCatalogUpdate = Array.isArray(parsed)
      ? 0
      : catalogWatermarkFromStore(parsed.catalogScanVersion, parsed.lastSeenCatalogUpdate)
    const resetChecks = metadataCheckVersion < METADATA_CHECK_VERSION
    loaded = stored.map((game) => {
      const playedVersions = seedPlayedVersions(game)
      const version = latestKnownVersion(
        typeof game.version === 'string' ? game.version : '',
        playedVersions
      )
      return {
        ...emptyDetails(),
        ...game,
        rarity: isRarity(game.rarity) ? game.rarity : 'regular',
        tags: Array.isArray(game.tags) ? game.tags.filter((id) => Number.isFinite(id)) : [],
        prefixes: Array.isArray(game.prefixes) ? game.prefixes.filter((id) => Number.isFinite(id)) : [],
        engine: resolveEngine(game),
        lastPlayedVersion: typeof game.lastPlayedVersion === 'string' ? game.lastPlayedVersion : '',
        lastPlayedAt: Number(game.lastPlayedAt) || 0,
        playtimeMs: Number(game.playtimeMs) || 0,
        playedVersions,
        version,
        checkedAt: resetChecks ? 0 : Number(game.checkedAt) || 0,
        likes: saneLikeCount(game.likes),
        views: saneViewCount(game.views),
        screens: uniqueScreenUrls(game.screens),
        timestamp: catalogTimestamp(game.timestamp),
        updatedAt: isRelativeDate(game.updatedAt) ? '' : game.updatedAt || '',
        archived: Boolean(game.archived)
      }
    })
    const healed = loaded.some((game, index) => {
      const prev = stored[index]
      const prevVersion = typeof prev?.version === 'string' ? prev.version : ''
      return (
        game.likes !== (Number(prev?.likes) || 0) ||
        game.views !== (Number(prev?.views) || 0) ||
        game.version !== prevVersion
      )
    })
    if (resetChecks || healed) {
      metadataCheckVersion = METADATA_CHECK_VERSION
      await writeStore(loaded)
    }
  } catch {
    loaded = []
    metadataCheckVersion = METADATA_CHECK_VERSION
    catalogScanVersion = 0
    lastSeenCatalogUpdate = 0
  }
  return loaded
}

async function writeStore(games: Subscription[]): Promise<void> {
  loaded = games
  const file = getAppPaths().subscriptionsFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(
    file,
    JSON.stringify(
      {
        games,
        metadataCheckVersion: METADATA_CHECK_VERSION,
        catalogScanVersion,
        lastSeenCatalogUpdate
      },
      null,
      2
    ),
    'utf8'
  )
  sendToRenderer('subscriptions:changed', [...games].sort((a, b) => b.addedAt - a.addedAt))
}

async function persistMeta(): Promise<void> {
  const games = await readStore()
  const file = getAppPaths().subscriptionsFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(
    file,
    JSON.stringify(
      {
        games,
        metadataCheckVersion: METADATA_CHECK_VERSION,
        catalogScanVersion,
        lastSeenCatalogUpdate
      },
      null,
      2
    ),
    'utf8'
  )
}

export async function getLastSeenCatalogUpdate(): Promise<number> {
  await readStore()
  return lastSeenCatalogUpdate
}

/** Raise the catalog scan watermark when coverage is continuous from the newest games. */
export async function advanceLastSeenCatalogUpdate(timestamp: number): Promise<void> {
  const at = catalogTimestamp(timestamp)
  if (!at) return
  await readStore()
  if (at <= lastSeenCatalogUpdate) return
  lastSeenCatalogUpdate = at
  catalogScanVersion = CATALOG_SCAN_VERSION
  await persistMeta()
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
      version: preferNewerVersion(games[index].version, entry.version),
      rarity: entry.rarity ?? games[index].rarity ?? 'regular',
      tags: entry.tags?.length ? entry.tags : (games[index].tags ?? []),
      prefixes: entry.prefixes?.length ? entry.prefixes : (games[index].prefixes ?? []),
      engine: resolveEngine(entry) || games[index].engine || '',
      lastPlayedVersion: games[index].lastPlayedVersion,
      lastPlayedAt: games[index].lastPlayedAt,
      playtimeMs: games[index].playtimeMs,
      playedVersions: recordKnownVersion(
        games[index],
        entry.version || games[index].version,
        entry.timestamp || games[index].timestamp
      ),
      checkedAt: games[index].checkedAt || 0,
      likes: pickLikeCount(entry.likes, games[index].likes),
      views: pickViewCount(entry.views, games[index].views),
      screens: uniqueScreenUrls(entry.screens).length
        ? uniqueScreenUrls(entry.screens)
        : games[index].screens ?? [],
      archived: games[index].archived
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
  await touchSubscription(entry.threadId)
  notifyUserDataChanged('data')
  return listSubscriptions()
}

export async function removeSubscription(threadId: number): Promise<Subscription[]> {
  const games = (await readStore()).filter((game) => game.threadId !== threadId)
  await writeStore(games)
  await tombstoneSubscription(threadId)
  notifyUserDataChanged('data')
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
  const addedIds: number[] = []

  for (const entry of entries) {
    if (known.has(entry.threadId)) {
      alreadyFollowed += 1
      continue
    }
    games.push({ ...emptyDetails(), ...entry })
    known.add(entry.threadId)
    added += 1
    addedIds.push(entry.threadId)
  }

  await writeStore(games)
  await Promise.all(addedIds.map((id) => touchSubscription(id)))
  if (added) notifyUserDataChanged('data')
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
    const version = preferNewerVersion(game.version, details.version)
    const timestamp = Math.max(game.timestamp || 0, catalogTimestamp(details.timestamp) || 0)
    Object.assign(game, {
      title: details.title || game.title,
      creator: details.creator || game.creator,
      version,
      coverUrl: details.coverUrl || game.coverUrl,
      rating: details.rating || game.rating,
      likes: pickLikeCount(details.likes, game.likes),
      views: pickViewCount(details.views, game.views),
      updatedAt: details.updatedAt && !isRelativeDate(details.updatedAt) ? details.updatedAt : '',
      timestamp,
      tags: details.tags?.length ? details.tags : game.tags,
      prefixes: details.prefixes?.length ? details.prefixes : game.prefixes,
      engine: resolveEngine({ ...game, ...details }),
      playedVersions: recordKnownVersion(game, version, timestamp),
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

  const version = preferNewerVersion(current.version, details.version)
  const timestamp = Math.max(current.timestamp || 0, catalogTimestamp(details.timestamp) || 0)
  games[index] = {
    ...current,
    title: details.title || current.title,
    creator: details.creator || current.creator,
    version,
    coverUrl: !isWeakCover(details.coverUrl) ? details.coverUrl : current.coverUrl,
    rating: details.rating || current.rating,
    likes: pickLikeCount(details.likes, current.likes),
    views: pickViewCount(details.views, current.views),
    updatedAt: details.updatedAt && !isRelativeDate(details.updatedAt) ? details.updatedAt : '',
    timestamp,
    tags: details.tags?.length ? details.tags : current.tags ?? [],
    prefixes: details.prefixes?.length ? details.prefixes : current.prefixes ?? [],
    engine: resolveEngine({ ...current, ...details }),
    playedVersions: recordKnownVersion(current, version, timestamp),
    checkedAt: Date.now(),
    screens: uniqueScreenUrls(details.screens).length
      ? uniqueScreenUrls(details.screens)
      : current.screens ?? []
  }
  await writeStore(games)
  return listSubscriptions()
}

export async function setSubscriptionArchived(
  threadId: number,
  archived: boolean
): Promise<Subscription[]> {
  const games = await readStore()
  const game = games.find((item) => item.threadId === threadId)
  if (!game) {
    throw new Error('That game is not in the followed list.')
  }
  game.archived = Boolean(archived)
  await writeStore(games)
  await touchSubscription(threadId)
  notifyUserDataChanged('data')
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
  await touchSubscription(threadId)
  notifyUserDataChanged('data')
  return listSubscriptions()
}

function isVersionPlayStatus(value: unknown): value is VersionPlayStatus {
  return value === 'unplayed' || value === 'played' || value === 'skipped'
}

export async function setSubscriptionVersionStatus(
  threadId: number,
  version: string,
  status: VersionPlayStatus
): Promise<Subscription[]> {
  if (!isVersionPlayStatus(status)) {
    throw new Error('Unknown version status.')
  }
  const key = (version || '').trim()
  if (!key) {
    throw new Error('Missing version.')
  }
  const games = await readStore()
  const game = games.find((item) => item.threadId === threadId)
  if (!game) {
    throw new Error('That game is not in the followed list.')
  }
  game.playedVersions = setVersionPlayStatus(game.playedVersions || [], key, status)
  await writeStore(games)
  await touchSubscription(threadId)
  notifyUserDataChanged('data')
  return listSubscriptions()
}

async function mutatePlayedVersions(
  threadId: number,
  mutate: (playedVersions: Subscription['playedVersions']) => Subscription['playedVersions']
): Promise<Subscription[]> {
  const games = await readStore()
  const game = games.find((item) => item.threadId === threadId)
  if (!game) {
    throw new Error('That game is not in the followed list.')
  }
  game.playedVersions = mutate(game.playedVersions || [])
  const lastPlayed = (game.lastPlayedVersion || '').trim()
  if (lastPlayed) {
    game.lastPlayedVersion =
      canonicalVersionName(lastPlayed, game.playedVersions) || game.lastPlayedVersion
  }
  await writeStore(games)
  await touchSubscription(threadId)
  notifyUserDataChanged('data')
  return listSubscriptions()
}

export async function setSubscriptionVersionReleasedAt(
  threadId: number,
  version: string,
  releasedAt: number
): Promise<Subscription[]> {
  const key = (version || '').trim()
  if (!key) {
    throw new Error('Missing version.')
  }
  return mutatePlayedVersions(threadId, (playedVersions) =>
    setVersionReleasedAt(playedVersions, key, releasedAt)
  )
}

export async function addSubscriptionVersionAlias(
  threadId: number,
  version: string,
  alias: string
): Promise<Subscription[]> {
  const key = (version || '').trim()
  const name = (alias || '').trim()
  if (!key || !name) {
    throw new Error('Missing version.')
  }
  return mutatePlayedVersions(threadId, (playedVersions) => addVersionAlias(playedVersions, key, name))
}

export async function removeSubscriptionVersionAlias(
  threadId: number,
  version: string,
  alias: string
): Promise<Subscription[]> {
  const key = (version || '').trim()
  const name = (alias || '').trim()
  if (!key || !name) {
    throw new Error('Missing version.')
  }
  return mutatePlayedVersions(threadId, (playedVersions) =>
    removeVersionAlias(playedVersions, key, name)
  )
}

export async function mergeSubscriptionVersions(
  threadId: number,
  canonical: string,
  sources: string[]
): Promise<Subscription[]> {
  const keep = (canonical || '').trim()
  const extra = Array.isArray(sources) ? sources.map((item) => (item || '').trim()).filter(Boolean) : []
  if (!keep || extra.length < 1) {
    throw new Error('Pick at least two versions to merge.')
  }
  return mutatePlayedVersions(threadId, (playedVersions) =>
    mergeVersionNames(playedVersions, keep, extra)
  )
}

export async function recordSubscriptionPlay(threadId: number, version: string): Promise<void> {
  const games = await readStore()
  const game = games.find((item) => item.threadId === threadId)
  if (!game) return
  const at = Date.now()
  game.lastPlayedVersion = version || game.lastPlayedVersion
  game.lastPlayedAt = at
  game.playedVersions = touchVersionPlayStat(game.playedVersions || [], version || game.lastPlayedVersion, at)
  await writeStore(games)
  notifyUserDataChanged('playtime')
}

export async function addSubscriptionPlaytime(
  threadId: number,
  deltaMs: number,
  version?: string
): Promise<void> {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return
  const games = await readStore()
  const game = games.find((item) => item.threadId === threadId)
  if (!game) return
  const at = Date.now()
  game.playtimeMs = (game.playtimeMs || 0) + Math.round(deltaMs)
  const key = (version || game.lastPlayedVersion || '').trim()
  game.playedVersions = addVersionPlaytime(game.playedVersions || [], key, deltaMs, at)
  await writeStore(games)
  notifyUserDataChanged('playtime')
}

function sameScreens(left?: string[], right?: string[]): boolean {
  if (!left?.length && !right?.length) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((url, index) => url === right[index])
}

function sameIdList(left?: number[], right?: number[]): boolean {
  if (!left?.length && !right?.length) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((id, index) => id === right[index])
}

function applyCatalogGameFields(game: Subscription, incoming: CatalogGame, checkedAt: number): boolean {
  let changed = false
  const version = preferNewerVersion(game.version, incoming.version)
  const incomingTs = catalogTimestamp(incoming.timestamp)
  const timestamp = incomingTs > (game.timestamp || 0) ? incomingTs : game.timestamp || 0
  const title = (incoming.title || '').trim() || game.title
  const creator = (incoming.creator || '').trim() || game.creator
  const coverUrl =
    incoming.coverUrl && !isWeakCover(incoming.coverUrl) ? incoming.coverUrl : game.coverUrl
  const rating = Number(incoming.rating) || game.rating
  const likes = pickLikeCount(incoming.likes, game.likes)
  const views = pickViewCount(incoming.views, game.views)
  const tags = incoming.tags?.length ? incoming.tags : game.tags
  const prefixes = incoming.prefixes?.length ? incoming.prefixes : game.prefixes
  const engine = resolveEngine({ ...game, ...incoming, prefixes, title }) || game.engine
  const screens = uniqueScreenUrls(incoming.screens)
  const nextScreens = screens.length ? screens : game.screens
  const playedVersions = recordKnownVersion(game, version, timestamp)

  if (title !== game.title) {
    game.title = title
    changed = true
  }
  if (creator !== game.creator) {
    game.creator = creator
    changed = true
  }
  if (version !== game.version) {
    game.version = version
    changed = true
  }
  if (coverUrl !== game.coverUrl) {
    game.coverUrl = coverUrl
    changed = true
  }
  if (rating !== game.rating) {
    game.rating = rating
    changed = true
  }
  if (likes !== game.likes) {
    game.likes = likes
    changed = true
  }
  if (views !== game.views) {
    game.views = views
    changed = true
  }
  if (timestamp && timestamp !== game.timestamp) {
    game.timestamp = timestamp
    changed = true
  }
  if (!sameIdList(game.tags, tags)) {
    game.tags = tags
    changed = true
  }
  if (!sameIdList(game.prefixes, prefixes)) {
    game.prefixes = prefixes
    changed = true
  }
  if (engine !== game.engine) {
    game.engine = engine
    changed = true
  }
  if (!sameScreens(game.screens, nextScreens)) {
    game.screens = nextScreens
    changed = true
  }
  if (
    playedVersions.length !== (game.playedVersions?.length || 0) ||
    playedVersions.some((item, index) => {
      const prev = game.playedVersions[index]
      return (
        !prev ||
        prev.version !== item.version ||
        prev.releasedAt !== item.releasedAt ||
        prev.lastPlayedAt !== item.lastPlayedAt ||
        prev.playtimeMs !== item.playtimeMs ||
        prev.status !== item.status ||
        (prev.aliases || []).join('\0') !== (item.aliases || []).join('\0')
      )
    })
  ) {
    game.playedVersions = playedVersions
    changed = true
  }
  if (game.checkedAt !== checkedAt) {
    game.checkedAt = checkedAt
    changed = true
  }
  return changed
}

export type ApplyCatalogGamesOptions = {
  /**
   * When true, raise lastSeenCatalogUpdate if this page is a continuous prefix
   * from the newest updates back to the previous watermark.
   * A page with no previous watermark does not seed one: that would treat the
   * single newest row as already scanned.
   */
  advanceLastSeen?: boolean
}

/** Merge already-fetched catalog rows into followed games without blocking on network. */
export async function applyCatalogGames(
  games: CatalogGame[],
  options: ApplyCatalogGamesOptions = {}
): Promise<number> {
  if (!games.length) {
    return 0
  }

  const byId = new Map(games.map((game) => [game.threadId, game]))
  const stored = await readStore()
  const checkedAt = Date.now()
  let changed = false
  let matched = 0

  for (const game of stored) {
    const incoming = byId.get(game.threadId)
    if (!incoming) continue
    matched += 1
    if (applyCatalogGameFields(game, incoming, checkedAt)) changed = true
  }

  if (changed) await writeStore(stored)

  if (options.advanceLastSeen) {
    const next = watermarkFromHeadPage(games, lastSeenCatalogUpdate)
    if (next) await advanceLastSeenCatalogUpdate(next)
  }

  return matched
}

export async function replaceSubscriptions(games: Subscription[]): Promise<void> {
  await writeStore(games)
}
