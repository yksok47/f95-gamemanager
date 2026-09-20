import { readdir, readFile, rename, rm, stat } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import { app, BrowserWindow, dialog, shell } from 'electron'
import { engineKind } from '@shared/engines'
import type {
  IdentifiedSaveFolder,
  RenpyInfo,
  RenpyInfoScope,
  RenpySaveEditPatch,
  RenpySaveEditorData,
  RenpySaveFile,
  RenpySaveKind,
  RenpyToolId,
  UnRenAction
} from '@shared/types'
import { getGameFile, setRenpySaveDirectory, setRenpySaveDirectoryForThread } from '../game-files-store'
import { rpgMakerSavesRoot } from '../rpgmaker/saves'
import {
  findIdentifiedSaveFolder,
  forgetIdentifiedSaveFolder,
  forgetIdentifiedSaveFoldersForThread,
  getFailedSaveFolder,
  getIdentifiedSaveFolder,
  listFailedSaveFolders,
  listIdentifiedSaveFoldersForGame,
  rememberIdentifiedSaveFolders,
  clearFailedSaveFolder,
  touchIdentifiedSaveFolder,
  renpySaveLocationOptions
} from '../save-folders-store'
import { findRenpyGameRoot } from '../launch'
import { folderBytes, mapLimit } from '../disk-usage'
import {
  listDirents,
  pathExists,
  resolveLongPath,
  resolveLongPathAsync,
  toFsPath
} from '../win-path'
import { findNamedFiles, gameDirFromRoot, scanScripts } from './scan'
import { EMPTY_OPTIONS, readRenpyOptions } from './options'
import {
  ensureDesiredOnGameDir,
  setRenpyOptionsGlobalMode,
  setStoredAllRenpyOptions,
  setStoredRenpyOption
} from './options-prefs'
import { isRenpyOptionsGlobalEnabled } from './options-prefs-store'
import { removeLegacyUnrenTools } from './tools'
import { attachSaveMeta, invalidateSaveMeta } from './save-meta'
import { applySaveEditor, readSaveEditor } from './save-edit'
import {
  recordLocalSaveDeletes,
  recordLocalSaveEdit,
  recordLocalSaveFolderCleared,
  recordLocalSaveRename
} from '../cloud-saves/local-manifest'
import { folderKey } from '../cloud-saves/manifest'
import { matchRenpySaveFolder } from './save-folder-match'
import { discoverRenpySaveFolders } from './save-folder-scan'
import { getLastUnRenRun, replayUnRenStatus, runUnRen } from './unren'

function scheduleCloudSyncForFolder(savePath: string): void {
  void getIdentifiedSaveFolder(savePath)
    .then((rec) => {
      const threadId = Number(rec?.threadId || 0)
      if (!threadId) return
      return import('../cloud-saves/sync').then(({ scheduleCloudSyncForThread }) =>
        scheduleCloudSyncForThread(threadId)
      )
    })
    .catch((error) => console.warn('Could not sync cloud saves', error))
}

export function renpySavesRoot(): string {
  if (process.platform === 'darwin') return join(app.getPath('home'), 'Library', 'RenPy')
  if (process.platform === 'linux') return join(app.getPath('home'), '.renpy')
  return join(app.getPath('appData'), 'RenPy')
}

async function readText(filePath: string): Promise<string> {
  try {
    return await readFile(toFsPath(filePath), 'utf8')
  } catch {
    return ''
  }
}

function parseConfigString(source: string, key: 'save_directory' | 'name'): string | null | undefined {
  if (new RegExp(`config\\.${key}\\s*=\\s*None\\b`, 'i').test(source)) return null
  const match = source.match(
    new RegExp(`(?:define\\s+)?config\\.${key}\\s*=\\s*(?:_\\(\\s*)?["']([^"']+)["']`, 'i')
  )
  return match?.[1]
}

async function parseOptions(optionsPath: string): Promise<{ saveDirectory: string | null | undefined; name: string }> {
  const source = await readText(optionsPath)
  const name = parseConfigString(source, 'name')
  return {
    saveDirectory: parseConfigString(source, 'save_directory'),
    name: typeof name === 'string' ? name : ''
  }
}

export type RenpyDiskSaveFolder = {
  name: string
  path: string
  bytes: number
}

export async function listRenpySaveFolders(): Promise<RenpyDiskSaveFolder[]> {
  const folders = await discoverRenpySaveFolders(renpySavesRoot())
  return mapLimit(folders, 4, async (folder) => ({
    name: folder.name,
    path: folder.path,
    bytes: await folderBytes(folder.path)
  }))
}

async function listRenpySaveFolderNames(): Promise<string[]> {
  return (await discoverRenpySaveFolders(renpySavesRoot())).map((folder) => folder.name)
}

