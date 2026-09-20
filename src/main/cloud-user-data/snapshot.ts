import { createHash } from 'crypto'
import { parseQuickFilters } from '@shared/quick-filters'
import { capTagsPerTier } from '@shared/ranked-tags'
import {
  DEFAULT_CATALOG_PAGE_SIZE,
  DEFAULT_CLOUD_SAVE_KEEP_COUNT,
  GAME_RARITIES,
  TAG_QUERY_LIMIT,
  TAG_TIERS,
  isCatalogPageSize,
  isCloudSaveKeepCount,
  type AppSettings,
  type CatalogPageSize,
  type CloudSaveKeepCount,
  type FavoriteTag,
  type GameRarity,
  type HatedTag,
  type RosterGame,
  type Subscription,
  type SubscriptionSource,
  type TagTier,
  type VersionPlayStat,
  type VersionPlayStatus
} from '@shared/types'
import { normalizeVersionPlayStats } from '@shared/updates'
import { maxLikeCount, maxViewCount, saneLikeCount, saneViewCount } from '@shared/counts'

export const USER_DATA_SNAPSHOT_VERSION = 1 as const

export type SyncedSettingKey =
  | 'favoriteTags'
  | 'hatedTags'
  | 'p2pEnabled'
  | 'metadataApiEnabled'
  | 'p2pUploadLimitKBps'
  | 'catalogPageSize'
  | 'cloudSaveKeepCount'
  | 'cloudSaveIncludeAutoQuick'
  | 'quickFilters'

export const SYNCED_SETTING_KEYS: SyncedSettingKey[] = [
  'favoriteTags',
  'hatedTags',
  'p2pEnabled',
  'metadataApiEnabled',
  'p2pUploadLimitKBps',
  'catalogPageSize',
  'cloudSaveKeepCount',
  'cloudSaveIncludeAutoQuick',
  'quickFilters'
]

export type SyncedSettings = Pick<AppSettings, SyncedSettingKey>
export type SettingsTimes = Partial<Record<SyncedSettingKey, number>>

export type UserDataTombstone = {
  threadId: number
  deletedAt: number
}

export type SyncedSubscription = Subscription & {
  userUpdatedAt: number
}

export type SyncedRosterGame = RosterGame & {
  userUpdatedAt: number
}

export type SyncedNote = {
  threadId: number
  text: string
  updatedAt: number
}

export type UserDataPayload = {
  version: typeof USER_DATA_SNAPSHOT_VERSION
  revision: number
  updatedAt: number
  settings: SyncedSettings
  settingsTimes: SettingsTimes
  subscriptions: SyncedSubscription[]
  subscriptionTombstones: UserDataTombstone[]
  roster: SyncedRosterGame[]
  rosterTombstones: UserDataTombstone[]
  notes: SyncedNote[]
  noteTombstones: UserDataTombstone[]
}

const SOURCES: SubscriptionSource[] = ['manual', 'watched', 'bookmark']

function isTier(value: unknown): value is TagTier {
  return typeof value === 'string' && TAG_TIERS.includes(value as TagTier)
}

function isRarity(value: unknown): value is GameRarity {
  return typeof value === 'string' && GAME_RARITIES.includes(value as GameRarity)
}

function isSource(value: unknown): value is SubscriptionSource {
  return typeof value === 'string' && SOURCES.includes(value as SubscriptionSource)
}

function asIdList(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((id): id is number => typeof id === 'number' && Number.isFinite(id) && id > 0)
}

function asScreens(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const urls: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const url = item.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}

function asThreadId(value: unknown): number {
  const id = Number(value)
  return Number.isFinite(id) && id > 0 ? id : 0
}

function asTime(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

function normalizeFavorite(value: unknown): FavoriteTag | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<FavoriteTag>
  const id = Number(item.id)
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!Number.isFinite(id) || id <= 0 || !name || !isTier(item.tier)) return null
  return { id, name, tier: item.tier }
}

function normalizeHated(value: unknown): HatedTag | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<HatedTag>
  const id = Number(item.id)
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!Number.isFinite(id) || id <= 0 || !name) return null
  return { id, name }
}

function readRankedTags(value: unknown): FavoriteTag[] {
  const seen = new Set<number>()
  const tags: FavoriteTag[] = []
  for (const item of Array.isArray(value) ? value : []) {
    const next = normalizeFavorite(item)
    if (!next || seen.has(next.id)) continue
    seen.add(next.id)
    tags.push(next)
  }
  return capTagsPerTier(tags)
}

