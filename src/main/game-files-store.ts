import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises'
import { basename, dirname, join, resolve, sep } from 'path'
import type { BrowserWindow } from 'electron'
import { shell } from 'electron'
import { compareGameVersions, engineKind, normalizeEngine } from '@shared/engines'
import type { GameFileContext, GameLibraryFile, InstalledPatchRef } from '@shared/types'
import {
  asPackageTagHint,
  gameHasInstalledPatch,
  isInstallableLibraryPackage,
  isRenpyUncensorPackage
} from '@shared/types'
import { folderBytes } from './disk-usage'
import { extractArchive } from './extract'
import { isArchivePath, sanitizeSegment } from './fs-utils'
import {
  detectEngineFromInstall,
  detectExecutable,
  findRenpyGameRoot,
  launchExecutable,
  pickExecutable
} from './launch'
import { getAppPaths } from './paths'
import { startPlaySession, getPlaySession, stopPlaySession } from './play-sessions'
import { listProcessExecutables, killProcessesUnder, pathIsInside } from './processes'
import { gameDirFromRoot } from './renpy/scan'
import { applyUncensorPatchToGameDir, getUncensorUninstallSlot, isRenpyScriptPath, isUncensorPatchInstallable, removeUncensorPatchFromGameDir } from './renpy/uncensor-patch'
import { getDownloadsDirSync, getLibraryDirSync } from './settings-store'
import { maxLikeCount, maxViewCount, pickLikeCount, pickViewCount, saneLikeCount, saneViewCount } from '@shared/counts'
import { uniqueScreenUrls } from './f95/catalog'
import { lookupGame } from './f95/lookup'
import { listSubscriptions, recordSubscriptionPlay } from './subscriptions-store'
import { pathExists, resolveLongPath, toFsPath } from './win-path'
import { sendToRenderer } from './windows'
import {
  pauseTorrentsForArchive,
  resumeTorrentsByIds,
  teardownP2pForContentHash
} from './p2p/webtorrent-service'
import { removeTorrentMapEntry } from './p2p/torrent-map-store'

type StoredGameFile = Omit<
  GameLibraryFile,
  'hasArchive' | 'isInstalled' | 'installPercent' | 'playing'
> & { installError?: string }

const installing = new Map<string, { percent: number; error?: string }>()
let loaded: StoredGameFile[] | null = null
const hydratedThreads = new Set<number>()

type ThreadMeta = {
  threadId: number
  title?: string
  creator?: string
  coverUrl?: string | null
  rating?: number
  likes?: number
  views?: number
  threadUrl?: string
  prefixes?: number[]
  tags?: number[]
  engine?: string
  timestamp?: number
  updatedAt?: string
  screens?: string[]
}

function firstScreens(...lists: Array<string[] | undefined | null>): string[] {
  let best: string[] = []
  for (const list of lists) {
    const urls = uniqueScreenUrls(list)
    if (urls.length > best.length) best = urls
  }
  return best
}

function sameScreens(left?: string[], right?: string[]): boolean {
  if (!left?.length && !right?.length) return true
  if (!left || !right || left.length !== right.length) return false
  return left.every((url, index) => url === right[index])
}

function firstText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function firstIds(...lists: Array<number[] | undefined | null>): number[] {
  for (const list of lists) {
    if (list?.length) return list
  }
  return []
}

function sameIds(left?: number[], right?: number[]): boolean {
  if (!left?.length && !right?.length) return true
  if (!left || !right || left.length !== right.length) return false
  const other = new Set(right)
  return left.every((id) => other.has(id))
}

function mergeThreadMeta(...parts: Array<ThreadMeta | GameFileContext | StoredGameFile | undefined>): ThreadMeta {
  const present = parts.filter(Boolean) as Array<ThreadMeta | GameFileContext | StoredGameFile>
  return {
    threadId: present[0]?.threadId || 0,
    title: firstText(...present.map((item) => item.title)),
    creator: firstText(...present.map((item) => ('creator' in item ? item.creator : ''))),
    coverUrl: present.map((item) => ('coverUrl' in item ? item.coverUrl : null)).find(Boolean) || null,
    rating: Math.max(0, ...present.map((item) => Number('rating' in item ? item.rating : 0) || 0)),
    likes: maxLikeCount(...present.map((item) => ('likes' in item ? item.likes : 0))),
    views: maxViewCount(...present.map((item) => ('views' in item ? item.views : 0))),
    threadUrl: firstText(...present.map((item) => ('threadUrl' in item ? item.threadUrl : ''))),
    prefixes: firstIds(...present.map((item) => ('prefixes' in item ? item.prefixes : undefined))),
    tags: firstIds(...present.map((item) => ('tags' in item ? item.tags : undefined))),
    engine: firstText(...present.map((item) => item.engine)),
    timestamp: Math.max(0, ...present.map((item) => Number('timestamp' in item ? item.timestamp : 0) || 0)),
    updatedAt: firstText(...present.map((item) => ('updatedAt' in item ? item.updatedAt : ''))),
    screens: firstScreens(...present.map((item) => ('screens' in item ? item.screens : undefined)))
  }
}

