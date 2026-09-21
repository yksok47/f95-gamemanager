import { compareGameVersions } from './engines'
import {
  isInstallableLibraryPackage,
  type GameLibraryFile,
  type VersionPlayStat,
  type VersionPlayStatus
} from './types'

type VersionedLibraryFile = {
  version?: string
  packageTags?: { version?: string } | null
  installedAt?: number | null
  downloadedAt?: number
  lastPlayedAt?: number | null
  playtimeMs?: number
}

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

function uniqueVersionNames(values: Iterable<unknown> | null | undefined): string[] {
  const names: string[] = []
  if (!values) return names
  for (const value of values) {
    const name = usableVersion(value)
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

function earliestReleasedAt(left: number, right: number): number {
  if (left && right) return Math.min(left, right)
  return left || right
}

function statusRank(status?: VersionPlayStatus): number {
  if (status === 'played') return 3
  if (status === 'skipped') return 2
  if (status === 'unplayed') return 1
  return 0
}

/** When folding distinct names into one version, keep the strongest attention state. */
function preferAttentionStatus(
  left?: VersionPlayStatus,
  right?: VersionPlayStatus
): VersionPlayStatus | undefined {
  return statusRank(right) > statusRank(left) ? right : left
}

function presentVersionPlayStat(stat: VersionPlayStat): VersionPlayStat {
  const aliases = uniqueVersionNames(stat.aliases).filter((name) => name !== stat.version)
  return {
    version: stat.version,
    releasedAt: stat.releasedAt,
    lastPlayedAt: stat.lastPlayedAt,
    playtimeMs: stat.playtimeMs,
    ...(aliases.length ? { aliases } : {}),
    ...(stat.status ? { status: stat.status } : {})
  }
}

function parseVersionPlayStat(item: unknown): VersionPlayStat | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Partial<VersionPlayStat>
  const version = typeof raw.version === 'string' ? raw.version.trim() : ''
  const releasedAt = readReleasedAt(raw.releasedAt)
  const lastPlayedAt = Number(raw.lastPlayedAt) || 0
  const playtimeMs = Math.max(0, Math.round(Number(raw.playtimeMs) || 0))
  const status = readVersionStatus(raw.status)
  const aliases = uniqueVersionNames(raw.aliases)
  if (!version && !releasedAt && !lastPlayedAt && !playtimeMs && !status && !aliases.length) return null
  return presentVersionPlayStat({
    version,
    releasedAt,
    lastPlayedAt,
    playtimeMs,
    aliases,
    ...(status ? { status } : {})
  })
}

/** Same version string from overlapping sources: keep max playtime so we do not double-count. */
function combineSameVersion(left: VersionPlayStat, right: VersionPlayStat): VersionPlayStat {
  const nextStatus = mergeVersionStatus(left.status, right.status)
  return presentVersionPlayStat({
    version: right.version || left.version,
    releasedAt: earliestReleasedAt(left.releasedAt || 0, right.releasedAt || 0),
    lastPlayedAt: Math.max(left.lastPlayedAt || 0, right.lastPlayedAt || 0),
    playtimeMs: Math.max(left.playtimeMs || 0, right.playtimeMs || 0),
    aliases: [...(left.aliases || []), ...(right.aliases || [])],
    ...(nextStatus ? { status: nextStatus } : {})
  })
}

/** Distinct names the user treated as one version: add their playtimes together. */
function combineAliasedVersions(
  canonical: string,
  left: VersionPlayStat,
  right: VersionPlayStat
): VersionPlayStat {
  const nextStatus = preferAttentionStatus(left.status, right.status)
  return presentVersionPlayStat({
    version: canonical,
    releasedAt: earliestReleasedAt(left.releasedAt || 0, right.releasedAt || 0),
    lastPlayedAt: Math.max(left.lastPlayedAt || 0, right.lastPlayedAt || 0),
    playtimeMs: (left.playtimeMs || 0) + (right.playtimeMs || 0),
    aliases: [...(left.aliases || []), ...(right.aliases || []), left.version, right.version],
    ...(nextStatus ? { status: nextStatus } : {})
  })
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

function pickCanonicalVersion(names: Set<string>, stats: VersionPlayStat[]): string {
  const claimants = stats.filter((item) => names.has(usableVersion(item.version)))
  if (!claimants.length) return [...names].sort((left, right) => left.localeCompare(right))[0] || ''
  let bestScore = -1
  const ranked: VersionPlayStat[] = []
  for (const item of claimants) {
    const score = (item.aliases || []).filter((alias) => names.has(usableVersion(alias))).length
    if (score > bestScore) {
      bestScore = score
      ranked.length = 0
      ranked.push(item)
    } else if (score === bestScore) {
      ranked.push(item)
    }
  }
  return sortVersionPlayStats(ranked)[0]?.version || [...names][0] || ''
}

function collectAliasMap(stats: VersionPlayStat[]): Map<string, string> {
  const parent = new Map<string, string>()
  function find(name: string): string {
    const current = parent.get(name) || name
    if (current === name) return name
    const root = find(current)
    parent.set(name, root)
    return root
  }
  function addName(name: string): void {
    if (!name || parent.has(name)) return
    parent.set(name, name)
  }
  function union(left: string, right: string): void {
    const rootLeft = find(left)
    const rootRight = find(right)
    if (rootLeft === rootRight) return
    parent.set(rootRight, rootLeft)
  }

  for (const stat of stats) {
    const version = usableVersion(stat.version)
    if (version) addName(version)
    for (const alias of stat.aliases || []) {
      const name = usableVersion(alias)
      if (!name) continue
      addName(name)
      if (version) union(version, name)
    }
  }

  const groups = new Map<string, string[]>()
  for (const name of parent.keys()) {
    const root = find(name)
    const group = groups.get(root)
    if (group) group.push(name)
    else groups.set(root, [name])
  }

  const map = new Map<string, string>()
  for (const names of groups.values()) {
    const canonical = pickCanonicalVersion(new Set(names), stats)
    for (const name of names) map.set(name, canonical)
  }
  return map
}

function collapseAliasedStats(stats: VersionPlayStat[], map: Map<string, string>): VersionPlayStat[] {
  const byExact = new Map<string, VersionPlayStat>()
  for (const item of stats) {
    const parsed = parseVersionPlayStat(item)
    if (!parsed) continue
    const prev = byExact.get(parsed.version)
    byExact.set(parsed.version, prev ? combineSameVersion(prev, parsed) : parsed)
  }

  const byCanonical = new Map<string, VersionPlayStat>()
  for (const item of byExact.values()) {
    const canonical = map.get(item.version) || item.version
    const aligned =
      item.version === canonical
        ? item
        : presentVersionPlayStat({
            ...item,
            version: canonical,
            aliases: [...(item.aliases || []), item.version]
          })
    const prev = byCanonical.get(canonical)
    byCanonical.set(canonical, prev ? combineAliasedVersions(canonical, prev, aligned) : aligned)
  }

  for (const [name, canonical] of map) {
    if (name === canonical) continue
    const row = byCanonical.get(canonical)
    if (!row) continue
    const aliases = uniqueVersionNames([...(row.aliases || []), name]).filter((item) => item !== canonical)
    if (aliases.length !== (row.aliases?.length || 0)) {
      byCanonical.set(canonical, presentVersionPlayStat({ ...row, aliases }))
    }
  }

  return [...byCanonical.values()].map((item) => presentVersionPlayStat(item))
}

function mergeCollapsedLists(lists: VersionPlayStat[][]): VersionPlayStat[] {
  const byVersion = new Map<string, VersionPlayStat>()
  for (const list of lists) {
    for (const item of list) {
      const prev = byVersion.get(item.version)
      byVersion.set(item.version, prev ? combineSameVersion(prev, item) : item)
    }
  }
  return sortVersionPlayStats([...byVersion.values()].map((item) => presentVersionPlayStat(item)))
}

export function versionStatHasName(stat: VersionPlayStat, version: string | undefined | null): boolean {
  const key = usableVersion(version)
  if (!key) return false
  if (usableVersion(stat.version) === key) return true
  return (stat.aliases || []).some((alias) => usableVersion(alias) === key)
}

export function canonicalVersionName(
  version: string | undefined | null,
  stats: VersionPlayStat[]
): string {
  const key = usableVersion(version)
  if (!key) return ''
  return collectAliasMap(stats).get(key) || key
}

export function normalizeVersionPlayStats(value: unknown): VersionPlayStat[] {
  if (!Array.isArray(value)) return []
  const parsed: VersionPlayStat[] = []
  for (const item of value) {
    const next = parseVersionPlayStat(item)
    if (next) parsed.push(next)
  }
  return sortVersionPlayStats(collapseAliasedStats(parsed, collectAliasMap(parsed)))
}

/** Merge version play rows; for each version keep release/play maxes appropriately. */
export function mergeVersionPlayStats(
  ...lists: Array<Iterable<VersionPlayStat> | null | undefined>
): VersionPlayStat[] {
  const parsedLists: VersionPlayStat[][] = []
  const all: VersionPlayStat[] = []
  for (const list of lists) {
    if (!list) continue
    const parsed: VersionPlayStat[] = []
    for (const item of list) {
      const next = parseVersionPlayStat(item)
      if (!next) continue
      parsed.push(next)
      all.push(next)
    }
    parsedLists.push(parsed)
  }
  const map = collectAliasMap(all)
  return mergeCollapsedLists(parsedLists.map((list) => collapseAliasedStats(list, map)))
}

export function versionPlayStatsFromFiles(
  files: Array<{
    version?: string
    packageTags?: { version?: string } | null
    lastPlayedAt?: number | null
    playtimeMs?: number
  }>
): VersionPlayStat[] {
  const byVersion = new Map<string, VersionPlayStat>()
  for (const file of files) {
    const version = libraryFileVersion(file)
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

function findVersionIndex(list: VersionPlayStat[], version: string): number {
  const key = usableVersion(version) || version.trim()
  if (!key) return -1
  const canonical = canonicalVersionName(key, list)
  return list.findIndex(
    (item) => item.version === canonical || item.version === key || versionStatHasName(item, key)
  )
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
  const index = findVersionIndex(next, key)
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
  const index = findVersionIndex(next, key)
  if (index < 0) return next
  next[index] = { ...next[index], status }
  return sortVersionPlayStats(next)
}

export function setVersionReleasedAt(
  list: VersionPlayStat[],
  version: string | undefined | null,
  releasedAt: number | string | undefined | null
): VersionPlayStat[] {
  const key = usableVersion(version)
  if (!key) return normalizeVersionPlayStats(list)
  const next = ensureKnownVersion(list, key)
  const index = findVersionIndex(next, key)
  if (index < 0) return next
  next[index] = { ...next[index], releasedAt: readReleasedAt(releasedAt) }
  return sortVersionPlayStats(next)
}

/** Fold other version names into `canonical`, summing playtime of distinct rows. */
export function mergeVersionNames(
  list: VersionPlayStat[],
  canonical: string | undefined | null,
  sources: Iterable<string> | null | undefined
): VersionPlayStat[] {
  const keep = usableVersion(canonical)
  const extra = uniqueVersionNames(sources).filter((name) => name !== keep)
  if (!keep || !extra.length) return normalizeVersionPlayStats(list)
  const next = ensureKnownVersion(list, keep)
  const index = findVersionIndex(next, keep)
  const target =
    index >= 0 ? next[index] : { version: keep, releasedAt: 0, lastPlayedAt: 0, playtimeMs: 0 }
  const patched = [...next]
  const merged = presentVersionPlayStat({
    ...target,
    version: keep,
    aliases: [...(target.aliases || []), ...extra]
  })
  if (index >= 0) patched[index] = merged
  else patched.push(merged)
  return normalizeVersionPlayStats(patched)
}

export function addVersionAlias(
  list: VersionPlayStat[],
  version: string | undefined | null,
  alias: string | undefined | null
): VersionPlayStat[] {
  return mergeVersionNames(list, version, [alias || ''])
}

export function removeVersionAlias(
  list: VersionPlayStat[],
  version: string | undefined | null,
  alias: string | undefined | null
): VersionPlayStat[] {
  const key = usableVersion(version)
  const name = usableVersion(alias)
  if (!key || !name) return normalizeVersionPlayStats(list)
  const next = normalizeVersionPlayStats(list)
  const index = findVersionIndex(next, key)
  if (index < 0) return next
  const aliases = (next[index].aliases || []).filter((item) => usableVersion(item) !== name)
  next[index] = presentVersionPlayStat({ ...next[index], aliases })
  return sortVersionPlayStats(next)
}

export function touchVersionPlayStat(
  list: VersionPlayStat[],
  version: string,
  at = Date.now()
): VersionPlayStat[] {
  const trimmed = version.trim()
  const next = normalizeVersionPlayStats(list)
  const key = canonicalVersionName(trimmed, next) || trimmed
  const index = findVersionIndex(next, key)
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
  const trimmed = version.trim()
  const next = normalizeVersionPlayStats(list)
  const key = canonicalVersionName(trimmed, next) || trimmed
  const index = findVersionIndex(next, key)
  if (index >= 0) {
    const status = statusAfterPlay(next[index].status)
    next[index] = {
      ...next[index],
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

/** Approved package version wins over a stale thread/catalog version on the file. */
export function libraryFileVersion(file: VersionedLibraryFile): string {
  return usableVersion(file.packageTags?.version) || usableVersion(file.version)
}

export function compareLibraryFilesByVersion(a: VersionedLibraryFile, b: VersionedLibraryFile): number {
  const versions = compareGameVersions(libraryFileVersion(a), libraryFileVersion(b))
  if (versions) return versions
  const installed = (a.installedAt || 0) - (b.installedAt || 0)
  if (installed) return installed
  return (a.downloadedAt || 0) - (b.downloadedAt || 0)
}

export type LatestInstalledHint = {
  catalogVersion?: string | null
  playedVersions?: VersionPlayStat[] | null
}

function asLatestInstalledHint(
  hint?: string | LatestInstalledHint | null
): LatestInstalledHint {
  if (!hint) return {}
  if (typeof hint === 'string') return { catalogVersion: hint }
  return hint
}

function libraryFileMatchesVersion(
  file: VersionedLibraryFile,
  version: string,
  stats?: VersionPlayStat[] | null
): boolean {
  const key = libraryFileVersion(file)
  if (!key || !version) return false
  if (key === version || compareGameVersions(key, version) === 0) return true
  if (!stats?.length) return false
  const canonical = canonicalVersionName(version, stats)
  return Boolean(canonical) && canonicalVersionName(key, stats) === canonical
}

/** Same pick as the overview Versions list: catalog latest, else newest `releasedAt`. */
export function latestOverviewVersion(
  stats: VersionPlayStat[],
  catalogVersion?: string | null
): string {
  const sorted = sortVersionPlayStats(stats)
  const catalog = usableVersion(catalogVersion)
  if (catalog) {
    const canonical = canonicalVersionName(catalog, sorted)
    const match = sorted.find(
      (item) => item.version === catalog || item.version === canonical || versionStatHasName(item, catalog)
    )
    if (match) return match.version
  }
  return sorted[0]?.version || catalog || ''
}

/** Highest installed game version, using the overview Versions order when stats exist. */
export function latestInstalledLibraryFile<T extends GameLibraryFile>(
  files: T[],
  hint?: string | LatestInstalledHint | null
): T | null {
  const installed = files.filter(
    (file) => file.isInstalled && isInstallableLibraryPackage(file.packageTags)
  )
  if (!installed.length) return null
  const { catalogVersion, playedVersions } = asLatestInstalledHint(hint)
  const stats = mergeVersionPlayStats(
    playedVersions,
    installed.map((file) => ({
      version: libraryFileVersion(file),
      releasedAt: 0,
      lastPlayedAt: file.lastPlayedAt || 0,
      playtimeMs: file.playtimeMs || 0
    }))
  )
  const ordered = sortVersionPlayStats(stats)
  const keys: string[] = []
  const overview = latestOverviewVersion(ordered, catalogVersion)
  if (overview) keys.push(overview)
  for (const item of ordered) {
    if (item.version && !keys.includes(item.version)) keys.push(item.version)
  }
  for (const key of keys) {
    const matches = installed.filter((file) => libraryFileMatchesVersion(file, key, ordered))
    if (matches.length) return [...matches].sort(compareLibraryFilesByVersion).at(-1) ?? null
  }
  return [...installed].sort(compareLibraryFilesByVersion).at(-1) ?? null
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

export function dateInputFromReleasedAt(at: number | string | undefined | null): string {
  const ms = catalogTimestamp(at)
  if (!ms) return ''
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function releasedAtFromDateInput(value: string | undefined | null): number {
  const trimmed = (value || '').trim()
  if (!trimmed) return 0
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (!match) return 0
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0)
  const ms = date.getTime()
  return Number.isFinite(ms) ? ms : 0
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
    const latestStat = (input.playedVersions || []).find(
      (item) => item.version === latest || versionStatHasName(item, latest)
    )
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
  const latestStat = (input.playedVersions || []).find(
    (item) => item.version === latest || versionStatHasName(item, latest)
  )
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

/** Roster games stay off Updates until the user removes them without playing/skipping. */
export function shouldListOnUpdatesPage(
  input: Parameters<typeof gameUpdateState>[0],
  inRoster = false
): boolean {
  if (inRoster) return false
  return hasPendingGameUpdate(input)
}