function readHatedTags(value: unknown): HatedTag[] {
  const seen = new Set<number>()
  const tags: HatedTag[] = []
  for (const item of Array.isArray(value) ? value : []) {
    const next = normalizeHated(item)
    if (!next || seen.has(next.id)) continue
    seen.add(next.id)
    tags.push(next)
    if (tags.length >= TAG_QUERY_LIMIT) break
  }
  return tags.sort((a, b) => a.name.localeCompare(b.name))
}

function normalizeUploadLimitKBps(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(1024 * 1024, Math.floor(n))
}

function normalizeCatalogPageSize(value: unknown): CatalogPageSize {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return isCatalogPageSize(n) ? n : DEFAULT_CATALOG_PAGE_SIZE
}

function normalizeCloudSaveKeepCount(value: unknown): CloudSaveKeepCount {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return isCloudSaveKeepCount(n) ? n : DEFAULT_CLOUD_SAVE_KEEP_COUNT
}

export function emptySyncedSettings(): SyncedSettings {
  return {
    favoriteTags: [],
    hatedTags: [],
    p2pEnabled: false,
    metadataApiEnabled: true,
    p2pUploadLimitKBps: 0,
    catalogPageSize: DEFAULT_CATALOG_PAGE_SIZE,
    cloudSaveKeepCount: DEFAULT_CLOUD_SAVE_KEEP_COUNT,
    cloudSaveIncludeAutoQuick: true,
    quickFilters: []
  }
}

export function pickPortableSettings(settings: AppSettings): SyncedSettings {
  const favoriteTags = readRankedTags(settings.favoriteTags)
  const favoriteIds = new Set(favoriteTags.map((tag) => tag.id))
  return {
    favoriteTags,
    hatedTags: readHatedTags(settings.hatedTags).filter((tag) => !favoriteIds.has(tag.id)),
    p2pEnabled: Boolean(settings.p2pEnabled),
    metadataApiEnabled:
      typeof settings.metadataApiEnabled === 'boolean' ? settings.metadataApiEnabled : true,
    p2pUploadLimitKBps: normalizeUploadLimitKBps(settings.p2pUploadLimitKBps),
    catalogPageSize: normalizeCatalogPageSize(settings.catalogPageSize),
    cloudSaveKeepCount: normalizeCloudSaveKeepCount(settings.cloudSaveKeepCount),
    cloudSaveIncludeAutoQuick:
      typeof settings.cloudSaveIncludeAutoQuick === 'boolean'
        ? settings.cloudSaveIncludeAutoQuick
        : true,
    quickFilters: parseQuickFilters(settings.quickFilters)
  }
}

export function portableSettingKeysChanged(
  before: AppSettings,
  after: AppSettings
): SyncedSettingKey[] {
  const left = pickPortableSettings(before)
  const right = pickPortableSettings(after)
  return SYNCED_SETTING_KEYS.filter((key) => JSON.stringify(left[key]) !== JSON.stringify(right[key]))
}

function normalizeSettings(value: unknown): SyncedSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<SyncedSettings>) : {}
  return pickPortableSettings({
    ...emptySyncedSettings(),
    downloadsDir: '',
    libraryDir: '',
    extraArchiveDirs: [],
    extraLibraryDirs: [],
    metadataBaseUrl: '',
    trackerWebRtcUrl: '',
    cloudSavesEnabled: false,
    cloudUserDataEnabled: false,
    quickFilters: [],
    ...raw
  } as AppSettings)
}

function normalizeSettingsTimes(value: unknown): SettingsTimes {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const times: SettingsTimes = {}
  for (const key of SYNCED_SETTING_KEYS) {
    const at = asTime(raw[key])
    if (at) times[key] = at
  }
  return times
}

function normalizeTombstone(value: unknown): UserDataTombstone | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<UserDataTombstone>
  const threadId = asThreadId(raw.threadId)
  const deletedAt = asTime(raw.deletedAt)
  if (!threadId || !deletedAt) return null
  return { threadId, deletedAt }
}

function normalizeTombstones(value: unknown): UserDataTombstone[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<number, number>()
  for (const item of value) {
    const next = normalizeTombstone(item)
    if (!next) continue
    byId.set(next.threadId, Math.max(byId.get(next.threadId) || 0, next.deletedAt))
  }
  return [...byId.entries()]
    .map(([threadId, deletedAt]) => ({ threadId, deletedAt }))
    .sort((a, b) => a.threadId - b.threadId)
}

function isVersionPlayStatus(value: unknown): value is VersionPlayStatus {
  return value === 'unplayed' || value === 'played' || value === 'skipped'
}