function fuzzySaveDirectory(title: string, folderNames: string[]): string | null {
  if (!title.trim()) return null
  return matchRenpySaveFolder(title, folderNames)
}

function isInsidePath(target: string, root: string): boolean {
  const resolved = resolve(target)
  const base = resolve(root)
  return resolved === base || resolved.startsWith(base + sep)
}

/** Persist either a RenPy-relative folder name, or an absolute path outside RenPy. */
export function saveDirectoryFromPath(chosenPath: string): string {
  const chosen = resolve(chosenPath)
  const root = resolve(renpySavesRoot())
  if (isInsidePath(chosen, root) && chosen !== root) {
    const rel = relative(root, chosen)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return rel
  }
  return chosen
}

function normalizeChosenSaveDirectory(chosenPath: string): string {
  const chosen = resolve(chosenPath)
  if (!pathExists(chosen)) throw new Error('That folder does not exist.')
  const root = resolve(renpySavesRoot())
  if (chosen === root) throw new Error("Pick a save folder inside the Ren'Py saves directory, not the root.")
  if (isInsidePath(chosen, root)) {
    const rel = relative(root, chosen)
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error("Could not resolve that folder under the Ren'Py saves directory.")
    }
    return rel
  }
  return chosen
}


function saveKind(name: string): RenpySaveKind {
  const lower = name.toLowerCase()
  if (lower.startsWith('persistent')) return 'persistent'
  if (lower.startsWith('auto-')) return 'auto'
  if (lower.startsWith('quick-')) return 'quick'
  if (/^\d+-\d+/.test(lower) || /^\d+\.save$/i.test(lower)) return 'slot'
  return 'other'
}

function savePage(name: string, kind: RenpySaveKind): string {
  if (kind === 'persistent') return 'persistent'
  if (kind === 'auto') return 'auto'
  if (kind === 'quick') return 'quick'
  const paged = name.match(/^(\d+)-(\d+)/)
  if (paged) return paged[1]
  if (kind === 'slot') return '1'
  return 'other'
}

function saveSlot(name: string, kind: RenpySaveKind): number | null {
  if (kind === 'auto' || kind === 'quick') {
    const match = name.match(/^(?:auto|quick)-(\d+)/i)
    return match ? Number(match[1]) : null
  }
  const paged = name.match(/^\d+-(\d+)/)
  if (paged) return Number(paged[1])
  const only = name.match(/^(\d+)\.save$/i)
  return only ? Number(only[1]) : null
}

function saveLabel(name: string, kind: RenpySaveKind, slot: number | null): string {
  if (kind === 'persistent') return 'Persistent data'
  if (slot != null) return `Slot ${slot}`
  return name
}

function kindRank(kind: RenpySaveKind): number {
  if (kind === 'auto') return 0
  if (kind === 'quick') return 1
  if (kind === 'slot') return 2
  if (kind === 'persistent') return 3
  return 4
}

function pageRank(page: string): [number, number] {
  if (page === 'auto') return [0, 0]
  if (page === 'quick') return [1, 0]
  if (/^\d+$/.test(page)) return [2, Number(page)]
  if (page === 'persistent') return [3, 0]
  return [4, 0]
}

function parseSaveParts(name: string): { page: string; slot: number; suffix: string } | null {
  const auto = name.match(/^(auto|quick)-(\d+)(?:-(.+))?\.save$/i)
  if (auto) return { page: auto[1].toLowerCase(), slot: Number(auto[2]), suffix: auto[3] || '' }
  const paged = name.match(/^(\d+)-(\d+)(?:-(.+))?\.save$/i)
  if (paged) return { page: String(Number(paged[1])), slot: Number(paged[2]), suffix: paged[3] || '' }
  const only = name.match(/^(\d+)\.save$/i)
  if (only) return { page: '1', slot: Number(only[1]), suffix: '' }
  return null
}

function buildSaveName(page: string, slot: number, suffix: string): string {
  const extra = suffix ? `-${suffix}` : ''
  if (page === 'auto' || page === 'quick') return `${page}-${slot}${extra}.save`
  return `${page}-${slot}${extra}.save`
}

function placeKey(page: string, slot: number): string {
  return `${page}:${slot}`
}

function normalizePage(page: string): string {
  const value = String(page || '').trim().toLowerCase()
  if (value === 'auto' || value === 'quick') return value
  if (!/^\d+$/.test(value)) throw new Error('Page must be Auto, Quick, or a positive number.')
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1) throw new Error('Page must be a positive number.')
  return String(n)
}

function normalizeSlot(slot: number): number {
  const n = Number(slot)
  if (!Number.isInteger(n) || n < 1) throw new Error('Slot must be a positive number.')
  return n
}