function applyMetaToFile(file: StoredGameFile, meta: ThreadMeta): boolean {
  let changed = false
  if (meta.title && meta.title !== file.title) {
    file.title = meta.title
    changed = true
  }
  if (meta.creator && meta.creator !== file.creator) {
    file.creator = meta.creator
    changed = true
  }
  if (meta.coverUrl && meta.coverUrl !== file.coverUrl) {
    file.coverUrl = meta.coverUrl
    changed = true
  }
  const rating = Math.max(file.rating || 0, meta.rating || 0)
  if (rating !== (file.rating || 0)) {
    file.rating = rating
    changed = true
  }
  const likes = pickLikeCount(meta.likes, file.likes)
  if (likes !== (file.likes || 0)) {
    file.likes = likes
    changed = true
  }
  const views = pickViewCount(meta.views, file.views)
  if (views !== (file.views || 0)) {
    file.views = views
    changed = true
  }
  if (meta.threadUrl && meta.threadUrl !== file.threadUrl) {
    file.threadUrl = meta.threadUrl
    changed = true
  }
  if (meta.prefixes?.length && !sameIds(file.prefixes, meta.prefixes)) {
    file.prefixes = meta.prefixes
    changed = true
  }
  if (meta.tags?.length && !sameIds(file.tags, meta.tags)) {
    file.tags = meta.tags
    changed = true
  }
  if (meta.engine && !file.engine) {
    file.engine = normalizeEngine(meta.engine)
    changed = true
  }
  const timestamp = Math.max(file.timestamp || 0, meta.timestamp || 0)
  if (timestamp !== (file.timestamp || 0)) {
    file.timestamp = timestamp
    changed = true
  }
  if (meta.updatedAt && meta.updatedAt !== file.updatedAt) {
    file.updatedAt = meta.updatedAt
    changed = true
  }
  if (meta.screens?.length && !sameScreens(file.screens, meta.screens)) {
    file.screens = meta.screens
    changed = true
  }
  return changed
}

function applyMetaToThread(files: StoredGameFile[], meta: ThreadMeta): boolean {
  if (!meta.threadId) return false
  let changed = false
  for (const file of files) {
    if (file.threadId !== meta.threadId) continue
    if (applyMetaToFile(file, meta)) changed = true
  }
  return changed
}

function propagateThreadMetadata(files: StoredGameFile[]): boolean {
  const byThread = new Map<number, StoredGameFile[]>()
  for (const file of files) {
    const list = byThread.get(file.threadId)
    if (list) list.push(file)
    else byThread.set(file.threadId, [file])
  }
  let changed = false
  for (const items of byThread.values()) {
    if (applyMetaToThread(files, mergeThreadMeta(...items))) changed = true
  }
  return changed
}

export function metadataFromSubscription(game: {
  threadId: number
  title?: string
  creator?: string
  coverUrl?: string | null
  rating?: number
  likes?: number
  views?: number
  threadUrl?: string
  prefixes?: number[]
  tags?: number[]
  engine?: string
  timestamp?: number
  updatedAt?: string
  screens?: string[]
}): ThreadMeta {
  return {
    threadId: game.threadId,
    title: game.title,
    creator: game.creator,
    coverUrl: game.coverUrl,
    rating: game.rating,
    likes: saneLikeCount(game.likes),
    views: saneViewCount(game.views),
    threadUrl: game.threadUrl,
    prefixes: game.prefixes,
    tags: game.tags,
    engine: game.engine,
    timestamp: game.timestamp,
    updatedAt: game.updatedAt,
    screens: uniqueScreenUrls(game.screens)
  }
}

export async function applyThreadMetadata(meta: ThreadMeta): Promise<void> {
  if (!meta.threadId) return
  const files = await readStore()
  if (!applyMetaToThread(files, meta)) return
  await writeStore(files)
  broadcast()
}

export async function applyCatalogScreens(
  games: Array<{ threadId: number; screens?: string[]; likes?: number; views?: number }>
): Promise<void> {
  if (!games.length) return
  const byId = new Map(games.map((game) => [game.threadId, game]))
  const files = await readStore()
  let changed = false
  for (const file of files) {
    const incoming = byId.get(file.threadId)
    if (!incoming) continue
    const screens = uniqueScreenUrls(incoming.screens)
    if (screens.length && !sameScreens(file.screens, screens)) {
      file.screens = screens
      changed = true
    }
    const likes = saneLikeCount(incoming.likes)
    if (likes && likes !== file.likes) {
      file.likes = likes
      changed = true
    }
    const views = saneViewCount(incoming.views)
    if (views && views !== file.views) {
      file.views = views
      changed = true
    }
  }
  if (!changed) return
  await writeStore(files)
  broadcast()
}

async function syncMetadataFromSubscriptions(files: StoredGameFile[]): Promise<boolean> {
  const known = new Set(files.map((file) => file.threadId))
  if (!known.size) return false
  const subscriptions = await listSubscriptions()
  let changed = false
  for (const game of subscriptions) {
    if (!known.has(game.threadId)) continue
    if (applyMetaToThread(files, metadataFromSubscription(game))) changed = true
  }
  return changed
}

