import { compareGameVersions } from './engines'
import type { VersionPlayStat, VersionPlayStatus } from './types'

export function usableVersion(value: unknown): string {
  const version =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : ''
  if (!version || /^unknown$/i.test(version)) return ''
  return version
}

function readReleasedAt(value: unknown): number {
  return catalogTimestamp(value as number | string | undefined | null)
}

function readVersionStatus(value: unknown): VersionPlayStatus | undefined {
  if (value === 'unplayed' || value === 'played' || value === 'skipped') return value
  return undefined
}

/** Prefer an explicit status from either side; later argument wins when both set. */
function mergeVersionStatus(
  left?: VersionPlayStatus,
  right?: VersionPlayStatus
): VersionPlayStatus | undefined {
  return right ?? left
}

export function effectiveVersionStatus(
  stat: Pick<VersionPlayStat, 'status' | 'lastPlayedAt' | 'playtimeMs'>
): VersionPlayStatus {
  if (stat.status === 'unplayed' || stat.status === 'played' || stat.status === 'skipped') {
    return stat.status
  }
  if (stat.lastPlayedAt || stat.playtimeMs) return 'played'
  return 'unplayed'
}

function statusAfterPlay(previous?: VersionPlayStatus): VersionPlayStatus | undefined {
  // Keep intentional "come back later" marks even if the build is launched again.
  if (previous === 'unplayed') return 'unplayed'
  if (previous === 'skipped') return 'played'
  return previous === 'played' ? 'played' : undefined
}

export function normalizeVersionPlayStats(value: unknown): VersionPlayStat[] {
  if (!Array.isArray(value)) return []
  const byVersion = new Map<string, VersionPlayStat>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Partial<VersionPlayStat>
    const version = typeof raw.version === 'string' ? raw.version.trim() : ''
    const releasedAt = readReleasedAt(raw.releasedAt)
    const lastPlayedAt = Number(raw.lastPlayedAt) || 0
    const playtimeMs = Math.max(0, Math.round(Number(raw.playtimeMs) || 0))
    const status = readVersionStatus(raw.status)
    if (!version && !releasedAt && !lastPlayedAt && !playtimeMs && !status) continue
    const prev = byVersion.get(version)
    const nextStatus = mergeVersionStatus(prev?.status, status)
    byVersion.set(version, {
      version,
      // Keep the earliest known release time for this version.
      releasedAt: prev?.releasedAt && releasedAt
        ? Math.min(prev.releasedAt, releasedAt)
        : (prev?.releasedAt || releasedAt),
      lastPlayedAt: Math.max(prev?.lastPlayedAt || 0, lastPlayedAt),
      playtimeMs: Math.max(prev?.playtimeMs || 0, playtimeMs),
      ...(nextStatus ? { status: nextStatus } : {})
    })
  }
  return sortVersionPlayStats([...byVersion.values()])
}

export function sortVersionPlayStats(stats: VersionPlayStat[]): VersionPlayStat[] {
  return [...stats].sort((a, b) => {
    const byReleased = (b.releasedAt || 0) - (a.releasedAt || 0)
    if (byReleased) return byReleased
    const byVersion = compareGameVersions(a.version, b.version)
    if (byVersion) return -byVersion
    const byPlayed = (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0)
    if (byPlayed) return byPlayed
    return (b.playtimeMs || 0) - (a.playtimeMs || 0)
  })
}

/** Merge version play rows; for each version keep release/play maxes appropriately. */
export function mergeVersionPlayStats(
  ...lists: Array<Iterable<VersionPlayStat> | null | undefined>
): VersionPlayStat[] {
  const byVersion = new Map<string, VersionPlayStat>()
  for (const list of lists) {
    if (!list) continue
    for (const item of list) {
      const version = (item.version || '').trim()
      const releasedAt = readReleasedAt(item.releasedAt)
      const lastPlayedAt = Number(item.lastPlayedAt) || 0
      const playtimeMs = Math.max(0, Math.round(Number(item.playtimeMs) || 0))
      const status = readVersionStatus(item.status)
      if (!version && !releasedAt && !lastPlayedAt && !playtimeMs && !status) continue
      const prev = byVersion.get(version)
      const nextStatus = mergeVersionStatus(prev?.status, status)
      byVersion.set(version, {
        version,
        releasedAt: prev?.releasedAt && releasedAt
          ? Math.min(prev.releasedAt, releasedAt)
          : (prev?.releasedAt || releasedAt),
        lastPlayedAt: Math.max(prev?.lastPlayedAt || 0, lastPlayedAt),
        playtimeMs: Math.max(prev?.playtimeMs || 0, playtimeMs),
        ...(nextStatus ? { status: nextStatus } : {})
      })
    }
  }
  return sortVersionPlayStats([...byVersion.values()])
}