type SavePlace = { path: string; name: string; page: string; slot: number; suffix: string }

async function listSavePlaces(folder: string): Promise<SavePlace[]> {
  const entries = await readdir(toFsPath(folder), { withFileTypes: true }).catch(() => [])
  const places: SavePlace[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const parsed = parseSaveParts(entry.name)
    if (!parsed) continue
    places.push({
      path: resolveLongPath(join(folder, entry.name)),
      name: entry.name,
      page: parsed.page,
      slot: parsed.slot,
      suffix: parsed.suffix
    })
  }
  return places
}

function occupiedKey(places: SavePlace[], ignorePath?: string): Set<string> {
  const used = new Set<string>()
  const ignore = ignorePath ? resolve(ignorePath) : ''
  for (const place of places) {
    if (ignore && resolve(place.path) === ignore) continue
    used.add(placeKey(place.page, place.slot))
  }
  return used
}

export async function listRenpySaveFiles(savePath: string): Promise<RenpySaveFile[]> {
  return listSaves(savePath)
}

async function listSaves(savePath: string): Promise<RenpySaveFile[]> {
  const entries = await readdir(toFsPath(savePath), { withFileTypes: true }).catch(() => [])
  const candidates = entries.filter((entry) => {
    if (!entry.isFile()) return false
    const lower = entry.name.toLowerCase()
    if (lower === 'f95gm-manifest.json') return false
    if (lower.startsWith('persistent')) return true
    return lower.endsWith('.save')
  })
  const files = (
    await mapLimit(candidates, 16, async (entry) => {
      const full = join(savePath, entry.name)
      const info = await stat(toFsPath(full)).catch(() => null)
      if (!info) return null
      const kind = saveKind(entry.name)
      const page = savePage(entry.name, kind)
      const slot = saveSlot(entry.name, kind)
      return {
        name: entry.name,
        label: saveLabel(entry.name, kind, slot),
        path: await resolveLongPathAsync(full),
        size: info.size,
        modifiedAt: info.mtimeMs,
        kind,
        page,
        slot
      } satisfies RenpySaveFile
    })
  ).filter((file): file is RenpySaveFile => Boolean(file))
  const parsed = await attachSaveMeta(files)
  return parsed.sort((a, b) => {
    const pages = pageRank(a.page)[0] - pageRank(b.page)[0] || pageRank(a.page)[1] - pageRank(b.page)[1]
    if (pages) return pages
    const kind = kindRank(a.kind) - kindRank(b.kind)
    if (kind) return kind
    if (a.slot != null && b.slot != null && a.slot !== b.slot) return a.slot - b.slot
    if (a.label !== b.label) return a.label.localeCompare(b.label, undefined, { numeric: true })
    return b.modifiedAt - a.modifiedAt
  })
}

function resolveSavePath(gameRoot: string | null, saveDirectory: string | null): string | null {
  if (saveDirectory) {
    if (isAbsolute(saveDirectory)) return saveDirectory
    return join(renpySavesRoot(), saveDirectory)
  }
  if (gameRoot) return join(gameDirFromRoot(gameRoot), 'saves')
  return null
}

type SaveLookup = {
  file?: Awaited<ReturnType<typeof getGameFile>>
  fileId: string
  title: string
  gameRoot: string | null
  threadId: number
}

async function loadSaveLookup(
  fileId: string,
  titleHint = '',
  threadId = 0,
  locateGame = true
): Promise<SaveLookup> {
  const hint = titleHint.trim()
  if (!fileId) {
    if (!hint && !threadId) throw new Error('The save folder is not known yet.')
    return { fileId: '', title: hint, gameRoot: null, threadId }
  }

  const file = await getGameFile(fileId)
  if (file.engine && engineKind(file.engine) !== 'renpy') {
    throw new Error("Save management is only available for Ren'Py games.")
  }

  let gameRoot: string | null = null
  if (locateGame && file.installPath && pathExists(file.installPath)) {
    gameRoot = findRenpyGameRoot(file.installPath)
    if (!gameRoot) throw new Error("Could not find a Ren'Py game folder in that install.")
  }

  return {
    file,
    fileId: file.id,
    title: hint || file.title,
    gameRoot,
    threadId: file.threadId || threadId
  }
}

function isRpgMakerSavePath(savePath: string): boolean {
  return isInsidePath(savePath, rpgMakerSavesRoot())
}

async function identifiedFoldersForLookup(lookup: SaveLookup): Promise<IdentifiedSaveFolder[]> {
  const records = await listIdentifiedSaveFoldersForGame(lookup.threadId, lookup.title)
  return records.filter((item) => item.savePath && !isRpgMakerSavePath(item.savePath))
}