function threadNeedsLookup(items: StoredGameFile[]): boolean {
  const merged = mergeThreadMeta(...items)
  return !merged.coverUrl || !merged.creator || !merged.prefixes?.length
}

async function hydrateSparseLibraryFiles(files: StoredGameFile[]): Promise<void> {
  const byThread = new Map<number, StoredGameFile[]>()
  for (const file of files) {
    const list = byThread.get(file.threadId)
    if (list) list.push(file)
    else byThread.set(file.threadId, [file])
  }
  for (const [threadId, items] of byThread) {
    if (hydratedThreads.has(threadId) || !threadNeedsLookup(items)) continue
    hydratedThreads.add(threadId)
    const sample = items[0]
    try {
      const details = await lookupGame(threadId, sample.title, sample.creator)
      if (!details) continue
      const latest = await readStore()
      const meta = mergeThreadMeta(...latest.filter((file) => file.threadId === threadId), {
        threadId,
        title: details.title,
        creator: details.creator,
        coverUrl: details.coverUrl,
        rating: details.rating,
        likes: saneLikeCount(details.likes),
        views: saneViewCount(details.views),
        prefixes: details.prefixes,
        tags: details.tags,
        timestamp: details.timestamp,
        updatedAt: details.updatedAt,
        threadUrl: `https://f95zone.to/threads/${threadId}/`,
        screens: uniqueScreenUrls(details.screens)
      })
      if (applyMetaToThread(latest, meta)) {
        await writeStore(latest)
        broadcast()
      }
    } catch {
      hydratedThreads.delete(threadId)
    }
  }
}

function nextId(): string {
  return `gf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function present(file: StoredGameFile): GameLibraryFile {
  const job = installing.get(file.id)
  const installPath = file.installPath
  return {
    ...file,
    engine: file.engine || '',
    executablePath: file.executablePath || null,
    lastPlayedAt: file.lastPlayedAt ?? null,
    playtimeMs: file.playtimeMs ?? 0,
    playing: Boolean(getPlaySession(file.id)),
    hasArchive: Boolean(file.archivePath && pathExists(file.archivePath)),
    isInstalled: Boolean(installPath && pathExists(installPath)),
    installPercent: job ? job.percent : null,
    installError: job?.error ?? file.installError,
    creator: file.creator || '',
    coverUrl: file.coverUrl ?? null,
    rating: file.rating || 0,
    likes: saneLikeCount(file.likes),
    views: saneViewCount(file.views),
    threadUrl: file.threadUrl || `https://f95zone.to/threads/${file.threadId}/`,
    prefixes: file.prefixes ?? [],
    tags: file.tags ?? [],
    timestamp: file.timestamp || 0,
    updatedAt: file.updatedAt || '',
    renpySaveDirectory: file.renpySaveDirectory,
    installedPatches: Array.isArray(file.installedPatches) ? file.installedPatches : undefined,
    uncensorInstallable: file.uncensorInstallable,
    screens: uniqueScreenUrls(file.screens),
    packageTags: asPackageTagHint(file.packageTags)
  }
}

async function readStore(): Promise<StoredGameFile[]> {
  if (loaded) return loaded
  try {
    const raw = await readFile(getAppPaths().gameFilesFile, 'utf8')
    const parsed = JSON.parse(raw) as { files?: StoredGameFile[] } | StoredGameFile[]
    loaded = (Array.isArray(parsed) ? parsed : (parsed.files ?? [])).map((file) => ({
      ...file,
      engine: file.engine || '',
      executablePath: file.executablePath ?? null,
      lastPlayedAt: file.lastPlayedAt ?? null,
      playtimeMs: Number(file.playtimeMs) || 0,
      creator: file.creator || '',
      coverUrl: file.coverUrl ?? null,
      rating: Number(file.rating) || 0,
      likes: saneLikeCount(file.likes),
      views: saneViewCount(file.views),
      threadUrl: file.threadUrl || '',
      prefixes: file.prefixes ?? [],
      tags: file.tags ?? [],
      timestamp: Number(file.timestamp) || 0,
      updatedAt: file.updatedAt || '',
      renpySaveDirectory: file.renpySaveDirectory,
      installedPatches: normalizeInstalledPatches(file.installedPatches),
      uncensorInstallable:
        typeof file.uncensorInstallable === 'boolean' ? file.uncensorInstallable : undefined,
      screens: uniqueScreenUrls(file.screens),
      packageTags: asPackageTagHint(file.packageTags)
    }))
  } catch {
    loaded = []
  }
  return loaded
}

function normalizeInstalledPatches(raw: unknown): InstalledPatchRef[] | undefined {
  if (!Array.isArray(raw) || !raw.length) return undefined
  const patches: InstalledPatchRef[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Partial<InstalledPatchRef>
    const patchId = String(row.patchId || '')
    const hash = String(row.hash || '')
    const filename = String(row.filename || '')
    const installedAt = Number(row.installedAt) || 0
    const uninstallSlot = row.uninstallSlot ? String(row.uninstallSlot) : undefined
    if (!patchId && !hash) continue
    patches.push({ patchId, hash, filename, installedAt, uninstallSlot })
  }
  return patches.length ? patches : undefined
}