function normalizePlayedVersions(value: unknown): VersionPlayStat[] {
  return normalizeVersionPlayStats(
    Array.isArray(value)
      ? value.filter((item) => item && typeof item === 'object')
      : []
  ).map((item) => ({
    ...item,
    ...(item.status && isVersionPlayStatus(item.status) ? { status: item.status } : {})
  }))
}

export function normalizeSubscription(value: unknown): SyncedSubscription | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SyncedSubscription>
  const threadId = asThreadId(raw.threadId)
  if (!threadId) return null
  const title = typeof raw.title === 'string' ? raw.title : ''
  const addedAt = asTime(raw.addedAt) || asTime(raw.userUpdatedAt) || 1
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
    timestamp: asTime(raw.timestamp),
    threadUrl:
      typeof raw.threadUrl === 'string' && raw.threadUrl
        ? raw.threadUrl
        : `https://f95zone.to/threads/${threadId}/`,
    source: isSource(raw.source) ? raw.source : 'manual',
    addedAt,
    rarity: isRarity(raw.rarity) ? raw.rarity : 'regular',
    tags: asIdList(raw.tags),
    prefixes: asIdList(raw.prefixes),
    engine: typeof raw.engine === 'string' ? raw.engine : '',
    lastPlayedVersion: typeof raw.lastPlayedVersion === 'string' ? raw.lastPlayedVersion : '',
    lastPlayedAt: asTime(raw.lastPlayedAt),
    playtimeMs: Math.max(0, Math.round(Number(raw.playtimeMs) || 0)),
    playedVersions: normalizePlayedVersions(raw.playedVersions),
    checkedAt: asTime(raw.checkedAt),
    screens: asScreens(raw.screens),
    archived: Boolean(raw.archived),
    userUpdatedAt: asTime(raw.userUpdatedAt) || addedAt
  }
}

export function normalizeRosterGame(value: unknown): SyncedRosterGame | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SyncedRosterGame>
  const threadId = asThreadId(raw.threadId)
  if (!threadId) return null
  const addedAt = asTime(raw.addedAt) || asTime(raw.userUpdatedAt) || 1
  return {
    threadId,
    title: typeof raw.title === 'string' ? raw.title : '',
    creator: typeof raw.creator === 'string' ? raw.creator : '',
    version: typeof raw.version === 'string' ? raw.version : '',
    coverUrl: typeof raw.coverUrl === 'string' && raw.coverUrl ? raw.coverUrl : null,
    rating: Number(raw.rating) || 0,
    likes: saneLikeCount(raw.likes),
    views: saneViewCount(raw.views),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    timestamp: asTime(raw.timestamp),
    threadUrl:
      typeof raw.threadUrl === 'string' && raw.threadUrl
        ? raw.threadUrl
        : `https://f95zone.to/threads/${threadId}/`,
    prefixes: asIdList(raw.prefixes),
    tags: asIdList(raw.tags),
    screens: asScreens(raw.screens),
    engine: typeof raw.engine === 'string' ? raw.engine : '',
    addedAt,
    userUpdatedAt: asTime(raw.userUpdatedAt) || addedAt
  }
}

function normalizeNote(value: unknown): SyncedNote | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SyncedNote>
  const threadId = asThreadId(raw.threadId)
  const text = typeof raw.text === 'string' ? raw.text : ''
  const updatedAt = asTime(raw.updatedAt)
  if (!threadId || !text || !updatedAt) return null
  return { threadId, text, updatedAt }
}

function uniqueByThread<T extends { threadId: number }>(items: T[]): T[] {
  const byId = new Map<number, T>()
  for (const item of items) byId.set(item.threadId, item)
  return [...byId.values()].sort((a, b) => a.threadId - b.threadId)
}

export function emptyPayload(now = 0): UserDataPayload {
  return {
    version: USER_DATA_SNAPSHOT_VERSION,
    revision: 0,
    updatedAt: now,
    settings: emptySyncedSettings(),
    settingsTimes: {},
    subscriptions: [],
    subscriptionTombstones: [],
    roster: [],
    rosterTombstones: [],
    notes: [],
    noteTombstones: []
  }
}