function requireAssignableLookup(lookup: SaveLookup): void {
  if (!lookup.file && !lookup.threadId) {
    throw new Error('Add this game to your library before assigning a save folder.')
  }
}

async function isUnmappedSaveDirectory(
  lookup: SaveLookup,
  saveDirectory: string | null | undefined
): Promise<boolean> {
  if (!saveDirectory) return false
  const savePath = resolveSavePath(lookup.gameRoot, saveDirectory)
  if (!savePath) return false
  return Boolean(await getFailedSaveFolder(savePath))
}

async function identifiedRenpySaveDirectory(lookup: SaveLookup): Promise<string | undefined> {
  const rec = await findIdentifiedSaveFolder(lookup.threadId, lookup.title)
  if (!rec?.savePath || !pathExists(rec.savePath)) return undefined
  if (isRpgMakerSavePath(rec.savePath)) return undefined
  if (resolve(rec.savePath) === resolve(renpySavesRoot())) return undefined
  return saveDirectoryFromPath(rec.savePath)
}

async function persistLinkedSaveDirectory(
  lookup: SaveLookup,
  saveDirectory: string | null | undefined
): Promise<void> {
  const threadId = lookup.file?.threadId || lookup.threadId
  if (threadId) await setRenpySaveDirectoryForThread(threadId, saveDirectory)
  else if (lookup.file) await setRenpySaveDirectory(lookup.file.id, saveDirectory)

  if (!threadId || !saveDirectory) return
  const savePath = resolveSavePath(lookup.gameRoot, saveDirectory)
  if (!savePath) return
  if (pathExists(savePath)) {
    await rememberIdentifiedSaveFolders([
      {
        title: lookup.title || lookup.file?.title || basename(savePath),
        threadId,
        coverUrl: lookup.file?.coverUrl ?? null,
        savePath,
        folderName: basename(savePath),
        identifiedAt: Date.now()
      }
    ])
  }
  await touchIdentifiedSaveFolder(savePath)
}

async function resolveSaveDirectory(
  lookup: SaveLookup,
  prepare = false
): Promise<{
  saveDirectory: string | null | undefined
  options: Awaited<ReturnType<typeof readOptions>>
}> {
  const { file, gameRoot } = lookup
  let options = gameRoot ? await readOptions(gameRoot) : null
  let saveDirectory: string | null | undefined =
    file && file.renpySaveDirectory !== undefined ? file.renpySaveDirectory : undefined
  if (saveDirectory !== undefined && (await isUnmappedSaveDirectory(lookup, saveDirectory))) {
    saveDirectory = undefined
  }

  if (saveDirectory === undefined) {
    saveDirectory = await identifiedRenpySaveDirectory(lookup)
  }
  if (saveDirectory !== undefined && (await isUnmappedSaveDirectory(lookup, saveDirectory))) {
    saveDirectory = undefined
  }

  if (saveDirectory === undefined) {
    saveDirectory = options?.saveDirectory
  }
  if (saveDirectory !== undefined && (await isUnmappedSaveDirectory(lookup, saveDirectory))) {
    saveDirectory = undefined
  }

  if (prepare && file && gameRoot && (saveDirectory === undefined || !options)) {
    await ensureOptions(file.id, gameRoot)
    options = await readOptions(gameRoot)
    if (saveDirectory === undefined && options && options.saveDirectory !== undefined) {
      saveDirectory = options.saveDirectory
    }
    if (saveDirectory !== undefined && (await isUnmappedSaveDirectory(lookup, saveDirectory))) {
      saveDirectory = undefined
    }
  }

  if (saveDirectory === undefined && options?.name) {
    const named = join(renpySavesRoot(), options.name)
    if (pathExists(named) && !(await getFailedSaveFolder(named))) saveDirectory = options.name
  }

  if (saveDirectory === undefined) {
    const failed = new Set(
      (await listFailedSaveFolders()).map((item) => item.folderName.toLowerCase())
    )
    const folderNames = (await listRenpySaveFolderNames()).filter(
      (name) => !failed.has(name.toLowerCase())
    )
    saveDirectory =
      fuzzySaveDirectory(lookup.title, folderNames) ??
      fuzzySaveDirectory(options?.name || '', folderNames) ??
      undefined
  }

  if (file && saveDirectory !== undefined && file.renpySaveDirectory !== saveDirectory) {
    if (saveDirectory) await persistLinkedSaveDirectory(lookup, saveDirectory)
    else if (lookup.threadId || file.threadId) {
      await setRenpySaveDirectoryForThread(file.threadId || lookup.threadId, saveDirectory)
    } else {
      await setRenpySaveDirectory(file.id, saveDirectory)
    }
  }

  return { saveDirectory, options }
}