async function writeStore(files: StoredGameFile[]): Promise<void> {
  loaded = files
  const file = getAppPaths().gameFilesFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify({ files }, null, 2), 'utf8')
}

function broadcast(): void {
  sendToRenderer('library:changed', (loaded ?? []).map(present))
}

async function hydrateLaunchInfo(files: StoredGameFile[]): Promise<boolean> {
  let changed = false
  for (const file of files) {
    if (installing.has(file.id) || !file.installPath || !pathExists(file.installPath)) continue
    if (!file.engine) {
      const detected = detectEngineFromInstall(file.installPath)
      if (detected) {
        file.engine = detected
        changed = true
      }
    }
    if (file.executablePath && pathExists(file.executablePath)) {
      const longPath = resolveLongPath(file.executablePath)
      if (longPath !== file.executablePath) {
        file.executablePath = longPath
        changed = true
      }
    } else {
      const exe = detectExecutable(file.installPath, file.engine)
      if (exe) {
        file.executablePath = exe
        changed = true
      }
    }
  }
  return changed
}

export async function listGameFiles(threadId?: number): Promise<GameLibraryFile[]> {
  const files = await readStore()
  let changed = await hydrateLaunchInfo(files)
  if (propagateThreadMetadata(files)) changed = true
  if (await syncMetadataFromSubscriptions(files)) changed = true
  if (await hydrateUncensorInstallableFlags(files)) changed = true
  if (changed) {
    await writeStore(files)
    broadcast()
  }
  const kept = files.filter((file) => fileStillPresent(file))
  if (kept.length !== files.length) {
    await writeStore(kept)
    broadcast()
  }
  void hydrateSparseLibraryFiles(kept)
  const visible = threadId ? kept.filter((file) => file.threadId === threadId) : kept
  return visible.map(present).sort((a, b) => b.downloadedAt - a.downloadedAt)
}

async function hydrateUncensorInstallableFlags(files: StoredGameFile[]): Promise<boolean> {
  let changed = false
  for (const file of files) {
    if (!isRenpyUncensorPackage(file.packageTags)) {
      if (file.uncensorInstallable !== undefined) {
        delete file.uncensorInstallable
        changed = true
      }
      continue
    }
    if (!file.archivePath || !pathExists(file.archivePath)) {
      if (file.uncensorInstallable !== false) {
        file.uncensorInstallable = false
        changed = true
      }
      continue
    }
    if (typeof file.uncensorInstallable === 'boolean') continue
    try {
      file.uncensorInstallable = await isUncensorPatchInstallable(file.archivePath)
    } catch {
      file.uncensorInstallable = false
    }
    changed = true
  }
  return changed
}

export async function gameDiskUsage(threadId: number): Promise<{ archiveBytes: number; installBytes: number }> {
  const files = await listGameFiles(threadId)
  const archiveBytes = files.reduce((sum, file) => sum + (file.hasArchive ? file.size || 0 : 0), 0)
  const seen = new Set<string>()
  let installBytes = 0
  for (const file of files) {
    if (!file.isInstalled || !file.installPath) continue
    const key = resolve(file.installPath).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    installBytes += folderBytes(file.installPath)
  }
  return { archiveBytes, installBytes }
}

export async function addGameFileFromDownload(
  context: GameFileContext,
  archivePath: string,
  hash: string,
  size: number
): Promise<GameLibraryFile> {
  const files = await readStore()
  const siblings = files.filter((file) => file.threadId === context.threadId)
  const meta = mergeThreadMeta(...siblings, context)
  const existing = files.find((file) => file.threadId === context.threadId && file.hash === hash)
  const packageTags = asPackageTagHint(context.packageHint)
  if (existing) {
    existing.archivePath = archivePath
    existing.filename = basename(archivePath)
    existing.size = size
    // Approved package tags win; otherwise keep prior version when context omits one.
    if (packageTags) {
      existing.packageTags = packageTags
      existing.version = packageTags.version
    } else if (context.version) {
      existing.version = context.version
    }
    existing.engine = normalizeEngine(context.engine) || existing.engine || ''
    existing.uncensorInstallable = undefined
    applyMetaToFile(existing, meta)
    applyMetaToThread(files, meta)
    await writeStore(files)
    broadcast()
    return present(existing)
  }

  const entry: StoredGameFile = {
    id: nextId(),
    threadId: context.threadId,
    title: context.title || meta.title || 'Unknown',
    version: packageTags ? packageTags.version : context.version || '',
    engine: normalizeEngine(context.engine) || normalizeEngine(meta.engine),
    filename: basename(archivePath),
    archivePath,
    hash,
    size,
    downloadedAt: Date.now(),
    installPath: null,
    installedAt: null,
    executablePath: null,
    lastPlayedAt: null,
    playtimeMs: 0,
    creator: context.creator || meta.creator || '',
    coverUrl: context.coverUrl || meta.coverUrl || null,
    rating: context.rating || meta.rating || 0,
    likes: pickLikeCount(context.likes, meta.likes),
    views: pickViewCount(context.views, meta.views),
    threadUrl: context.threadUrl || meta.threadUrl || `https://f95zone.to/threads/${context.threadId}/`,
    prefixes: context.prefixes?.length ? context.prefixes : meta.prefixes,
    tags: context.tags?.length ? context.tags : meta.tags,
    timestamp: context.timestamp || meta.timestamp || 0,
    updatedAt: context.updatedAt || meta.updatedAt || '',
    screens: uniqueScreenUrls(context.screens).length
      ? uniqueScreenUrls(context.screens)
      : uniqueScreenUrls(meta.screens),
    packageTags
  }
  files.push(entry)
  applyMetaToThread(files, mergeThreadMeta(meta, entry))
  await writeStore(files)
  broadcast()
  return present(entry)
}

