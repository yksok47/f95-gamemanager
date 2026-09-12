import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, isAbsolute, join } from 'path'
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

function migrateLegacyWebRtcPort(url: string): string {
  try {
    const parsed = new URL(url)
    if ((parsed.protocol === 'ws:' || parsed.protocol === 'wss:') && parsed.port === '8000') {
      parsed.port = '6969'
      return parsed.toString().replace(/\/$/, '')
    }
  } catch {
    /* keep */
  }
  return url
}

function httpAnnounceToWs(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return ''
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol === 'http:') parsed.protocol = 'ws:'
    else if (parsed.protocol === 'https:') parsed.protocol = 'wss:'
    else return ''
    parsed.pathname = ''
    parsed.search = ''
    parsed.hash = ''
    return migrateLegacyWebRtcPort(parsed.toString().replace(/\/$/, ''))
  } catch {
    return ''
  }
}

function normalizeWebRtcUrl(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' ? value.trim() : undefined
  const next = raw === undefined ? fallback.trim() : raw
  if (!next) return fallback.trim()
  if (next.startsWith('ws://') || next.startsWith('wss://')) {
    return migrateLegacyWebRtcPort(next.replace(/\/$/, ''))
  }
  return fallback.trim()
}

function normalizeDir(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed || !isAbsolute(trimmed)) return fallback
  return trimmed
}

const MAX_UPLOAD_LIMIT_KBPS = 1024 * 1024

function normalizeUploadLimitKBps(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : 0
  if (!Number.isFinite(n) || n <= 0) return 0
  return Math.min(MAX_UPLOAD_LIMIT_KBPS, Math.floor(n))
}

function emptySettings(): AppSettings {
  return {
    favoriteTags: [],
    p2pEnabled: false,
    metadataBaseUrl: envOrDefault('METADATA_BASE_URL'),
    trackerWebRtcUrl: envOrDefault('TRACKER_WEBRTC_URL'),
    p2pUploadLimitKBps: 0,
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
    metadataBaseUrl: normalizeUrl(raw.metadataBaseUrl, envOrDefault('METADATA_BASE_URL')),
    trackerWebRtcUrl: normalizeWebRtcUrl(
      raw.trackerWebRtcUrl ||
        httpAnnounceToWs((raw as { trackerAnnounceUrl?: unknown }).trackerAnnounceUrl),
      envOrDefault('TRACKER_WEBRTC_URL')
    ),
    p2pUploadLimitKBps: normalizeUploadLimitKBps(raw.p2pUploadLimitKBps)
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
    const parsed = JSON.parse(raw) as Record<string, unknown>
    loaded = normalizeSettings(parsed)
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

/** Quarantine folder for P2P downloads awaiting Approve / Reject / Flag. */
export function getUntrustedDownloadsDirSync(): string {
  return join(getDownloadsDirSync(), 'untrusted')
}

export function getLibraryDirSync(): string {
  return loaded?.libraryDir ?? getAppPaths().libraryDir
}

export function getMetadataBaseUrlSync(): string {
  return loaded?.metadataBaseUrl ?? envOrDefault('METADATA_BASE_URL')
}

export function getTrackerWebRtcUrlSync(): string {
  return loaded?.trackerWebRtcUrl ?? envOrDefault('TRACKER_WEBRTC_URL')
}

export function getP2pUploadLimitKBpsSync(): number {
  return loaded?.p2pUploadLimitKBps ?? 0
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