async function readOptions(
  gameRoot: string
): Promise<{ path: string; saveDirectory: string | null | undefined; name: string } | null> {
  const options = await findNamedFiles(gameDirFromRoot(gameRoot), 'options.rpy')
  if (!options[0]) return null
  const parsed = await parseOptions(options[0])
  return { path: options[0], saveDirectory: parsed.saveDirectory, name: parsed.name }
}

async function ensureOptions(fileId: string, gameRoot: string): Promise<boolean> {
  const gameDir = gameDirFromRoot(gameRoot)
  if ((await findNamedFiles(gameDir, 'options.rpy')).length) return true
  const scripts = await scanScripts(gameRoot)
  if (scripts.packed && !scripts.optionsRpyc) {
    await runUnRen(gameRoot, 'extract', fileId)
  }
  if ((await findNamedFiles(gameDir, 'options.rpy')).length) return true
  const afterExtract = await scanScripts(gameRoot)
  if (afterExtract.optionsRpyc || afterExtract.compiled) {
    await runUnRen(gameRoot, 'decompile', fileId)
  }
  return (await findNamedFiles(gameDir, 'options.rpy')).length > 0
}

function requireRenpyRoot(installPath: string | null): string {
  if (!installPath) throw new Error('That game is not installed.')
  const root = findRenpyGameRoot(installPath)
  if (!root) throw new Error("Could not find a Ren'Py game folder in that install.")
  return root
}

async function requireKnownSaveFolder(fileId: string, title = '', threadId = 0): Promise<string> {
  const lookup = await loadSaveLookup(fileId, title, threadId)
  const { saveDirectory } = await resolveSaveDirectory(lookup)
  if (saveDirectory === undefined) throw new Error('The save folder is not known yet.')
  const savePath = resolveSavePath(lookup.gameRoot, saveDirectory)
  if (!savePath) {
    throw new Error('Saves for this game live in the install folder. Install a build to manage them.')
  }
  return savePath
}

function saveMessage(
  saveDirectory: string | null | undefined,
  savePath: string | null,
  scripts: Awaited<ReturnType<typeof scanScripts>> | null,
  gameRoot: string | null
): string | undefined {
  if (saveDirectory !== undefined) {
    if (saveDirectory === null && !gameRoot) {
      return 'Saves for this game live in the install folder. Install a build to manage them.'
    }
    if (savePath && !pathExists(savePath)) {
      return 'Save folder is known but has not been created yet. Play the game once to create it.'
    }
    return undefined
  }
  if (!gameRoot) {
    return "No matching save folder was found in the Ren'Py saves directory. Use Set location to pick it manually."
  }
  if (scripts?.packed && !scripts.unpacked) {
    return 'Scripts are still packed in .rpa archives. Use the UnRen tab to extract them, then decompile if needed.'
  }
  if (scripts?.compiled && !scripts.optionsRpy) {
    return 'options.rpy is still compiled. Use the UnRen tab to decompile scripts.'
  }
  return "Save folder is not known yet. Use Set location, or extract/decompile on the UnRen tab if options.rpy is packed."
}

function reloadRenpySaves(fileId: string, title = '', threadId = 0): Promise<RenpyInfo> {
  return getRenpyInfo(fileId, false, title, threadId, 'saves')
}

export async function getRenpyInfo(
  fileId: string,
  prepare = false,
  title = '',
  threadId = 0,
  scope: RenpyInfoScope = 'full'
): Promise<RenpyInfo> {
  const savesOnly = scope === 'saves'
  const lookup = await loadSaveLookup(fileId, title, threadId, !savesOnly || prepare)
  const { file } = lookup
  const { saveDirectory, options } = await resolveSaveDirectory(lookup, prepare)
  let { gameRoot } = lookup
  if (savesOnly && saveDirectory === null && !gameRoot && file?.installPath && pathExists(file.installPath)) {
    gameRoot = findRenpyGameRoot(file.installPath)
    lookup.gameRoot = gameRoot
  }
  const savePath = saveDirectory !== undefined ? resolveSavePath(gameRoot, saveDirectory) : null
  const saves = savePath ? await listSaves(savePath) : []
  const scripts = !savesOnly && gameRoot ? await scanScripts(gameRoot) : null
  if (file) replayUnRenStatus(file.id)
  const gameDir = gameRoot ? gameDirFromRoot(gameRoot) : null
  if (!savesOnly && gameDir) await removeLegacyUnrenTools(gameDir)
  const optionsThreadId = file?.threadId || lookup.threadId || 0
  const tools = savesOnly
    ? { ...EMPTY_OPTIONS }
    : optionsThreadId
      ? await ensureDesiredOnGameDir(optionsThreadId, gameDir, savePath)
      : gameDir
        ? readRenpyOptions(gameDir, savePath)
        : { ...EMPTY_OPTIONS }
  const saveLocations = renpySaveLocationOptions(await identifiedFoldersForLookup(lookup), savePath)

  return {
    fileId: lookup.fileId,
    gameRoot,
    saveDirectory: saveDirectory ?? null,
    savePath,
    savePathExists: Boolean(savePath && pathExists(savePath)),
    saveFolderBytes: savePath && pathExists(savePath) ? await folderBytes(savePath) : 0,
    saveLocations,
    optionsFound: Boolean(options),
    optionsGlobal: savesOnly ? false : await isRenpyOptionsGlobalEnabled(),
    tools,
    saves,
    scripts,
    lastRun: file ? getLastUnRenRun(file.id) : null,
    message: saveMessage(saveDirectory, savePath, scripts, gameRoot)
  }
}