function installDest(file: StoredGameFile): string {
  return join(
    getLibraryDirSync(),
    sanitizeSegment(file.title),
    sanitizeSegment(file.version || 'unknown')
  )
}

function fileStillPresent(file: StoredGameFile): boolean {
  if (installing.has(file.id)) return true
  return Boolean(file.archivePath && pathExists(file.archivePath)) || Boolean(file.installPath && pathExists(file.installPath))
}

function applyEngineHint(file: StoredGameFile, engineHint?: string, installPath?: string | null): void {
  const hinted = normalizeEngine(engineHint)
  if (hinted) file.engine = hinted
  if (!file.engine && installPath) file.engine = detectEngineFromInstall(installPath)
}

function usesRpgMakerSaves(file: StoredGameFile): boolean {
  return !file.engine || engineKind(file.engine) === 'rpgmaker'
}

async function syncRpgMakerForFile(file: StoredGameFile, mode: 'merge' | 'backup'): Promise<void> {
  if (!usesRpgMakerSaves(file)) return
  try {
    const { syncRpgMakerSaves } = await import('./rpgmaker/saves')
    await syncRpgMakerSaves({
      installPath: file.installPath,
      threadId: file.threadId,
      title: file.title,
      mode
    })
  } catch (error) {
    console.warn('Could not sync RPG Maker saves', error)
  }
}

export async function installGameFile(id: string, engineHint?: string): Promise<GameLibraryFile> {
  const files = await readStore()
  const file = files.find((item) => item.id === id)
  if (!file) throw new Error('That file is not in the library.')
  if (!isInstallableLibraryPackage(file.packageTags)) {
    throw new Error('Only full game packages can be installed.')
  }
  if (!file.archivePath || !pathExists(file.archivePath)) {
    throw new Error('The archive is missing from disk.')
  }
  if (installing.has(id)) {
    throw new Error('That archive is already being installed.')
  }

  const pausedTorrentIds = await pauseTorrentsForArchive(file.archivePath, file.hash, {
    silent: true
  })

  const dest = installDest(file)
  installing.set(id, { percent: 0 })
  broadcast()

  try {
    if (pathExists(dest)) {
      assertManagedPath(dest)
      await rm(toFsPath(dest), { recursive: true, force: true })
    }
    await extractArchive(file.archivePath, dest, (percent) => {
      installing.set(id, { percent })
      broadcast()
    })
    file.installPath = dest
    file.installedAt = Date.now()
    file.installError = undefined
    file.installedPatches = undefined
    applyEngineHint(file, engineHint, dest)
    file.executablePath = detectExecutable(dest, file.engine)
    await writeStore(files)
    installing.delete(id)
    await syncRpgMakerForFile(file, 'merge')
    try {
      const { ensureRenpyOptionsForLibraryFile } = await import('./renpy/options-prefs')
      await ensureRenpyOptionsForLibraryFile(file)
    } catch (error) {
      console.warn('Could not apply Ren\'Py options', error)
    }
    broadcast()
    return present(file)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not extract that archive.'
    installing.delete(id)
    file.installError = message
    await writeStore(files)
    broadcast()
    throw new Error(message)
  } finally {
    await resumeTorrentsByIds(pausedTorrentIds)
  }
}

function patchSourceReady(file: StoredGameFile): boolean {
  return Boolean(file.archivePath && pathExists(file.archivePath))
}

function isRenpyInstalledGame(file: StoredGameFile): boolean {
  if (!file.installPath || !pathExists(file.installPath)) return false
  if (!isInstallableLibraryPackage(file.packageTags)) return false
  if (engineKind(file.engine) === 'renpy') return true
  return Boolean(findRenpyGameRoot(file.installPath))
}

