import { basename, isAbsolute, join, resolve, sep } from 'path'
import { maxLikeCount, maxViewCount, saneLikeCount, saneViewCount } from '@shared/counts'
import { engineKind } from '@shared/engines'
import { engineFromPrefixIds } from '@shared/prefixes'
import type {
  CatalogGame,
  GameLibraryFile,
  IdentifiedSaveFolder,
  LibraryStorageItem,
  SaveFolderPeekShot,
  Subscription
} from '@shared/types'
import { folderBytes, mapLimit } from './disk-usage'
import { uniqueScreenUrls, fetchCatalog } from './f95/catalog'
import { lookupGame } from './f95/lookup'
import { sanitizeCatalogQuery } from './f95/sanitize-query'
import { fetchThreadDetails } from './f95/thread'
import { listGameFiles, removeGameVersion, setRenpySaveDirectoryForThread } from './game-files-store'
import { findRenpyGameRoot } from './launch'
import {
  folderSearchQueries,
  matchSaveFoldersToGames,
  scoreSaveFolder
} from './renpy/save-folder-match'
import { gameDirFromRoot } from './renpy/scan'
import {
  clearRenpySaveFolder,
  clearSaveFolderContents,
  listRenpySaveFiles,
  listRenpySaveFolders,
  openSaveFolderPath,
  renpySavesRoot,
  saveDirectoryFromPath
} from './renpy/saves'
import {
  clearRpgMakerSaveFiles,
  findRpgMakerGameSaveDir,
  listRpgMakerBackupFolders,
  measureRpgMakerSaveBytes,
  rpgMakerBackupDir,
  rpgMakerSavesRoot
} from './rpgmaker/saves'
import { wipeRpgMakerSaveDirs } from './rpgmaker/save-disk'
import {
  listFailedSaveFolders,
  listIdentifiedSaveFolders,
  markSaveFolderIdentifyFailed,
  pruneMissingSaveFolders,
  forgetIdentifiedSaveFolder,
  forgetIdentifiedSaveFoldersForThread,
  rememberIdentifiedSaveFolders,
  saveFolderKey
} from './save-folders-store'
import { listSubscriptions } from './subscriptions-store'
import { getLibraryDirSync } from './settings-store'
import { pathExists } from './win-path'
import type { SaveFolderIdentityPatch } from './storage-identity'

const IDENTIFY_MIN_SCORE = 40
const IDENTIFY_CATALOG_QUERIES = 3

type KnownGame = {
  threadId: number
  title: string
  creator: string
  coverUrl: string | null
  engine: string
  version?: string
  rating?: number
  likes?: number
  views?: number
  threadUrl?: string
  prefixes?: number[]
  tags?: number[]
  timestamp?: number
  updatedAt?: string
  screens?: string[]
  file: GameLibraryFile | null
  inLibrary: boolean
  inFollowed: boolean
}