export async function runRenpyAction(fileId: string, action: UnRenAction): Promise<RenpyInfo> {
  const file = await getGameFile(fileId)
  const gameRoot = requireRenpyRoot(file.installPath)
  await runUnRen(gameRoot, action, fileId)
  return getRenpyInfo(fileId, false)
}

export async function setRenpyToolForFile(fileId: string, tool: RenpyToolId, enabled: boolean): Promise<RenpyInfo> {
  if (await isRenpyOptionsGlobalEnabled()) {
    throw new Error("Per-game Ren'Py options are locked while global settings are on.")
  }
  const file = await getGameFile(fileId)
  requireRenpyRoot(file.installPath)
  const info = await getRenpyInfo(fileId, false)
  await setStoredRenpyOption(file.threadId, info.tools, tool, enabled)
  return getRenpyInfo(fileId, false)
}

export async function setAllRenpyToolsForFile(fileId: string, enabled: boolean): Promise<RenpyInfo> {
  if (await isRenpyOptionsGlobalEnabled()) {
    throw new Error("Per-game Ren'Py options are locked while global settings are on.")
  }
  const file = await getGameFile(fileId)
  requireRenpyRoot(file.installPath)
  await setStoredAllRenpyOptions(file.threadId, enabled)
  return getRenpyInfo(fileId, false)
}

export async function setRenpyOptionsGlobalForFile(fileId: string, enabled: boolean): Promise<RenpyInfo> {
  const info = await getRenpyInfo(fileId, false)
  await setRenpyOptionsGlobalMode(enabled, info.tools)
  return getRenpyInfo(fileId, false)
}

function assertInsideSaveFolder(savePath: string, target: string): void {
  const root = resolve(savePath)
  const file = resolve(target)
  if (file !== root && !file.startsWith(root + sep)) {
    throw new Error('That file is not inside the save folder.')
  }
}

export async function openSaveFolderPath(savePath: string): Promise<void> {
  const target = pathExists(savePath) ? resolve(savePath) : dirname(savePath)
  if (!pathExists(target)) throw new Error('The save folder does not exist yet.')
  const error = await shell.openPath(target)
  if (error) throw new Error(error)
}

export async function clearSaveFolderContents(savePath: string): Promise<void> {
  const folder = resolve(savePath)
  const root = resolve(renpySavesRoot())
  if (folder === root) throw new Error("Cannot delete the Ren'Py saves directory.")
  const rec = await getIdentifiedSaveFolder(folder)
  const hint = rec
    ? {
        threadId: rec.threadId,
        title: rec.title,
        folderKey: folderKey(rec.folderName || basename(folder))
      }
    : undefined
  if (pathExists(folder)) {
    await recordLocalSaveFolderCleared(folder, hint).catch(() => undefined)
    const entries = await readdir(toFsPath(folder), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      invalidateSaveMeta(join(folder, entry.name))
    }
    await rm(toFsPath(folder), { recursive: true, force: true })
  } else {
    await recordLocalSaveFolderCleared(folder, hint).catch(() => undefined)
  }
  await forgetIdentifiedSaveFolder(folder)
  if (rec?.threadId) scheduleCloudSyncForFolder(folder)

  const parent = dirname(folder)
  if (
    parent !== folder &&
    parent !== root &&
    isInsidePath(parent, root) &&
    pathExists(parent)
  ) {
    const leftover = listDirents(parent).filter((entry) => entry.name !== '.' && entry.name !== '..')
    if (!leftover.length) await rm(toFsPath(parent), { recursive: true, force: true })
  }
}

export async function openRenpySaves(fileId: string, title = '', threadId = 0): Promise<void> {
  const savePath = await requireKnownSaveFolder(fileId, title, threadId)
  await openSaveFolderPath(savePath)
}