export function versionPlayStatsFromFiles(
  files: Array<{ version?: string; lastPlayedAt?: number | null; playtimeMs?: number }>
): VersionPlayStat[] {
  const byVersion = new Map<string, VersionPlayStat>()
  for (const file of files) {
    const version = (file.version || '').trim()
    const lastPlayedAt = Number(file.lastPlayedAt) || 0
    const playtimeMs = Math.max(0, Math.round(Number(file.playtimeMs) || 0))
    if (!lastPlayedAt && !playtimeMs) continue
    const prev = byVersion.get(version)
    byVersion.set(version, {
      version,
      releasedAt: prev?.releasedAt || 0,
      lastPlayedAt: Math.max(prev?.lastPlayedAt || 0, lastPlayedAt),
      // Same version may have multiple library files; sum their playtime.
      playtimeMs: (prev?.playtimeMs || 0) + playtimeMs,
      ...(prev?.status ? { status: prev.status } : {})
    })
  }
  return sortVersionPlayStats([...byVersion.values()])
}

/** Record a known game version (may be unplayed) with its release/update date. */
export function ensureKnownVersion(
  list: VersionPlayStat[],
  version: string | undefined | null,
  releasedAt: number | string | undefined | null = 0
): VersionPlayStat[] {
  const key = usableVersion(version)
  const at = readReleasedAt(releasedAt)
  if (!key) return normalizeVersionPlayStats(list)
  const next = normalizeVersionPlayStats(list)
  const index = next.findIndex((item) => item.version === key)
  if (index >= 0) {
    if (at && !next[index].releasedAt) {
      next[index] = { ...next[index], releasedAt: at }
    }
    return sortVersionPlayStats(next)
  }
  next.push({ version: key, releasedAt: at, lastPlayedAt: 0, playtimeMs: 0 })
  return sortVersionPlayStats(next)
}

export function setVersionPlayStatus(
  list: VersionPlayStat[],
  version: string | undefined | null,
  status: VersionPlayStatus
): VersionPlayStat[] {
  const key = usableVersion(version)
  if (!key) return normalizeVersionPlayStats(list)
  const next = ensureKnownVersion(list, key)
  const index = next.findIndex((item) => item.version === key)
  if (index < 0) return next
  next[index] = { ...next[index], status }
  return sortVersionPlayStats(next)
}

export function touchVersionPlayStat(
  list: VersionPlayStat[],
  version: string,
  at = Date.now()
): VersionPlayStat[] {
  const key = version.trim()
  const next = normalizeVersionPlayStats(list)
  const index = next.findIndex((item) => item.version === key)
  if (index >= 0) {
    const status = statusAfterPlay(next[index].status)
    next[index] = {
      ...next[index],
      lastPlayedAt: Math.max(next[index].lastPlayedAt, at),
      ...(status ? { status } : {})
    }
  } else {
    next.push({ version: key, releasedAt: 0, lastPlayedAt: at, playtimeMs: 0 })
  }
  return sortVersionPlayStats(next)
}

export function addVersionPlaytime(
  list: VersionPlayStat[],
  version: string,
  deltaMs: number,
  at = Date.now()
): VersionPlayStat[] {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return normalizeVersionPlayStats(list)
  const key = version.trim()
  const next = normalizeVersionPlayStats(list)
  const index = next.findIndex((item) => item.version === key)
  if (index >= 0) {
    const status = statusAfterPlay(next[index].status)
    next[index] = {
      ...next[index],
      version: key,
      lastPlayedAt: Math.max(next[index].lastPlayedAt, at),
      playtimeMs: next[index].playtimeMs + Math.round(deltaMs),
      ...(status ? { status } : {})
    }
  } else {
    next.push({ version: key, releasedAt: 0, lastPlayedAt: at, playtimeMs: Math.round(deltaMs) })
  }
  return sortVersionPlayStats(next)
}

