import { app } from 'electron'
import { existsSync, statSync } from 'fs'
import { dirname, isAbsolute, join } from 'path'
import { DatabaseSync } from 'node:sqlite'
import {
  TAGS_PER_TIER_LIMIT,
  TAG_TIERS,
  type F95CheckerImportResult,
  type FavoriteTag,
  type GameRarity,
  type HatedTag,
  type Subscription,
  type VersionPlayStat
} from '@shared/types'
import { asText } from '@shared/text'
import {
  catalogTimestamp,
  ensureKnownVersion,
  setVersionPlayStatus,
  touchVersionPlayStat,
  usableVersion
} from '@shared/updates'
import { fetchCatalogFilters, uniqueScreenUrls } from './f95/catalog'
import { threadUrl } from './f95/parse'
import { F95CHECKER_TAG_NAMES } from './f95checker-tags'
import { folderBytes } from './disk-usage'
import { isSamePath } from './extra-library-dirs'
import { addImportedLibraryFile } from './game-files-store'
import { getGameNote, setGameNote } from './game-notes-store'
import { getSettings, saveSettings } from './settings-store'
import { enrichIncompleteSubscriptions, mergeImportedSubscriptions } from './subscriptions-store'

type Row = Record<string, unknown>

const EVENT_INSTALLED = 4
const EVENT_FINISHED = 3
const HIGHLIGHT_POSITIVE = 1
const OS_KEYS: Record<string, string> = { win32: '1', linux: '2', darwin: '3' }

const ENGINE_BY_TYPE: Record<number, string> = {
  2: 'Adrift',
  4: 'Flash',
  5: 'HTML',
  6: 'Java',
  10: 'QSP',
  11: 'RAGS',
  13: 'RPG Maker',
  14: "Ren'Py",
  16: 'Tads',
  19: 'Unity',
  20: 'Unreal',
  21: 'WebGL',
  22: 'Wolf RPG',
  31: 'Godot'
}

const RARITY_BY_RATING: Record<number, GameRarity> = {
  1: 'infamous',
  2: 'regular',
  3: 'rare',
  4: 'epic',
  5: 'legendary'
}

export function defaultF95CheckerDbPath(): string {
  return join(app.getPath('appData'), 'f95checker', 'db.sqlite3')
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function jsonValue<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function versionOf(value: unknown): string {
  const version = text(value)
  return version === 'Unchecked' ? '' : usableVersion(version)
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("select 1 from sqlite_master where type='table' and name=?").get(name))
}

function readRows(db: DatabaseSync, table: string): Row[] {
  if (!tableExists(db, table)) return []
  return db.prepare(`select * from ${table}`).all() as Row[]
}