function firstText(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function coverOf(files: GameLibraryFile[]): string | null {
  return files.map((file) => file.coverUrl).find(Boolean) || null
}

function engineOf(files: GameLibraryFile[]): string {
  return files.map((file) => file.engine).find(Boolean) || ''
}

function pickSaveFile(files: GameLibraryFile[]): GameLibraryFile {
  return files.find((file) => file.isInstalled) || files[0]
}

function isInside(target: string, root: string): boolean {
  const resolved = resolve(target)
  const base = resolve(root)
  return resolved === base || resolved.startsWith(base + sep)
}

function peekShotLabel(save: {
  kind: string
  page: string
  slot: number | null
  label: string
}): string {
  if (save.kind === 'auto') return save.slot != null ? `Auto ${save.slot}` : 'Auto'
  if (save.kind === 'quick') return save.slot != null ? `Quick ${save.slot}` : 'Quick'
  if (save.kind === 'slot' && /^\d+$/.test(save.page)) {
    return save.slot != null ? `Page ${save.page} · Slot ${save.slot}` : `Page ${save.page}`
  }
  return save.label
}

export async function listSaveFolderPeek(savePath: string): Promise<SaveFolderPeekShot[]> {
  const folder = assertManagedSavePath(savePath)
  if (isInside(folder, rpgMakerSavesRoot())) return []
  const saves = await listRenpySaveFiles(folder)
  return saves
    .filter((save): save is typeof save & { thumbnailUrl: string } =>
      Boolean(save.thumbnailUrl)
    )
    .map((save) => ({
      label: peekShotLabel(save),
      page: save.page,
      saveName: save.saveName,
      thumbnailUrl: save.thumbnailUrl,
      modifiedAt: save.modifiedAt
    }))
}

export function assertManagedSavePath(savePath: string): string {
  const folder = resolve(savePath)
  const renpyRoot = resolve(renpySavesRoot())
  const rpgRoot = resolve(rpgMakerSavesRoot())
  if (isInside(folder, renpyRoot) && folder !== renpyRoot) return folder
  if (isInside(folder, rpgRoot) && folder !== rpgRoot) return folder
  const libraryDir = getLibraryDirSync()
  if (libraryDir && isInside(folder, libraryDir) && /[/\\]saves?$/i.test(folder)) return folder
  throw new Error('That folder is not a managed save directory.')
}

function resolveRenpyDirectory(saveDirectory: string): string {
  if (isAbsolute(saveDirectory)) return resolve(saveDirectory)
  return resolve(join(renpySavesRoot(), saveDirectory))
}

function inGameRenpySavePath(installPath: string | null | undefined): string | null {
  if (!installPath || !pathExists(installPath)) return null
  const root = findRenpyGameRoot(installPath)
  if (!root) return null
  return join(gameDirFromRoot(root), 'saves')
}

function upsertKnown(byThread: Map<number, KnownGame>, game: KnownGame): void {
  if (!game.threadId) return
  const prev = byThread.get(game.threadId)
  if (!prev) {
    byThread.set(game.threadId, game)
    return
  }
  byThread.set(game.threadId, {
    threadId: game.threadId,
    title: game.title || prev.title,
    creator: game.creator || prev.creator,
    coverUrl: game.coverUrl || prev.coverUrl,
    engine: game.engine || prev.engine,
    version: game.version || prev.version,
    rating: Math.max(game.rating || 0, prev.rating || 0) || undefined,
    likes: maxLikeCount(game.likes, prev.likes) || undefined,
    views: maxViewCount(game.views, prev.views) || undefined,
    threadUrl: game.threadUrl || prev.threadUrl,
    prefixes: game.prefixes?.length ? game.prefixes : prev.prefixes,
    tags: game.tags?.length ? game.tags : prev.tags,
    timestamp: Math.max(game.timestamp || 0, prev.timestamp || 0) || undefined,
    updatedAt: game.updatedAt || prev.updatedAt,
    screens: game.screens?.length ? game.screens : prev.screens,
    file: game.file || prev.file,
    inLibrary: prev.inLibrary || game.inLibrary,
    inFollowed: prev.inFollowed || game.inFollowed
  })
}

async function loadKnownGames(files: GameLibraryFile[]): Promise<Map<number, KnownGame>> {
  const byThread = new Map<number, KnownGame>()
  const libraryByThread = new Map<number, GameLibraryFile[]>()
  for (const file of files) {
    const list = libraryByThread.get(file.threadId)
    if (list) list.push(file)
    else libraryByThread.set(file.threadId, [file])
  }
  for (const [threadId, threadFiles] of libraryByThread) {
    upsertKnown(byThread, {
      threadId,
      title: firstText(...threadFiles.map((file) => file.title)) || `Thread ${threadId}`,
      creator: firstText(...threadFiles.map((file) => file.creator)),
      coverUrl: coverOf(threadFiles),
      engine: engineOf(threadFiles),
      version: firstText(...threadFiles.map((file) => file.version)),
      rating: Math.max(0, ...threadFiles.map((file) => file.rating || 0)) || undefined,
      likes: maxLikeCount(...threadFiles.map((file) => file.likes)),
      views: maxViewCount(...threadFiles.map((file) => file.views)),
      threadUrl: firstText(...threadFiles.map((file) => file.threadUrl)),
      prefixes: threadFiles.map((file) => file.prefixes).find((list) => list?.length),
      tags: threadFiles.map((file) => file.tags).find((list) => list?.length),
      timestamp: Math.max(0, ...threadFiles.map((file) => file.timestamp || 0)) || undefined,
      updatedAt: firstText(...threadFiles.map((file) => file.updatedAt)),
      screens: threadFiles.map((file) => file.screens).find((list) => list?.length),
      file: pickSaveFile(threadFiles),
      inLibrary: true,
      inFollowed: false
    })
  }

  const followed = await listSubscriptions()
  for (const game of followed) {
    upsertKnown(byThread, {
      threadId: game.threadId,
      title: game.title,
      creator: game.creator || '',
      coverUrl: game.coverUrl ?? null,
      engine: game.engine || engineFromPrefixIds(game.prefixes) || '',
      version: game.version,
      rating: game.rating,
      likes: game.likes,
      views: game.views,
      threadUrl: game.threadUrl,
      prefixes: game.prefixes,
      tags: game.tags,
      timestamp: game.timestamp,
      updatedAt: game.updatedAt,
      screens: game.screens,
      file: null,
      inLibrary: false,
      inFollowed: true
    })
  }

  for (const rec of await listIdentifiedSaveFolders()) {
    upsertKnown(byThread, {
      threadId: rec.threadId,
      title: rec.title,
      creator: rec.creator || '',
      coverUrl: rec.coverUrl,
      engine: rec.engine || '',
      version: rec.version,
      rating: rec.rating,
      likes: rec.likes,
      views: rec.views,
      threadUrl: rec.threadUrl,
      prefixes: rec.prefixes,
      tags: rec.tags,
      timestamp: rec.timestamp,
      updatedAt: rec.updatedAt,
      screens: rec.screens,
      file: null,
      inLibrary: false,
      inFollowed: false
    })
  }

  return byThread
}

function saveItem(input: {
  path: string
  folderName: string
  bytes: number
  game: KnownGame | null
  identified: boolean
  identifyFailed: boolean
  engineHint?: string
}): LibraryStorageItem {
  const game = input.game
  const threadId = game?.threadId || 0
  return {
    id: `saves:${saveFolderKey(input.path)}`,
    kind: 'saves',
    threadId,
    title: game?.title || input.folderName,
    creator: game?.creator || '',
    version: '',
    filename: 'Saves',
    coverUrl: game?.coverUrl ?? null,
    engine: game?.engine || input.engineHint || '',
    bytes: input.bytes,
    fileId: game?.file?.id || null,
    hasArchive: Boolean(game?.file?.hasArchive),
    isInstalled: Boolean(game?.file?.isInstalled),
    savePath: input.path,
    saveFolderName: input.folderName,
    inLibrary: Boolean(game?.inLibrary),
    inFollowed: Boolean(game?.inFollowed),
    identified: input.identified,
    identifyFailed: input.identifyFailed && !input.identified
  }
}

function rememberedFromKnown(
  savePath: string,
  folderName: string,
  game: KnownGame
): IdentifiedSaveFolder {
  return {
    title: game.title,
    threadId: game.threadId,
    coverUrl: game.coverUrl,
    savePath,
    folderName,
    identifiedAt: Date.now(),
    creator: game.creator || undefined,
    engine: game.engine || undefined,
    version: game.version || undefined,
    rating: game.rating || undefined,
    likes: game.likes || undefined,
    views: game.views || undefined,
    threadUrl: game.threadUrl || undefined,
    prefixes: game.prefixes?.length ? game.prefixes : undefined,
    tags: game.tags?.length ? game.tags : undefined,
    timestamp: game.timestamp || undefined,
    updatedAt: game.updatedAt || undefined,
    screens: game.screens?.length ? uniqueScreenUrls(game.screens) : undefined
  }
}

function toRemembered(item: LibraryStorageItem, game: KnownGame | null): IdentifiedSaveFolder | null {
  if (!item.threadId || !item.savePath || !item.title) return null
  if (game) return rememberedFromKnown(item.savePath, item.saveFolderName || basename(item.savePath), game)
  return {
    title: item.title,
    threadId: item.threadId,
    coverUrl: item.coverUrl,
    savePath: item.savePath,
    folderName: item.saveFolderName || basename(item.savePath),
    identifiedAt: Date.now(),
    creator: item.creator || undefined,
    engine: item.engine || undefined
  }
}

function renpySaveDirectoryForFolder(savePath: string): string | null {
  const folder = resolve(savePath)
  const root = resolve(renpySavesRoot())
  if (!isInside(folder, root) || folder === root) return null
  return saveDirectoryFromPath(folder)
}

async function rememberAndSyncSaveFolder(entry: IdentifiedSaveFolder): Promise<void> {
  await rememberIdentifiedSaveFolders([entry])
  const saveDirectory = renpySaveDirectoryForFolder(entry.savePath)
  if (!saveDirectory || !entry.threadId) return
  const files = await listGameFiles(entry.threadId)
  if (files.some((file) => file.renpySaveDirectory !== undefined)) return
  await setRenpySaveDirectoryForThread(entry.threadId, saveDirectory)
}

export async function collectSaveItems(files: GameLibraryFile[]): Promise<LibraryStorageItem[]> {
  const known = await loadKnownGames(files)
  const items: LibraryStorageItem[] = []
  const claimedFolders = new Set<string>()
  const claimedThreads = new Set<number>()
  const remember: IdentifiedSaveFolder[] = []

  const claim = (item: LibraryStorageItem): void => {
    if (!item.savePath) return
    const key = saveFolderKey(item.savePath)
    if (claimedFolders.has(key)) return
    claimedFolders.add(key)
    if (item.threadId) claimedThreads.add(item.threadId)
    items.push(item)
    if (item.identified && item.threadId) {
      const rec = toRemembered(item, known.get(item.threadId) || null)
      if (rec) remember.push(rec)
    }
  }

  const diskFolders = await listRenpySaveFolders()
  const foldersByKey = new Map(diskFolders.map((folder) => [saveFolderKey(folder.path), folder]))
  const foldersByName = new Map(diskFolders.map((folder) => [folder.name, folder]))
  const identifiedByPath = new Map(
    (await listIdentifiedSaveFolders()).map((item) => [saveFolderKey(item.savePath), item])
  )
  const failedByPath = new Map(
    (await listFailedSaveFolders()).map((item) => [saveFolderKey(item.savePath), item])
  )

  for (const game of known.values()) {
    const dir = game.file?.renpySaveDirectory
    if (!dir) continue
    const folderPath = resolveRenpyDirectory(dir)
    const disk = foldersByKey.get(saveFolderKey(folderPath))
    const bytes = disk?.bytes || (pathExists(folderPath) ? await folderBytes(folderPath) : 0)
    if (bytes <= 0) continue
    claim(
      saveItem({
        path: disk?.path || folderPath,
        folderName: disk?.name || basename(folderPath),
        bytes,
        game,
        identified: true,
        identifyFailed: false,
        engineHint: "Ren'Py"
      })
    )
  }

  for (const folder of diskFolders) {
    if (claimedFolders.has(saveFolderKey(folder.path))) continue
    const stored = identifiedByPath.get(saveFolderKey(folder.path))
    const storedGame = stored ? known.get(stored.threadId) : null
    if (stored && stored.threadId) {
      claim(
        saveItem({
          path: folder.path,
          folderName: folder.name,
          bytes: folder.bytes,
          game: storedGame
            ? {
                ...storedGame,
                title: storedGame.title || stored.title,
                coverUrl: storedGame.coverUrl || stored.coverUrl
              }
            : {
                threadId: stored.threadId,
                title: stored.title,
                creator: '',
                coverUrl: stored.coverUrl,
                engine: "Ren'Py",
                file: null,
                inLibrary: false,
                inFollowed: false
              },
          identified: true,
          identifyFailed: false,
          engineHint: "Ren'Py"
        })
      )
    }
  }

  const leftover = diskFolders.filter((folder) => !claimedFolders.has(saveFolderKey(folder.path)))
  const matchable = [...known.values()].filter((game) => game.title)
  const matches = matchSaveFoldersToGames(
    leftover.map((folder) => folder.name),
    matchable
  )
  for (const match of matches) {
    const folder = foldersByName.get(match.folderName)
    if (!folder) continue
    claim(
      saveItem({
        path: folder.path,
        folderName: folder.name,
        bytes: folder.bytes,
        game: match.game,
        identified: true,
        identifyFailed: false,
        engineHint: "Ren'Py"
      })
    )
  }

  for (const folder of diskFolders) {
    if (claimedFolders.has(saveFolderKey(folder.path))) continue
    const failed = failedByPath.get(saveFolderKey(folder.path))
    claim(
      saveItem({
        path: folder.path,
        folderName: folder.name,
        bytes: folder.bytes,
        game: null,
        identified: false,
        identifyFailed: Boolean(failed),
        engineHint: "Ren'Py"
      })
    )
  }

  const rpgBackups = await listRpgMakerBackupFolders()
  const rpgBackupByThread = new Map(rpgBackups.map((folder) => [folder.threadId, folder]))

  const remainingGames = [...known.values()].filter((game) => !claimedThreads.has(game.threadId))
  const rpgBytesByThread = new Map<number, number>()
  const inGameRenpyByThread = new Map<number, { path: string; bytes: number }>()
  await mapLimit(remainingGames, 4, async (game) => {
    const kind = engineKind(game.engine)
    if (kind === 'rpgmaker' || (!game.engine && game.inLibrary)) {
      const bytes = await measureRpgMakerSaveBytes({
        installPath: game.file?.installPath,
        threadId: game.threadId
      })
      const backup = rpgBackupByThread.get(game.threadId)
      const gameSave = findRpgMakerGameSaveDir(game.file?.installPath)
      if (bytes > 0 || (backup && pathExists(backup.path)) || (gameSave && pathExists(gameSave))) {
        rpgBytesByThread.set(game.threadId, bytes)
        return
      }
    }
    if (kind === 'rpgmaker') return
    const dir = game.file?.renpySaveDirectory
    if (dir === null) {
      const savePath = inGameRenpySavePath(game.file?.installPath)
      const bytes = savePath && pathExists(savePath) ? await folderBytes(savePath) : 0
      if (savePath && pathExists(savePath)) inGameRenpyByThread.set(game.threadId, { path: savePath, bytes })
    }
  })

  for (const game of remainingGames) {
    if (claimedThreads.has(game.threadId)) continue
    const rpgBytes = rpgBytesByThread.get(game.threadId)
    if (rpgBytes != null) {
      const backup = rpgBackupByThread.get(game.threadId)
      const gameSave = findRpgMakerGameSaveDir(game.file?.installPath)
      const folderPath =
        (backup?.path && pathExists(backup.path) && backup.path) ||
        (gameSave && pathExists(gameSave) && gameSave) ||
        backup?.path ||
        join(rpgMakerSavesRoot(), String(game.threadId))
      claim(
        saveItem({
          path: folderPath,
          folderName: backup?.name || String(game.threadId),
          bytes: rpgBytes,
          game,
          identified: true,
          identifyFailed: false,
          engineHint: 'RPG Maker'
        })
      )
      continue
    }
    const inGame = inGameRenpyByThread.get(game.threadId)
    if (!inGame) continue
    claim(
      saveItem({
        path: inGame.path,
        folderName: 'game/saves',
        bytes: inGame.bytes,
        game,
        identified: true,
        identifyFailed: false,
        engineHint: "Ren'Py"
      })
    )
  }

  for (const folder of rpgBackups) {
    if (claimedFolders.has(saveFolderKey(folder.path)) || claimedThreads.has(folder.threadId)) continue
    const stored = identifiedByPath.get(saveFolderKey(folder.path))
    const knownGame = known.get(folder.threadId) || (stored ? known.get(stored.threadId) : null)
    if (knownGame || stored) {
      const game =
        knownGame ||
        (stored
          ? {
              threadId: stored.threadId,
              title: stored.title,
              creator: '',
              coverUrl: stored.coverUrl,
              engine: 'RPG Maker',
              file: null,
              inLibrary: false,
              inFollowed: false
            }
          : null)
      claim(
        saveItem({
          path: folder.path,
          folderName: folder.name,
          bytes: folder.bytes,
          game,
          identified: true,
          identifyFailed: false,
          engineHint: 'RPG Maker'
        })
      )
      continue
    }
    const failed = failedByPath.get(saveFolderKey(folder.path))
    claim(
      saveItem({
        path: folder.path,
        folderName: folder.name,
        bytes: folder.bytes,
        game: null,
        identified: false,
        identifyFailed: Boolean(failed),
        engineHint: 'RPG Maker'
      })
    )
  }

  await rememberIdentifiedSaveFolders(remember)
  await pruneMissingSaveFolders()
  return items.sort((a, b) => b.bytes - a.bytes || a.title.localeCompare(b.title))
}

function identifiedSaveFolderPresent(item: IdentifiedSaveFolder): boolean {
  return Boolean(item.threadId && item.savePath && pathExists(item.savePath))
}

/** Identified save folders that still exist on disk. */
export async function listPresentIdentifiedSaveFolders(): Promise<IdentifiedSaveFolder[]> {
  const records: IdentifiedSaveFolder[] = []
  for (const item of await listIdentifiedSaveFolders()) {
    if (identifiedSaveFolderPresent(item)) records.push(item)
  }
  return records
}

/** Identified save folders whose games are not installed and have no archive. */
export async function listSaveOnlyItems(): Promise<IdentifiedSaveFolder[]> {
  const files = await listGameFiles()
  const libraryThreads = new Set(
    files.filter((file) => file.hasArchive || file.isInstalled).map((file) => file.threadId)
  )
  const records: IdentifiedSaveFolder[] = []
  for (const item of await listIdentifiedSaveFolders()) {
    if (!item.threadId || libraryThreads.has(item.threadId)) continue
    if (identifiedSaveFolderPresent(item)) records.push(item)
  }
  void hydrateSparseIdentifiedSaveFolders(libraryThreads)
  return records
}

const hydratedSaveThreads = new Set<number>()

function saveFolderNeedsLookup(item: IdentifiedSaveFolder): boolean {
  return !item.coverUrl || !item.creator || !item.prefixes?.length
}

async function hydrateSparseIdentifiedSaveFolders(libraryThreads: Set<number>): Promise<void> {
  const records = await listIdentifiedSaveFolders()
  for (const rec of records) {
    if (libraryThreads.has(rec.threadId)) continue
    if (hydratedSaveThreads.has(rec.threadId) || !saveFolderNeedsLookup(rec)) continue
    hydratedSaveThreads.add(rec.threadId)
    try {
      const details = await lookupGame(rec.threadId, rec.title, rec.creator)
      if (!details) continue
      const screens = uniqueScreenUrls(details.screens)
      await rememberIdentifiedSaveFolders([
        {
          ...rec,
          title: details.title || rec.title,
          creator: details.creator || rec.creator,
          coverUrl: details.coverUrl || rec.coverUrl,
          engine: rec.engine || engineFromPrefixIds(details.prefixes) || undefined,
          version: details.version || rec.version,
          rating: details.rating || rec.rating,
          likes: saneLikeCount(details.likes) || rec.likes,
          views: saneViewCount(details.views) || rec.views,
          threadUrl: rec.threadUrl || `https://f95zone.to/threads/${rec.threadId}/`,
          prefixes: details.prefixes?.length ? details.prefixes : rec.prefixes,
          tags: details.tags?.length ? details.tags : rec.tags,
          timestamp: details.timestamp || rec.timestamp,
          updatedAt: details.updatedAt || rec.updatedAt,
          screens: screens.length ? screens : rec.screens
        }
      ])
    } catch {
      hydratedSaveThreads.delete(rec.threadId)
    }
  }
}

function uniqueCatalogHit(
  ranked: Array<{ game: CatalogGame; score: number }>
): CatalogGame | null {
  if (!ranked.length) return null
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null
  return ranked[0].game
}

function identityFromKnown(savePath: string, game: KnownGame): SaveFolderIdentityPatch {
  return {
    savePath,
    identified: true,
    identifyFailed: false,
    threadId: game.threadId,
    title: game.title,
    coverUrl: game.coverUrl,
    creator: game.creator,
    engine: game.engine,
    inLibrary: game.inLibrary,
    inFollowed: game.inFollowed,
    fileId: game.file?.id || null,
    hasArchive: Boolean(game.file?.hasArchive),
    isInstalled: Boolean(game.file?.isInstalled)
  }
}

async function rememberIdentity(savePath: string, game: KnownGame): Promise<SaveFolderIdentityPatch> {
  await rememberAndSyncSaveFolder(rememberedFromKnown(savePath, basename(savePath), game))
  return identityFromKnown(savePath, game)
}

async function failIdentify(savePath: string, folderName: string): Promise<SaveFolderIdentityPatch> {
  await markSaveFolderIdentifyFailed(savePath, folderName)
  return { savePath, identified: false, identifyFailed: true }
}

async function identifyFromCatalog(folderName: string): Promise<CatalogGame | null> {
  const bestByThread = new Map<number, { game: CatalogGame; score: number }>()
  const queries = folderSearchQueries(folderName).slice(0, IDENTIFY_CATALOG_QUERIES)
  for (const search of queries) {
    if (!sanitizeCatalogQuery(search)) continue
    try {
      const page = await fetchCatalog(
        { search, rows: 90, page: 1 },
        { skipFilterFetch: true, skipSessionOptions: true }
      )
      for (const game of page.games) {
        const score = scoreSaveFolder(folderName, game.title)
        if (score < IDENTIFY_MIN_SCORE) continue
        const prev = bestByThread.get(game.threadId)
        if (!prev || score > prev.score) bestByThread.set(game.threadId, { game, score })
      }
    } catch {
      // Try the next query shape.
    }
    const ranked = [...bestByThread.values()].sort(
      (a, b) => b.score - a.score || a.game.threadId - b.game.threadId
    )
    const unique = uniqueCatalogHit(ranked)
    if (unique) return unique
  }
  return null
}

export async function assignSaveFolder(
  savePath: string,
  game: {
    threadId: number
    title: string
    coverUrl?: string | null
    creator?: string
    engine?: string
    version?: string
    rating?: number
    likes?: number
    views?: number
    threadUrl?: string
    prefixes?: number[]
    tags?: number[]
    timestamp?: number
    updatedAt?: string
    screens?: string[]
  }
): Promise<SaveFolderIdentityPatch> {
  const folder = assertManagedSavePath(savePath)
  if (!pathExists(folder)) throw new Error('The save folder does not exist yet.')
  const threadId = Number(game.threadId)
  const title = typeof game.title === 'string' ? game.title.trim() : ''
  if (!Number.isFinite(threadId) || threadId <= 0 || !title) {
    throw new Error('Pick a game to assign this save folder to.')
  }
  const coverUrl = typeof game.coverUrl === 'string' && game.coverUrl ? game.coverUrl : null
  const known = (await loadKnownGames(await listGameFiles())).get(threadId)
  const assigned: KnownGame = {
    threadId,
    title,
    creator: firstText(known?.creator, typeof game.creator === 'string' ? game.creator : ''),
    coverUrl: coverUrl || known?.coverUrl || null,
    engine: firstText(known?.engine, typeof game.engine === 'string' ? game.engine : ''),
    version: firstText(known?.version, game.version),
    rating: known?.rating || game.rating,
    likes: maxLikeCount(known?.likes, game.likes),
    views: maxViewCount(known?.views, game.views),
    threadUrl: firstText(known?.threadUrl, game.threadUrl),
    prefixes: known?.prefixes?.length ? known.prefixes : game.prefixes,
    tags: known?.tags?.length ? known.tags : game.tags,
    timestamp: Math.max(known?.timestamp || 0, game.timestamp || 0) || undefined,
    updatedAt: firstText(known?.updatedAt, game.updatedAt),
    screens: known?.screens?.length ? known.screens : game.screens,
    file: known?.file || null,
    inLibrary: Boolean(known?.inLibrary),
    inFollowed: Boolean(known?.inFollowed)
  }
  await rememberAndSyncSaveFolder(rememberedFromKnown(folder, basename(folder), assigned))
  return identityFromKnown(folder, assigned)
}

export async function identifySaveFolder(savePath: string): Promise<SaveFolderIdentityPatch> {
  const folder = assertManagedSavePath(savePath)
  if (!pathExists(folder)) throw new Error('The save folder does not exist yet.')
  const folderName = basename(folder)
  const files = await listGameFiles()
  const known = await loadKnownGames(files)

  if (isInside(folder, rpgMakerSavesRoot()) && /^\d+$/.test(folderName)) {
    const threadId = Number(folderName)
    const local = known.get(threadId)
    if (local) return rememberIdentity(folder, local)
    try {
      const details = await fetchThreadDetails(threadId)
      return rememberIdentity(folder, {
        threadId,
        title: details.title || `Thread ${threadId}`,
        creator: details.creator || '',
        coverUrl: details.coverUrl || null,
        engine: details.engine || 'RPG Maker',
        version: details.version,
        likes: details.likes,
        views: details.views,
        threadUrl: details.threadUrl,
        timestamp: undefined,
        updatedAt: details.updatedAt,
        screens: details.gallery,
        file: null,
        inLibrary: false,
        inFollowed: false
      })
    } catch {
      return failIdentify(folder, folderName)
    }
  }

  const live = matchSaveFoldersToGames(
    [folderName],
    [...known.values()].filter((game) => game.title)
  )[0]
  if (live) return rememberIdentity(folder, live.game)

  const catalogHit = await identifyFromCatalog(folderName)
  if (catalogHit) {
    const local = known.get(catalogHit.threadId)
    return rememberIdentity(folder, {
      threadId: catalogHit.threadId,
      title: catalogHit.title,
      creator: catalogHit.creator || local?.creator || '',
      coverUrl: catalogHit.coverUrl || local?.coverUrl || null,
      engine: catalogHit.engine || local?.engine || engineFromPrefixIds(catalogHit.prefixes) || '',
      version: catalogHit.version || local?.version,
      rating: catalogHit.rating || local?.rating,
      likes: maxLikeCount(catalogHit.likes, local?.likes),
      views: maxViewCount(catalogHit.views, local?.views),
      threadUrl: catalogHit.threadUrl || local?.threadUrl,
      prefixes: catalogHit.prefixes?.length ? catalogHit.prefixes : local?.prefixes,
      tags: catalogHit.tags?.length ? catalogHit.tags : local?.tags,
      timestamp: catalogHit.timestamp || local?.timestamp,
      updatedAt: catalogHit.updatedAt || local?.updatedAt,
      screens: catalogHit.screens?.length ? catalogHit.screens : local?.screens,
      file: local?.file || null,
      inLibrary: Boolean(local?.inLibrary),
      inFollowed: Boolean(local?.inFollowed)
    })
  }

  return failIdentify(folder, folderName)
}

export async function openManagedSaveFolder(savePath: string): Promise<void> {
  const folder = assertManagedSavePath(savePath)
  await openSaveFolderPath(folder)
}

async function clearRpgMakerSavesForGame(threadId: number, installPath?: string | null): Promise<void> {
  const backup = rpgMakerBackupDir(threadId)
  const gameSave = findRpgMakerGameSaveDir(installPath)
  await clearRpgMakerSaveFiles({ threadId, installPath })
  await forgetIdentifiedSaveFolder(backup)
  if (gameSave) await forgetIdentifiedSaveFolder(gameSave)
}

async function forgetSaveFolderQuietly(savePath: string): Promise<void> {
  try {
    await forgetIdentifiedSaveFolder(savePath)
  } catch {
    // Identity is best-effort once the folder is gone.
  }
}

async function wipeManagedSaveFolder(savePath: string): Promise<void> {
  if (!savePath) return
  if (!pathExists(savePath)) {
    await forgetSaveFolderQuietly(savePath)
    return
  }
  try {
    const folder = assertManagedSavePath(savePath)
    if (isInside(folder, rpgMakerSavesRoot())) {
      await wipeRpgMakerSaveDirs(null, folder)
      await forgetSaveFolderQuietly(folder)
      return
    }
    await clearSaveFolderContents(folder)
  } catch {
    await forgetSaveFolderQuietly(savePath)
  }
}

async function clearIdentifiedSaveFolders(threadId: number): Promise<boolean> {
  if (!threadId) return false
  let cleared = false
  for (const rec of await listIdentifiedSaveFolders()) {
    if (rec.threadId !== threadId || !rec.savePath) continue
    await wipeManagedSaveFolder(rec.savePath)
    cleared = true
  }
  return cleared
}

export async function clearGameSaves(threadId: number, savePath?: string): Promise<void> {
  const path = typeof savePath === 'string' ? savePath.trim() : ''
  const files = threadId ? await listGameFiles(threadId) : []
  const preferred = files.length ? pickSaveFile(files) : null
  const title = firstText(...files.map((file) => file.title))
  const installPath = preferred?.installPath

  if (path) {
    if (threadId && isInside(path, rpgMakerSavesRoot())) {
      await clearRpgMakerSavesForGame(threadId, installPath)
      await wipeManagedSaveFolder(path)
      return
    }
    await wipeManagedSaveFolder(path)
    return
  }

  if (!threadId) throw new Error('Could not find those saves.')

  try {
    await clearRpgMakerSavesForGame(threadId, installPath)
  } catch {
    // No RPG Maker save folders for this game is fine.
  }

  try {
    if (preferred && engineKind(engineOf(files)) !== 'rpgmaker') {
      await clearRenpySaveFolder(preferred.id, title)
    }
  } catch {
    // Unknown or missing Ren'Py folder is fine; identified folders are wiped next.
  }

  if (!preferred) {
    const followed = (await listSubscriptions()).find((item: Subscription) => item.threadId === threadId)
    if (followed) {
      try {
        await clearRenpySaveFolder('', followed.title)
      } catch {
        // Title-based lookup can fail when only an empty folder remains.
      }
    }
  }

  await clearIdentifiedSaveFolders(threadId)
  await forgetIdentifiedSaveFoldersForThread(threadId)
}

export async function removeGameLocalData(threadId: number): Promise<void> {
  const id = Number(threadId)
  if (!id) throw new Error('Missing game id.')
  const files = await listGameFiles(id)
  const errors: unknown[] = []
  for (const file of files) {
    try {
      await removeGameVersion(file.id)
    } catch (error) {
      errors.push(error)
    }
  }
  await clearGameSaves(id)
  if (errors.length) {
    throw errors[0] instanceof Error ? errors[0] : new Error('Could not remove that game.')
  }
}