/** Installed Ren'Py game versions on the same thread that do not already have this patch. */
export function listUncensorPatchTargets(
  files: GameLibraryFile[],
  patch: GameLibraryFile
): GameLibraryFile[] {
  if (!isRenpyUncensorPackage(patch.packageTags)) return []
  return files
    .filter((file) => {
      if (file.threadId !== patch.threadId) return false
      if (!file.isInstalled || !isInstallableLibraryPackage(file.packageTags)) return false
      const kind = engineKind(file.engine)
      if (kind && kind !== 'renpy') return false
      return !gameHasInstalledPatch(file, patch)
    })
    .sort((a, b) => {
      const versions = compareGameVersions(a.version, b.version)
      if (versions) return versions
      return (a.installedAt || 0) - (b.installedAt || 0)
    })
}

/**
 * Best-effort apply a Ren'Py uncensor patch into an installed game's `/game` folder.
 * Records the patch on the target game; cleared when that game is uninstalled.
 */
export async function installUncensorPatch(
  patchId: string,
  targetFileId: string
): Promise<GameLibraryFile> {
  const files = await readStore()
  const patch = files.find((item) => item.id === patchId)
  if (!patch) throw new Error('That uncensor patch is not in the library.')
  if (!isRenpyUncensorPackage(patch.packageTags)) {
    throw new Error('Only uncensor patches can be installed this way.')
  }
  if (!patchSourceReady(patch)) {
    throw new Error('The uncensor patch file is missing from disk.')
  }
  const sourcePath = patch.archivePath
  if (!isArchivePath(sourcePath) && !isRenpyScriptPath(sourcePath)) {
    throw new Error('Uncensor patches must be a .rpy/.rpyc file or a zip/7z/rar archive.')
  }
  if (installing.has(patchId) || installing.has(targetFileId)) {
    throw new Error('An install is already in progress for that file.')
  }

  const target = files.find((item) => item.id === targetFileId)
  if (!target) throw new Error('That game version is not in the library.')
  if (target.threadId !== patch.threadId) {
    throw new Error('That uncensor patch belongs to a different game.')
  }
  if (!isRenpyInstalledGame(target)) {
    throw new Error('Install a Ren\'Py game version first, then apply the uncensor patch.')
  }
  if (gameHasInstalledPatch(target, patch)) {
    throw new Error('That uncensor patch is already installed on this game version.')
  }

  const gameRoot = findRenpyGameRoot(target.installPath || '')
  if (!gameRoot) {
    throw new Error('Could not find the Ren\'Py game folder for that install.')
  }
  const targetGameDir = gameDirFromRoot(gameRoot)
  const tempParent = join(getLibraryDirSync(), '.tmp-patches')

  const pausedTorrentIds = await pauseTorrentsForArchive(sourcePath, patch.hash, {
    silent: true
  })

  installing.set(patchId, { percent: 0 })
  broadcast()

  try {
    const installable = await isUncensorPatchInstallable(sourcePath)
    if (!installable) {
      throw new Error('That file is not a supported Ren\'Py uncensor patch layout.')
    }
    const meta = {
      patchId: patch.id,
      hash: patch.hash,
      filename: patch.filename || basename(sourcePath)
    }
    const applied = await applyUncensorPatchToGameDir(
      sourcePath,
      targetGameDir,
      tempParent,
      meta,
      (percent) => {
        installing.set(patchId, { percent })
        broadcast()
      }
    )

    const entry: InstalledPatchRef = {
      patchId: patch.id,
      hash: patch.hash,
      filename: patch.filename || basename(sourcePath),
      installedAt: Date.now(),
      uninstallSlot: applied.uninstallSlot || getUncensorUninstallSlot(meta)
    }
    const existing = target.installedPatches ?? []
    target.installedPatches = [
      ...existing.filter((item) => item.patchId !== entry.patchId && item.hash !== entry.hash),
      entry
    ]
    if (!target.engine) target.engine = "Ren'Py"
    patch.installError = undefined
    patch.uncensorInstallable = true
    await writeStore(files)
    installing.delete(patchId)
    broadcast()
    return present(target)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not install that uncensor patch.'
    installing.delete(patchId)
    patch.installError = message
    await writeStore(files)
    broadcast()
    throw new Error(message)
  } finally {
    await resumeTorrentsByIds(pausedTorrentIds)
  }
}

/**
 * Remove an applied uncensor patch from an installed game using on-disk `.uninstall` instructions.
 * Works even if the original patch archive was removed from the library.
 */
export async function uninstallUncensorPatch(
  gameFileId: string,
  patchRef: { patchId?: string; hash?: string; uninstallSlot?: string }
): Promise<GameLibraryFile> {
  const { files, file: target } = await getFile(gameFileId)
  if (!isRenpyInstalledGame(target)) {
    throw new Error('That Ren\'Py game version is not installed.')
  }
  if (installing.has(gameFileId)) {
    throw new Error('That game is busy with another install.')
  }

  const gameRoot = findRenpyGameRoot(target.installPath || '')
  if (!gameRoot) {
    throw new Error('Could not find the Ren\'Py game folder for that install.')
  }
  const targetGameDir = gameDirFromRoot(gameRoot)

  const match = {
    patchId: patchRef.patchId || '',
    hash: patchRef.hash || '',
    uninstallSlot: patchRef.uninstallSlot
  }
  if (!match.patchId && !match.hash && !match.uninstallSlot) {
    throw new Error('Which uncensor patch should be removed?')
  }

  installing.set(gameFileId, { percent: 5 })
  broadcast()
  try {
    await removeUncensorPatchFromGameDir(targetGameDir, match)
    target.installedPatches = (target.installedPatches ?? []).filter((item) => {
      if (match.uninstallSlot && item.uninstallSlot === match.uninstallSlot) return false
      if (match.hash && item.hash && item.hash === match.hash) return false
      if (match.patchId && item.patchId && item.patchId === match.patchId) return false
      return true
    })
    if (!target.installedPatches.length) target.installedPatches = undefined
    await writeStore(files)
    installing.delete(gameFileId)
    broadcast()
    return present(target)
  } catch (error) {
    installing.delete(gameFileId)
    broadcast()
    throw error instanceof Error ? error : new Error(String(error))
  }
}