export function normalizePayload(value: unknown): UserDataPayload | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<UserDataPayload>
  if (raw.version !== USER_DATA_SNAPSHOT_VERSION) return null
  const revision = Number(raw.revision)
  if (!Number.isFinite(revision) || revision < 0) return null
  return {
    version: USER_DATA_SNAPSHOT_VERSION,
    revision: Math.floor(revision),
    updatedAt: asTime(raw.updatedAt),
    settings: normalizeSettings(raw.settings),
    settingsTimes: normalizeSettingsTimes(raw.settingsTimes),
    subscriptions: uniqueByThread(
      (Array.isArray(raw.subscriptions) ? raw.subscriptions : [])
        .map(normalizeSubscription)
        .filter((item): item is SyncedSubscription => Boolean(item))
    ),
    subscriptionTombstones: normalizeTombstones(raw.subscriptionTombstones),
    roster: uniqueByThread(
      (Array.isArray(raw.roster) ? raw.roster : [])
        .map(normalizeRosterGame)
        .filter((item): item is SyncedRosterGame => Boolean(item))
    ),
    rosterTombstones: normalizeTombstones(raw.rosterTombstones),
    notes: uniqueByThread(
      (Array.isArray(raw.notes) ? raw.notes : [])
        .map(normalizeNote)
        .filter((item): item is SyncedNote => Boolean(item))
    ),
    noteTombstones: normalizeTombstones(raw.noteTombstones)
  }
}

export function contentFingerprint(payload: UserDataPayload): string {
  return JSON.stringify({
    settings: payload.settings,
    settingsTimes: payload.settingsTimes,
    subscriptions: payload.subscriptions,
    subscriptionTombstones: payload.subscriptionTombstones,
    roster: payload.roster,
    rosterTombstones: payload.rosterTombstones,
    notes: payload.notes,
    noteTombstones: payload.noteTombstones
  })
}

function checksumOf(payload: UserDataPayload): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

export function serializeEnvelope(payload: UserDataPayload): { bytes: Buffer; checksum: string } {
  const normalized = normalizePayload(payload)
  if (!normalized) throw new Error('Cannot serialize an invalid user-data snapshot.')
  const checksum = checksumOf(normalized)
  return {
    checksum,
    bytes: Buffer.from(JSON.stringify({ checksum, payload: normalized }), 'utf8')
  }
}

export function parseEnvelope(raw: string | Buffer): { payload: UserDataPayload; checksum: string } | null {
  try {
    const text = typeof raw === 'string' ? raw : raw.toString('utf8')
    const parsed = JSON.parse(text) as { checksum?: unknown; payload?: unknown }
    if (typeof parsed.checksum !== 'string' || !parsed.checksum) return null
    if (!parsed.payload || typeof parsed.payload !== 'object') return null
    const body = JSON.stringify(parsed.payload)
    const checksum = createHash('sha256').update(body).digest('hex')
    if (checksum !== parsed.checksum) return null
    const payload = normalizePayload(parsed.payload)
    if (!payload) return null
    return { payload, checksum: parsed.checksum }
  } catch {
    return null
  }
}

export function toSubscription(item: SyncedSubscription): Subscription {
  const { userUpdatedAt: _ignored, ...rest } = item
  return rest
}

export function toRosterGame(item: SyncedRosterGame): RosterGame {
  const { userUpdatedAt: _ignored, ...rest } = item
  return rest
}

export function mergeCatalogFields<T extends {
  title: string
  creator: string
  version: string
  coverUrl: string | null
  rating: number
  likes: number
  views: number
  updatedAt: string
  timestamp: number
  threadUrl: string
  prefixes: number[]
  tags: number[]
  screens: string[]
  engine?: string
}>(left: T, right: T): Pick<
  T,
  | 'title'
  | 'creator'
  | 'version'
  | 'coverUrl'
  | 'rating'
  | 'likes'
  | 'views'
  | 'updatedAt'
  | 'timestamp'
  | 'threadUrl'
  | 'prefixes'
  | 'tags'
  | 'screens'
> & { engine: string } {
  const newer = (right.timestamp || 0) >= (left.timestamp || 0) ? right : left
  const older = newer === right ? left : right
  return {
    title: newer.title || older.title,
    creator: newer.creator || older.creator,
    version: newer.version || older.version,
    coverUrl: newer.coverUrl || older.coverUrl,
    rating: Number(newer.rating) || Number(older.rating) || 0,
    likes: maxLikeCount(newer.likes, older.likes),
    views: maxViewCount(newer.views, older.views),
    updatedAt: newer.updatedAt || older.updatedAt,
    timestamp: Math.max(left.timestamp || 0, right.timestamp || 0),
    threadUrl: newer.threadUrl || older.threadUrl,
    prefixes: newer.prefixes?.length ? newer.prefixes : older.prefixes || [],
    tags: newer.tags?.length ? newer.tags : older.tags || [],
    screens: newer.screens?.length ? newer.screens : older.screens || [],
    engine: (newer.engine || older.engine || '') as string
  }
}