export function isNewerGameVersion(
  latest: string | undefined | null,
  baseline: string | undefined | null
): boolean {
  const next = usableVersion(latest)
  const current = usableVersion(baseline)
  if (!next || !current) return false
  return compareGameVersions(next, current) > 0
}

export function catalogTimestamp(value: number | string | undefined | null): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n)
}

export function isRelativeDate(value: string | undefined | null): boolean {
  return /\b(ago|yesterday|today|just now)\b/i.test(value || '')
}

export function formatUpdateDate(at: number | undefined | null): string {
  const ms = catalogTimestamp(at)
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatPlaytime(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000)
  if (ms <= 0) return '0m'
  if (totalMinutes < 1) return '<1m'
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (!minutes) return `${hours}h`
  return `${hours}h ${minutes}m`
}

export function formatSessionTime(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

function relativeUnit(count: number, unit: string): string {
  if (count === 1) {
    const article = unit === 'hour' ? 'an' : 'a'
    return `${article} ${unit} ago`
  }
  return `${count} ${unit}s ago`
}

export function formatRelativeTime(at: number | undefined | null, now = Date.now()): string {
  if (!at) return ''
  const delta = Math.max(0, now - at)
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return relativeUnit(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return relativeUnit(hours, 'hour')
  const days = Math.round(hours / 24)
  if (days < 14) return relativeUnit(days, 'day')
  const weeks = Math.round(days / 7)
  if (weeks < 5) return relativeUnit(weeks, 'week')
  const months = Math.round(days / 30)
  if (months < 12) return relativeUnit(Math.max(1, months), 'month')
  const years = Math.round(days / 365)
  return relativeUnit(Math.max(1, years), 'year')
}

export function formatDateTime(at: number | undefined | null): string {
  if (!at) return ''
  return new Date(at).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export type GameUpdateState = {
  updateAvailable: boolean
  unplayedUpdate: boolean
}

export function gameUpdateState(input: {
  latestVersion?: string | null
  installedVersion?: string | null
  lastPlayedVersion?: string | null
  playedVersions?: VersionPlayStat[] | null
}): GameUpdateState {
  const latest = usableVersion(input.latestVersion)
  const updateAvailable =
    Boolean(input.installedVersion) &&
    isNewerGameVersion(input.latestVersion, input.installedVersion)

  let unplayedUpdate = false
  if (latest) {
    const latestStat = (input.playedVersions || []).find((item) => item.version === latest)
    if (latestStat) {
      const status = effectiveVersionStatus(latestStat)
      if (status === 'skipped') {
        return { updateAvailable: false, unplayedUpdate: false }
      }
      unplayedUpdate = status === 'unplayed'
    } else {
      const lastPlayed = usableVersion(input.lastPlayedVersion)
      // Never played, or a newer build than the last played one.
      unplayedUpdate = !lastPlayed || isNewerGameVersion(latest, lastPlayed)
    }
  }

  return { updateAvailable, unplayedUpdate }
}

function latestVersionStatus(
  input: Parameters<typeof gameUpdateState>[0]
): VersionPlayStatus | null {
  const latest = usableVersion(input.latestVersion)
  if (!latest) return null
  const latestStat = (input.playedVersions || []).find((item) => item.version === latest)
  if (!latestStat) return null
  return effectiveVersionStatus(latestStat)
}

export function hasPendingGameUpdate(input: Parameters<typeof gameUpdateState>[0]): boolean {
  const flags = gameUpdateState(input)
  if (!flags.updateAvailable && !flags.unplayedUpdate) return false
  const status = latestVersionStatus(input)
  // Played or skipped latest builds drop off the Updates list even if an older install remains.
  if (status === 'played' || status === 'skipped') return false
  return true
}