export async function showGameArchive(id: string): Promise<void> {
  const files = await readStore()
  const file = files.find((item) => item.id === id)
  if (!file?.archivePath || !pathExists(file.archivePath)) {
    throw new Error('The archive is missing from disk.')
  }
  await pauseTorrentsForArchive(file.archivePath, file.hash)
  shell.showItemInFolder(file.archivePath)
}

export async function showGameInstall(id: string): Promise<void> {
  const files = await readStore()
  const file = files.find((item) => item.id === id)
  if (!file?.installPath || !pathExists(file.installPath)) {
    throw new Error('That game is not installed.')
  }
  const error = await shell.openPath(file.installPath)
  if (error) throw new Error(error)
}

async function requireInstalled(id: string): Promise<StoredGameFile> {
  const files = await readStore()
  const file = files.find((item) => item.id === id)
  if (!file) throw new Error('That file is not in the library.')
  if (!file.installPath || !pathExists(file.installPath)) {
    throw new Error('That game is not installed.')
  }
  return file
}

async function resolvePlayableExe(
  file: StoredGameFile,
  parent?: BrowserWindow | null,
  forcePick = false
): Promise<string> {
  if (!forcePick && file.executablePath && pathExists(file.executablePath)) {
    return resolveLongPath(file.executablePath)
  }
  if (!forcePick && file.installPath) {
    const detected = detectExecutable(file.installPath, file.engine)
    if (detected) {
      file.executablePath = detected
      const files = await readStore()
      const current = files.find((item) => item.id === file.id)
      if (current) current.executablePath = detected
      await writeStore(files)
      broadcast()
      return detected
    }
  }
  const picked = await pickExecutable(file.installPath || '', parent)
  if (!picked) throw new Error('No executable selected.')
  file.executablePath = picked
  const files = await readStore()
  const current = files.find((item) => item.id === file.id)
  if (current) current.executablePath = picked
  await writeStore(files)
  broadcast()
  return picked
}

export function latestInstalledFile(files: GameLibraryFile[]): GameLibraryFile | null {
  const installed = files.filter(
    (file) => file.isInstalled && isInstallableLibraryPackage(file.packageTags)
  )
  if (!installed.length) return null
  return [...installed].sort((a, b) => {
    const versions = compareGameVersions(a.version, b.version)
    if (versions) return versions
    return (a.installedAt || 0) - (b.installedAt || 0)
  }).at(-1) ?? null
}

export async function playGameFile(
  id: string,
  parent?: BrowserWindow | null,
  engineHint?: string
): Promise<GameLibraryFile> {
  const file = await requireInstalled(id)
  const hinted = normalizeEngine(engineHint)
  if (hinted && !file.engine) {
    file.engine = hinted
    const files = await readStore()
    const current = files.find((item) => item.id === file.id)
    if (current) current.engine = hinted
    await writeStore(files)
  }
  const exe = await resolvePlayableExe(file, parent)
  if (getPlaySession(file.id)) return present(file)
  await syncRpgMakerForFile(file, 'merge')
  const launched = await launchExecutable(exe)
  startPlaySession({
    fileId: file.id,
    threadId: file.threadId,
    version: file.version,
    pid: launched.pid,
    installPath: file.installPath || dirname(exe),
    backupSaves: usesRpgMakerSaves(file)
  })
  file.lastPlayedAt = Date.now()
  const files = await readStore()
  const current = files.find((item) => item.id === file.id)
  if (current) current.lastPlayedAt = file.lastPlayedAt
  await writeStore(files)
  await recordSubscriptionPlay(file.threadId, file.version)
  broadcast()
  return present(file)
}

export async function playLatestGameFile(
  threadId: number,
  parent?: BrowserWindow | null,
  engineHint?: string
): Promise<GameLibraryFile> {
  const latest = latestInstalledFile(await listGameFiles(threadId))
  if (!latest) throw new Error('No installed version is available to play.')
  return playGameFile(latest.id, parent, engineHint)
}

export async function chooseGameExecutable(
  id: string,
  parent?: BrowserWindow | null
): Promise<GameLibraryFile> {
  const file = await requireInstalled(id)
  await resolvePlayableExe(file, parent, true)
  return present((await readStore()).find((item) => item.id === id) ?? file)
}