export async function chooseRenpySaveDirectory(
  fileId: string,
  title = '',
  parent?: BrowserWindow | null,
  threadId = 0
): Promise<RenpyInfo> {
  const lookup = await loadSaveLookup(fileId, title, threadId)
  requireAssignableLookup(lookup)

  const current = lookup.file?.renpySaveDirectory
  const currentPath = current ? resolveSavePath(lookup.gameRoot, current) : null
  const defaultPath = currentPath && pathExists(currentPath) ? currentPath : renpySavesRoot()

  const options: Electron.OpenDialogOptions = {
    title: "Choose Ren'Py save folder",
    defaultPath: pathExists(defaultPath) ? defaultPath : renpySavesRoot(),
    properties: ['openDirectory']
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return reloadRenpySaves(fileId, title, threadId)

  const saveDirectory = normalizeChosenSaveDirectory(result.filePaths[0])
  await persistLinkedSaveDirectory(lookup, saveDirectory)
  return reloadRenpySaves(fileId, title, threadId)
}

export async function setRenpySaveLocation(
  fileId: string,
  savePath: string,
  title = '',
  threadId = 0
): Promise<RenpyInfo> {
  const lookup = await loadSaveLookup(fileId, title, threadId)
  requireAssignableLookup(lookup)
  const folder = resolve(String(savePath || ''))
  if (!folder) throw new Error('Pick a save folder.')
  const saveDirectory = pathExists(folder)
    ? normalizeChosenSaveDirectory(folder)
    : saveDirectoryFromPath(folder)
  await persistLinkedSaveDirectory(lookup, saveDirectory)
  return reloadRenpySaves(fileId, title, threadId)
}

export async function unlinkRenpySaveLocation(
  fileId: string,
  savePath: string,
  title = '',
  threadId = 0
): Promise<RenpyInfo> {
  const lookup = await loadSaveLookup(fileId, title, threadId)
  requireAssignableLookup(lookup)
  const { unmapSaveFolder } = await import('../save-folders')
  await unmapSaveFolder(String(savePath || ''))
  const remaining = await identifiedFoldersForLookup(lookup)
  const next = remaining[0]
  if (next?.savePath) {
    await persistLinkedSaveDirectory(lookup, saveDirectoryFromPath(next.savePath))
  } else if (lookup.file?.threadId || lookup.threadId) {
    await setRenpySaveDirectoryForThread(lookup.file?.threadId || lookup.threadId, undefined)
  } else if (lookup.file) {
    await setRenpySaveDirectory(lookup.file.id, undefined)
  }
  return reloadRenpySaves(fileId, title, threadId)
}

export async function clearRenpySaveDirectory(
  fileId: string,
  title = '',
  threadId = 0
): Promise<RenpyInfo> {
  const lookup = await loadSaveLookup(fileId, title, threadId)
  requireAssignableLookup(lookup)
  const assignedThreadId = lookup.file?.threadId || lookup.threadId
  if (assignedThreadId) {
    const identified = await listIdentifiedSaveFoldersForGame(assignedThreadId)
    await setRenpySaveDirectoryForThread(assignedThreadId, undefined)
    await forgetIdentifiedSaveFoldersForThread(assignedThreadId)
    for (const rec of identified) {
      await clearFailedSaveFolder(rec.savePath)
    }
  } else if (lookup.file) {
    await setRenpySaveDirectory(lookup.file.id, undefined)
  }
  return reloadRenpySaves(fileId, title, threadId)
}

export async function showRenpySave(fileId: string, savePath: string, title = ''): Promise<void> {
  const folder = await requireKnownSaveFolder(fileId, title)
  assertInsideSaveFolder(folder, savePath)
  if (!pathExists(savePath)) throw new Error('That save is missing.')
  shell.showItemInFolder(savePath)
}

export async function readRenpySaveEditor(
  fileId: string,
  savePath: string,
  title = ''
): Promise<RenpySaveEditorData> {
  const folder = await requireKnownSaveFolder(fileId, title)
  assertInsideSaveFolder(folder, savePath)
  if (!pathExists(savePath)) throw new Error('That save is missing.')
  return readSaveEditor(savePath)
}

export async function applyRenpySaveEditor(
  fileId: string,
  savePath: string,
  patches: RenpySaveEditPatch[],
  title = ''
): Promise<RenpyInfo> {
  const folder = await requireKnownSaveFolder(fileId, title)
  assertInsideSaveFolder(folder, savePath)
  if (!pathExists(savePath)) throw new Error('That save is missing.')
  invalidateSaveMeta(savePath)
  await applySaveEditor(savePath, patches)
  invalidateSaveMeta(savePath)
  await recordLocalSaveEdit(folder, basename(savePath)).catch(() => undefined)
  scheduleCloudSyncForFolder(folder)
  return reloadRenpySaves(fileId, title)
}

export async function deleteRenpySave(fileId: string, savePath: string, title = ''): Promise<RenpyInfo> {
  return deleteRenpySaves(fileId, [savePath], title)
}

export async function deleteRenpySaves(fileId: string, savePaths: string[], title = ''): Promise<RenpyInfo> {
  const folder = await requireKnownSaveFolder(fileId, title)
  const unique = [...new Set(savePaths.map((item) => String(item || '')).filter(Boolean))]
  if (!unique.length) return reloadRenpySaves(fileId, title)
  await recordLocalSaveDeletes(
    folder,
    unique.map((item) => basename(item))
  ).catch(() => undefined)
  for (const savePath of unique) {
    assertInsideSaveFolder(folder, savePath)
    invalidateSaveMeta(savePath)
    if (pathExists(savePath)) await rm(toFsPath(savePath), { force: true })
  }
  scheduleCloudSyncForFolder(folder)
  return reloadRenpySaves(fileId, title)
}

export async function moveRenpySave(
  fileId: string,
  savePath: string,
  page: string,
  slot: number,
  title = ''
): Promise<RenpyInfo> {
  const folder = await requireKnownSaveFolder(fileId, title)
  assertInsideSaveFolder(folder, savePath)
  if (!pathExists(savePath)) throw new Error('That save is missing.')
  const parsed = parseSaveParts(basename(savePath))
  if (!parsed) throw new Error('That save cannot be moved.')
  const nextPage = normalizePage(page)
  const nextSlot = normalizeSlot(slot)
  const nextName = buildSaveName(nextPage, nextSlot, parsed.suffix)
  const nextPath = join(dirname(savePath), nextName)
  if (resolve(nextPath) === resolve(savePath)) return reloadRenpySaves(fileId, title)
  const used = occupiedKey(await listSavePlaces(folder), savePath)
  if (used.has(placeKey(nextPage, nextSlot))) {
    const pageLabel = nextPage === 'auto' ? 'Auto' : nextPage === 'quick' ? 'Quick' : nextPage
    throw new Error(`Page ${pageLabel} slot ${nextSlot} is already used.`)
  }
  if (pathExists(nextPath)) throw new Error('A file already exists at that slot.')
  invalidateSaveMeta(savePath)
  await recordLocalSaveRename(folder, basename(savePath), nextName).catch(() => undefined)
  await rename(toFsPath(savePath), toFsPath(nextPath))
  scheduleCloudSyncForFolder(folder)
  return reloadRenpySaves(fileId, title)
}

export async function renumberRenpyPage(
  fileId: string,
  fromPage: string,
  toPage: string,
  title = ''
): Promise<RenpyInfo> {
  const folder = await requireKnownSaveFolder(fileId, title)
  const source = normalizePage(fromPage)
  const dest = normalizePage(toPage)
  if (source === dest) return reloadRenpySaves(fileId, title)
  const places = await listSavePlaces(folder)
  const moving = places.filter((place) => place.page === source)
  if (!moving.length) throw new Error('That page has no saves.')
  if (places.some((place) => place.page === dest)) {
    const pageLabel = dest === 'auto' ? 'Auto' : dest === 'quick' ? 'Quick' : dest
    throw new Error(`Page ${pageLabel} is already used.`)
  }
  for (const place of moving) {
    const nextName = buildSaveName(dest, place.slot, place.suffix)
    const nextPath = join(folder, nextName)
    if (pathExists(nextPath)) throw new Error('A file already exists at that slot.')
    invalidateSaveMeta(place.path)
    await recordLocalSaveRename(folder, place.name, nextName).catch(() => undefined)
    await rename(toFsPath(place.path), toFsPath(nextPath))
  }
  scheduleCloudSyncForFolder(folder)
  return reloadRenpySaves(fileId, title)
}

export async function measureRenpySaveBytes(fileId: string, title = ''): Promise<number> {
  try {
    const lookup = await loadSaveLookup(fileId, title)
    const { saveDirectory } = await resolveSaveDirectory(lookup, false)
    if (saveDirectory === undefined) return 0
    const savePath = resolveSavePath(lookup.gameRoot, saveDirectory)
    if (!savePath || !pathExists(savePath)) return 0
    return await folderBytes(savePath)
  } catch {
    return 0
  }
}

export async function clearRenpySaveFolder(fileId: string, title = ''): Promise<void> {
  const folder = await requireKnownSaveFolder(fileId, title)
  await clearSaveFolderContents(folder)
}
