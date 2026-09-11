import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, isAbsolute } from 'path'
import { TAG_TIERS, type AppSettings, type FavoriteTag, type TagTier } from '@shared/types'
import { P2P_ENV_DEFAULTS } from '@shared/p2p'
import { getAppPaths } from './paths'

let loaded: AppSettings | null = null

function isTier(value: unknown): value is TagTier {
  return typeof value === 'string' && TAG_TIERS.includes(value as TagTier)
}

function normalizeFavorite(value: unknown): FavoriteTag | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Partial<FavoriteTag>
  const id = Number(item.id)
  const name = typeof item.name === 'string' ? item.name.trim() : ''
  if (!Number.isFinite(id) || id <= 0 || !name || !isTier(item.tier)) return null
  return { id, name, tier: item.tier }
}

function defaultFolders(): Pick<AppSettings, 'downloadsDir' | 'libraryDir'> {
  const paths = getAppPaths()
  return {
    downloadsDir: paths.downloadsDir,
    libraryDir: paths.libraryDir
  }
}

function envOrDefault(key: keyof typeof P2P_ENV_DEFAULTS): string {
  const raw = process.env[key]
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return P2P_ENV_DEFAULTS[key]
}

function normalizeUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function normalizeDir(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed || !isAbsolute(trimmed)) return fallback
  return trimmed
}

function emptySettings(): AppSettings {
  return {
    favoriteTags: [],
    p2pEnabled: false,
    trackerAnnounceUrl: envOrDefault('TRACKER_ANNOUNCE_URL'),
    metadataBaseUrl: envOrDefault('METADATA_BASE_URL'),
    ...defaultFolders()
  }
}

function normalizeSettings(value: unknown): AppSettings {
  const raw = value && typeof value === 'object' ? (value as Partial<AppSettings>) : {}
  const defaults = defaultFolders()
  const seen = new Set<number>()
  const favoriteTags: FavoriteTag[] = []
  for (const item of Array.isArray(raw.favoriteTags) ? raw.favoriteTags : []) {
    const next = normalizeFavorite(item)
    if (!next || seen.has(next.id)) continue
    seen.add(next.id)
    favoriteTags.push(next)
  }
  return {
    favoriteTags,
    downloadsDir: normalizeDir(raw.downloadsDir, defaults.downloadsDir),
    libraryDir: normalizeDir(raw.libraryDir, defaults.libraryDir),
    p2pEnabled: Boolean(raw.p2pEnabled),
    trackerAnnounceUrl: normalizeUrl(raw.trackerAnnounceUrl, envOrDefault('TRACKER_ANNOUNCE_URL')),
    metadataBaseUrl: normalizeUrl(raw.metadataBaseUrl, envOrDefault('METADATA_BASE_URL'))
  }
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await mkdir(dir, { recursive: true })
  } catch (error) {
    console.warn(`Could not create folder ${dir}`, error)
  }
}

async function readStore(): Promise<AppSettings> {
  if (loaded) return loaded
  try {
    const raw = await readFile(getAppPaths().settingsFile, 'utf8')
    loaded = normalizeSettings(JSON.parse(raw))
  } catch {
    loaded = emptySettings()
  }
  await Promise.all([ensureDir(loaded.downloadsDir), ensureDir(loaded.libraryDir)])
  return loaded
}

async function writeStore(settings: AppSettings): Promise<void> {
  loaded = settings
  await Promise.all([ensureDir(settings.downloadsDir), ensureDir(settings.libraryDir)])
  const file = getAppPaths().settingsFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(settings, null, 2), 'utf8')
}

export function getDownloadsDirSync(): string {
  return loaded?.downloadsDir ?? getAppPaths().downloadsDir
}

export function getLibraryDirSync(): string {
  return loaded?.libraryDir ?? getAppPaths().libraryDir
}

export function getTrackerAnnounceUrlSync(): string {
  return loaded?.trackerAnnounceUrl ?? envOrDefault('TRACKER_ANNOUNCE_URL')
}

export function getMetadataBaseUrlSync(): string {
  return loaded?.metadataBaseUrl ?? envOrDefault('METADATA_BASE_URL')
}

export async function getSettings(): Promise<AppSettings> {
  return readStore()
}

export async function saveSettings(next: Partial<AppSettings>): Promise<AppSettings> {
  const current = await readStore()
  const settings = normalizeSettings({ ...current, ...next })
  await writeStore(settings)
  return settings
}