export async function getGameFile(id: string): Promise<StoredGameFile> {
  const { file } = await getFile(id)
  return file
}

export async function setRenpySaveDirectory(id: string, saveDirectory: string | null | undefined): Promise<void> {
  const { files, file } = await getFile(id)
  if (saveDirectory === undefined) {
    delete file.renpySaveDirectory
  } else {
    file.renpySaveDirectory = saveDirectory
  }
  await writeStore(files)
  broadcast()
}

function isInside(target: string, root: string): boolean {
  const resolved = resolve(target)
  const base = resolve(root)
  return resolved === base || resolved.startsWith(base + sep)
}

function assertManagedPath(target: string): void {
  if (isInside(target, getLibraryDirSync()) || isInside(target, getDownloadsDirSync())) return
  throw new Error('Refusing to delete a path outside the library or downloads folders.')
}

async function removePath(target: string | null | undefined): Promise<void> {
  if (!target || !pathExists(target)) return
  assertManagedPath(target)
  await rm(toFsPath(target), { recursive: true, force: true })
}

async function removeEmptyParents(start: string | null | undefined, stopAt: string): Promise<void> {
  if (!start) return
  let current = dirname(resolve(start))
  const root = resolve(stopAt)
  while (current.startsWith(root + sep) || current === root) {
    if (current === root) break
    try {
      const entries = await readdir(toFsPath(current))
      if (entries.length) break
      assertManagedPath(current)
      await rm(toFsPath(current), { recursive: false })
      current = dirname(current)
    } catch {
      break
    }
  }
}

async function getFile(id: string): Promise<{ files: StoredGameFile[]; file: StoredGameFile }> {
  const files = await readStore()
  const file = files.find((item) => item.id === id)
  if (!file) throw new Error('That file is not in the library.')
  return { files, file }
}

export async function uninstallGameFile(id: string): Promise<GameLibraryFile> {
  if (installing.has(id)) throw new Error('That version is still being installed.')
  await stopPlaySession(id)
  const { files, file } = await getFile(id)
  const installPath = file.installPath
  if (installPath) await killProcessesUnder(installPath)
  await syncRpgMakerForFile(file, 'backup')
  await removePath(installPath)
  await removeEmptyParents(installPath, getLibraryDirSync())
  file.installPath = null
  file.installedAt = null
  file.executablePath = null
  file.installError = undefined
  file.installedPatches = undefined
  if (fileStillPresent(file)) await writeStore(files)
  else await writeStore(files.filter((item) => item.id !== id))
  broadcast()
  return present(file)
}

export async function removeGameArchive(id: string): Promise<GameLibraryFile> {
  if (installing.has(id)) throw new Error('That version is still being installed.')
  const { files, file } = await getFile(id)
  const removedHash = file.hash
  await removePath(file.archivePath)
  file.archivePath = ''
  // Keep hash for history, but stop seeding so P2P re-download can start without restart.
  if (removedHash) {
    try {
      await teardownP2pForContentHash(removedHash)
      await removeTorrentMapEntry(removedHash)
    } catch (error) {
      console.warn('[library] p2p teardown after archive remove failed', error)
    }
  }
  if (fileStillPresent(file)) await writeStore(files)
  else await writeStore(files.filter((item) => item.id !== id))
  broadcast()
  return present(file)
}

export async function removeGameVersion(id: string): Promise<GameLibraryFile[]> {
  if (installing.has(id)) throw new Error('That version is still being installed.')
  await stopPlaySession(id)
  const { files, file } = await getFile(id)
  const removedHash = file.hash
  const installPath = file.installPath
  if (installPath) await killProcessesUnder(installPath)
  await syncRpgMakerForFile(file, 'backup')
  await removePath(installPath)
  await removeEmptyParents(installPath, getLibraryDirSync())
  await removePath(file.archivePath)
  if (removedHash) {
    try {
      await teardownP2pForContentHash(removedHash)
      await removeTorrentMapEntry(removedHash)
    } catch (error) {
      console.warn('[library] p2p teardown after version remove failed', error)
    }
  }
  const next = files.filter((item) => item.id !== id)
  await writeStore(next)
  broadcast()
  return listGameFiles(file.threadId)
}

export async function addFilePlaytime(id: string, deltaMs: number): Promise<void> {
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return
  const files = await readStore()
  const file = files.find((item) => item.id === id)
  if (!file) return
  file.playtimeMs = (file.playtimeMs || 0) + Math.round(deltaMs)
  await writeStore(files)
  broadcast()
}

export async function adoptRunningLibrarySessions(): Promise<void> {
  const files = await readStore()
  const running = await listProcessExecutables()
  if (!running.length) return
  for (const file of files) {
    if (!file.installPath || getPlaySession(file.id)) continue
    const found = running.find((item) => pathIsInside(file.installPath || '', item.path))
    if (!found) continue
    startPlaySession({
      fileId: file.id,
      threadId: file.threadId,
      version: file.version,
      pid: found.pid,
      installPath: file.installPath,
      backupSaves: usesRpgMakerSaves(file)
    })
  }
}
