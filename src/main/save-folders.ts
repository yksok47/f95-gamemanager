import { basename, isAbsolute, join, resolve, sep } from 'path'
import { engineKind } from '@shared/engines'
import { engineFromPrefixIds } from '@shared/prefixes'
import type { CatalogGame, GameLibraryFile, LibraryStorageItem, Subscription } from '@shared/types'
import { folderBytes, mapLimit } from './disk-usage'
import { fetchCatalog } from './f95/catalog'
import { sanitizeCatalogQuery } from './f95/sanitize-query'
import { fetchThreadDetails } from './f95/thread'
import { listGameFiles, setRenpySaveDirectoryForThread } from './game-files-store'
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
  rpgMakerSavesRoot
} from './rpgmaker/saves'
import {
  getFailedSaveFolder,
  getIdentifiedSaveFolder,
  listIdentifiedSaveFolders,
  markSaveFolderIdentifyFailed,
  pruneMissingSaveFolders,
  rememberIdentifiedSaveFolders,
  saveFolderKey,
  type IdentifiedSaveFolder
} from './save-folders-store'
import { listSubscriptions } from './subscriptions-store'
import { getLibraryDirSync } from './settings-store'
import { pathExists } from './win-path'

const IDENTIFY_MIN_SCORE = 40

type KnownGame = {
  threadId: number
  title: string
  creator: string
  coverUrl: string | null
  engine: string
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
      file: null,
      inLibrary: false,
      inFollowed: true
    })
  }

  for (const rec of await listIdentifiedSaveFolders()) {
    upsertKnown(byThread, {
      threadId: rec.threadId,
      title: rec.title,
      creator: '',
      coverUrl: rec.coverUrl,
      engine: '',
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

function toRemembered(item: LibraryStorageItem): IdentifiedSaveFolder | null {
  if (!item.threadId || !item.savePath || !item.title) return null
  return {
    title: item.title,
    threadId: item.threadId,
    coverUrl: item.coverUrl,
    savePath: item.savePath,
    folderName: item.saveFolderName || basename(item.savePath),
    identifiedAt: Date.now()
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
  await setRenpySaveDirectoryForThread(entry.threadId, saveDirectory)
}

export async function collectSaveItems(files: GameLibraryFile[]): Promise<LibraryStorageItem[]> {
  const known = await loadKnownGames(files)
  const items: LibraryStorageItem[] = []
  const claimedFolders = new Set<string>()
  const claimedThreads = new Set<number>()
  const remember: IdentifiedSaveFolder[] = []

  const claim = (item: LibraryStorageItem): void => {
    if (!item.savePath || item.bytes <= 0) return
    const key = saveFolderKey(item.savePath)
    if (claimedFolders.has(key)) return
    claimedFolders.add(key)
    if (item.threadId) claimedThreads.add(item.threadId)
    items.push(item)
    if (item.identified && item.threadId) {
      const rec = toRemembered(item)
      if (rec) remember.push(rec)
    }
  }

  const diskFolders = (await listRenpySaveFolders()).filter((folder) => folder.bytes > 0)
  const foldersByKey = new Map(diskFolders.map((folder) => [saveFolderKey(folder.path), folder]))
  const foldersByName = new Map(diskFolders.map((folder) => [folder.name, folder]))

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
    const stored = await getIdentifiedSaveFolder(folder.path)
    const storedGame = stored ? known.get(stored.threadId) : null
    if (stored && stored.threadId && !claimedThreads.has(stored.threadId)) {
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
  const matchable = [...known.values()].filter((game) => game.title && !claimedThreads.has(game.threadId))
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
    const failed = await getFailedSaveFolder(folder.path)
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
      if (bytes > 0) {
        rpgBytesByThread.set(game.threadId, bytes)
        return
      }
    }
    if (kind === 'rpgmaker') return
    const dir = game.file?.renpySaveDirectory
    if (dir === null) {
      const savePath = inGameRenpySavePath(game.file?.installPath)
      const bytes = savePath && pathExists(savePath) ? await folderBytes(savePath) : 0
      if (bytes > 0 && savePath) inGameRenpyByThread.set(game.threadId, { path: savePath, bytes })
    }
  })

  for (const game of remainingGames) {
    if (claimedThreads.has(game.threadId)) continue
    const rpgBytes = rpgBytesByThread.get(game.threadId)
    if (rpgBytes) {
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
    const stored = await getIdentifiedSaveFolder(folder.path)
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
    const failed = await getFailedSaveFolder(folder.path)
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

async function identifyFromCatalog(folderName: string): Promise<CatalogGame | null> {
  const bestByThread = new Map<number, { game: CatalogGame; score: number }>()
  for (const search of folderSearchQueries(folderName)) {
    if (!sanitizeCatalogQuery(search)) continue
    try {
      const page = await fetchCatalog({ search, rows: 90, page: 1 })
      for (const game of page.games) {
        const score = scoreSaveFolder(folderName, game.title)
        if (score < IDENTIFY_MIN_SCORE) continue
        const prev = bestByThread.get(game.threadId)
        if (!prev || score > prev.score) bestByThread.set(game.threadId, { game, score })
      }
    } catch {
      // Try the next query shape.
    }
  }
  const ranked = [...bestByThread.values()].sort(
    (a, b) => b.score - a.score || a.game.threadId - b.game.threadId
  )
  if (!ranked.length) return null
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null
  return ranked[0].game
}

export async function assignSaveFolder(
  savePath: string,
  game: { threadId: number; title: string; coverUrl?: string | null }
): Promise<void> {
  const folder = assertManagedSavePath(savePath)
  if (!pathExists(folder)) throw new Error('The save folder does not exist yet.')
  const threadId = Number(game.threadId)
  const title = typeof game.title === 'string' ? game.title.trim() : ''
  if (!Number.isFinite(threadId) || threadId <= 0 || !title) {
    throw new Error('Pick a game to assign this save folder to.')
  }
  await rememberAndSyncSaveFolder({
    title,
    threadId,
    coverUrl: typeof game.coverUrl === 'string' && game.coverUrl ? game.coverUrl : null,
    savePath: folder,
    folderName: basename(folder),
    identifiedAt: Date.now()
  })
}

export async function identifySaveFolder(savePath: string): Promise<void> {
  const folder = assertManagedSavePath(savePath)
  if (!pathExists(folder)) throw new Error('The save folder does not exist yet.')
  const folderName = basename(folder)
  const files = await listGameFiles()
  const known = await loadKnownGames(files)

  if (isInside(folder, rpgMakerSavesRoot()) && /^\d+$/.test(folderName)) {
    const threadId = Number(folderName)
    try {
      const details = await fetchThreadDetails(threadId)
      const game = known.get(threadId)
      await rememberAndSyncSaveFolder({
        title: details.title || game?.title || `Thread ${threadId}`,
        threadId,
        coverUrl: details.coverUrl || game?.coverUrl || null,
        savePath: folder,
        folderName,
        identifiedAt: Date.now()
      })
      return
    } catch {
      await markSaveFolderIdentifyFailed(folder, folderName)
      return
    }
  }

  const live = matchSaveFoldersToGames(
    [folderName],
    [...known.values()].filter((game) => game.title)
  )[0]
  if (live) {
    await rememberAndSyncSaveFolder({
      title: live.game.title,
      threadId: live.game.threadId,
      coverUrl: live.game.coverUrl,
      savePath: folder,
      folderName,
      identifiedAt: Date.now()
    })
    return
  }

  const catalogHit = await identifyFromCatalog(folderName)
  if (catalogHit) {
    await rememberAndSyncSaveFolder({
      title: catalogHit.title,
      threadId: catalogHit.threadId,
      coverUrl: catalogHit.coverUrl,
      savePath: folder,
      folderName,
      identifiedAt: Date.now()
    })
    return
  }

  await markSaveFolderIdentifyFailed(folder, folderName)
}

export async function openManagedSaveFolder(savePath: string): Promise<void> {
  const folder = assertManagedSavePath(savePath)
  await openSaveFolderPath(folder)
}

export async function clearGameSaves(threadId: number, savePath?: string): Promise<void> {
  const path = typeof savePath === 'string' ? savePath.trim() : ''
  const files = threadId ? await listGameFiles(threadId) : []

  if (files.length) {
    const preferred = pickSaveFile(files)
    const title = firstText(...files.map((file) => file.title))
    const kind = engineKind(engineOf(files))
    let attempted = false
    let lastError: unknown
    if (kind !== 'rpgmaker') {
      attempted = true
      try {
        if (path && isInside(path, renpySavesRoot())) await clearSaveFolderContents(assertManagedSavePath(path))
        else await clearRenpySaveFolder(preferred.id, title)
      } catch (error) {
        lastError = error
      }
    }
    if (kind !== 'renpy') {
      attempted = true
      try {
        await clearRpgMakerSaveFiles({
          installPath: preferred.installPath,
          threadId: preferred.threadId
        })
        lastError = undefined
      } catch (error) {
        lastError = error
      }
    }
    if (!attempted) throw new Error('Save cleanup is not available for this engine.')
    if (lastError) {
      throw lastError instanceof Error ? lastError : new Error('Could not delete those saves.')
    }
    return
  }

  if (path) {
    const folder = assertManagedSavePath(path)
    if (isInside(folder, rpgMakerSavesRoot())) {
      const name = basename(folder)
      const id = threadId || (/^\d+$/.test(name) ? Number(name) : 0)
      if (id) {
        await clearRpgMakerSaveFiles({ threadId: id, installPath: null })
        return
      }
    }
    await clearSaveFolderContents(folder)
    return
  }

  if (threadId) {
    const stored = (await listIdentifiedSaveFolders()).find((item) => item.threadId === threadId)
    if (stored?.savePath && pathExists(stored.savePath)) {
      await clearSaveFolderContents(assertManagedSavePath(stored.savePath))
      return
    }
    const followed = (await listSubscriptions()).find((item: Subscription) => item.threadId === threadId)
    if (followed) {
      try {
        await clearRenpySaveFolder('', followed.title)
      } catch {
        await clearRpgMakerSaveFiles({ threadId, installPath: null })
      }
      return
    }
  }

  throw new Error('Could not find those saves.')
}