function osDir(value: unknown): string {
  const dirs = jsonValue<Record<string, string>>(value, {})
  return text(dirs[OS_KEYS[process.platform] ?? '1'])
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

type GameEvents = { installed: string[]; finished: string[] }

function eventsByGame(rows: Row[]): Map<number, GameEvents> {
  const out = new Map<number, GameEvents>()
  for (const row of rows) {
    const id = num(row.game_id)
    const type = num(row.type)
    if (!id || (type !== EVENT_INSTALLED && type !== EVENT_FINISHED)) continue
    const version = usableVersion(jsonValue<unknown[]>(row.arguments, [])[0])
    if (!version) continue
    const entry = out.get(id) ?? { installed: [], finished: [] }
    ;(type === EVENT_INSTALLED ? entry.installed : entry.finished).push(version)
    out.set(id, entry)
  }
  return out
}

function playedVersionsFor(
  row: Row,
  events: GameEvents | undefined,
  lastLaunched: number
): { playedVersions: VersionPlayStat[]; lastPlayedVersion: string } {
  const installed = versionOf(row.installed)
  const finished = versionOf(row.finished)
  let stats = ensureKnownVersion([], versionOf(row.version), catalogTimestamp(num(row.last_updated)))
  for (const version of [...(events?.installed ?? []), installed]) {
    stats = ensureKnownVersion(stats, version)
  }
  for (const version of new Set([...(events?.finished ?? []), finished].filter(Boolean))) {
    stats = setVersionPlayStatus(stats, version, 'played')
  }
  if (installed && lastLaunched) stats = touchVersionPlayStat(stats, installed, lastLaunched)
  const lastPlayedVersion = installed && lastLaunched ? installed : finished
  return { playedVersions: stats, lastPlayedVersion }
}

function subscriptionFor(row: Row, events: GameEvents | undefined): Subscription {
  const threadId = num(row.id)
  const lastLaunched = catalogTimestamp(num(row.last_launched))
  const { playedVersions, lastPlayedVersion } = playedVersionsFor(row, events, lastLaunched)
  return {
    threadId,
    title: asText(row.name),
    creator: text(row.developer),
    version: versionOf(row.version),
    coverUrl: null,
    rating: num(row.score),
    likes: 0,
    views: 0,
    updatedAt: '',
    timestamp: catalogTimestamp(num(row.last_updated)),
    threadUrl: threadUrl(threadId),
    source: 'manual',
    addedAt: catalogTimestamp(num(row.added_on)) || Date.now(),
    rarity: RARITY_BY_RATING[num(row.rating)] ?? 'regular',
    tags: [],
    prefixes: [],
    screens: uniqueScreenUrls(jsonValue<string[]>(row.previews_urls, [])),
    engine: ENGINE_BY_TYPE[num(row.type)] ?? '',
    lastPlayedVersion,
    lastPlayedAt: lastLaunched,
    playtimeMs: 0,
    playedVersions,
    checkedAt: 0,
    archived: Boolean(num(row.archived))
  }
}

function isF95Game(row: Row): boolean {
  if (num(row.custom)) return false
  if (num(row.id) <= 0) return false
  const url = text(row.url)
  return !url || /f95zone\.to\/threads\//i.test(url)
}

async function importNote(threadId: number, note: string): Promise<boolean> {
  if (!note) return false
  const existing = await getGameNote(threadId)
  if (existing.includes(note)) return false
  await setGameNote(threadId, existing ? `${existing}\n\n${note}` : note)
  return true
}

function resolveExecutable(row: Row, exeDir: string): string {
  for (const exe of jsonValue<string[]>(row.executables, [])) {
    const value = text(exe)
    if (!value) continue
    const full = isAbsolute(value) ? value : exeDir ? join(exeDir, value) : ''
    if (full && existsSync(full)) return full
  }
  return ''
}

async function importInstall(game: Subscription, row: Row, exePath: string): Promise<void> {
  const installPath = dirname(exePath)
  await addImportedLibraryFile({
    kind: 'install',
    path: installPath,
    hash: '',
    size: await folderBytes(installPath),
    executablePath: exePath,
    context: {
      threadId: game.threadId,
      title: game.title,
      version: versionOf(row.installed) || game.version,
      engine: game.engine,
      creator: game.creator,
      threadUrl: game.threadUrl,
      timestamp: game.timestamp,
      rating: game.rating,
      screens: game.screens
    }
  })
}

async function importDirs(settingsRow: Row | undefined): Promise<{ libraryDirs: number; archiveDirs: number }> {
  const settings = await getSettings()
  const libraryDir = osDir(settingsRow?.default_exe_dir)
  const archiveDir = osDir(settingsRow?.downloads_dir)
  const extraLibraryDirs = [...settings.extraLibraryDirs]
  const extraArchiveDirs = [...settings.extraArchiveDirs]
  let libraryDirs = 0
  let archiveDirs = 0
  if (
    libraryDir &&
    isDir(libraryDir) &&
    !isSamePath(libraryDir, settings.libraryDir) &&
    !extraLibraryDirs.some((dir) => isSamePath(dir, libraryDir))
  ) {
    extraLibraryDirs.push(libraryDir)
    libraryDirs = 1
  }
  if (
    archiveDir &&
    isDir(archiveDir) &&
    !isSamePath(archiveDir, settings.downloadsDir) &&
    !extraArchiveDirs.some((dir) => isSamePath(dir, archiveDir))
  ) {
    extraArchiveDirs.push(archiveDir)
    archiveDirs = 1
  }
  if (libraryDirs || archiveDirs) await saveSettings({ extraLibraryDirs, extraArchiveDirs })
  return { libraryDirs, archiveDirs }
}

async function importTagHighlights(
  settingsRow: Row | undefined
): Promise<{ favoriteTags: number; hatedTags: number }> {
  const highlights = jsonValue<Record<string, number>>(settingsRow?.tags_highlights, {})
  const entries = Object.entries(highlights)
  if (!entries.length) return { favoriteTags: 0, hatedTags: 0 }
  const catalog = await fetchCatalogFilters()
  const byName = new Map(catalog.tags.map((tag) => [tag.name.trim().toLowerCase(), tag]))
  const settings = await getSettings()
  const favorites: FavoriteTag[] = [...settings.favoriteTags]
  const hated: HatedTag[] = [...settings.hatedTags]
  const known = new Set([...favorites, ...hated].map((tag) => tag.id))
  let favoriteTags = 0
  let hatedTags = 0
  for (const [key, highlight] of entries) {
    const name = F95CHECKER_TAG_NAMES[Number(key)]
    const tag = name ? byName.get(name.toLowerCase()) : undefined
    if (!tag || known.has(tag.id)) continue
    if (num(highlight) === HIGHLIGHT_POSITIVE) {
      const tier = TAG_TIERS.find(
        (candidate) => favorites.filter((item) => item.tier === candidate).length < TAGS_PER_TIER_LIMIT
      )
      if (!tier) continue
      favorites.push({ id: tag.id, name: tag.name, tier })
      favoriteTags += 1
    } else {
      hated.push({ id: tag.id, name: tag.name })
      hatedTags += 1
    }
    known.add(tag.id)
  }
  if (favoriteTags || hatedTags) await saveSettings({ favoriteTags: favorites, hatedTags: hated })
  return { favoriteTags, hatedTags }
}

export async function importF95Checker(dbPath: string): Promise<F95CheckerImportResult> {
  if (!existsSync(dbPath)) throw new Error('F95Checker database not found.')
  const db = new DatabaseSync(dbPath, { readOnly: true })
  let games: Row[]
  let events: Row[]
  let settingsRow: Row | undefined
  try {
    if (!tableExists(db, 'games')) throw new Error('That file is not an F95Checker database.')
    games = readRows(db, 'games')
    events = readRows(db, 'timeline_events')
    settingsRow = readRows(db, 'settings')[0]
  } finally {
    db.close()
  }

  const eventMap = eventsByGame(events)
  const f95Games = games.filter(isF95Game)
  const entries = f95Games.map((row) => subscriptionFor(row, eventMap.get(num(row.id))))
  const { added, merged } = await mergeImportedSubscriptions(entries)

  let notes = 0
  for (const row of f95Games) {
    if (await importNote(num(row.id), text(row.notes))) notes += 1
  }

  const exeDir = osDir(settingsRow?.default_exe_dir)
  let installs = 0
  let missingInstalls = 0
  for (const [index, row] of f95Games.entries()) {
    if (!jsonValue<string[]>(row.executables, []).length) continue
    const exePath = resolveExecutable(row, exeDir)
    if (!exePath) {
      missingInstalls += 1
      continue
    }
    try {
      await importInstall(entries[index], row, exePath)
      installs += 1
    } catch (error) {
      console.warn('[f95checker] install import failed', row.id, error)
      missingInstalls += 1
    }
  }

  const dirs = await importDirs(settingsRow)
  const tags = await importTagHighlights(settingsRow)
    .then((result) => ({ ...result, skippedTagHighlights: 0 }))
    .catch((error) => {
      console.warn('[f95checker] tag highlight import failed', error)
      const skippedTagHighlights = Object.keys(
        jsonValue<Record<string, number>>(settingsRow?.tags_highlights, {})
      ).length
      return { favoriteTags: 0, hatedTags: 0, skippedTagHighlights }
    })

  void enrichIncompleteSubscriptions().catch(() => undefined)

  return {
    found: games.length,
    added,
    merged,
    skippedCustom: games.length - f95Games.length,
    notes,
    rated: f95Games.filter((row) => num(row.rating) > 0).length,
    installs,
    missingInstalls,
    ...dirs,
    ...tags
  }
}
