import { readdir, readFile, rename, rm, stat } from 'fs/promises'
import { basename, dirname, join, resolve, sep } from 'path'
import { app, shell } from 'electron'
import { engineKind } from '@shared/engines'
import type { RenpyInfo, RenpySaveFile, RenpySaveKind, RenpyToolId, UnRenAction } from '@shared/types'
import { cleanThreadTitle } from '../f95/parse'
import { getGameFile, setRenpySaveDirectory } from '../game-files-store'
import { findRenpyGameRoot } from '../launch'
import { folderBytes } from '../disk-usage'
import { childPath, listDirents, pathExists, resolveLongPath, toFsPath } from '../win-path'
import { findNamedFiles, gameDirFromRoot, scanScripts } from './scan'
import { readRenpyTools, setAllRenpyTools, setRenpyTool } from './tools'
import { attachSaveMeta, invalidateSaveMeta } from './save-meta'
import { getLastUnRenRun, replayUnRenStatus, runUnRen } from './unren'

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

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function matchSaveFolder(title: string): string | null {
  const root = renpySavesRoot()
  if (!pathExists(root)) return null
  const needle = normalizeKey(title)
  if (needle.length < 4) return null
  const matches = listDirents(root)
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const key = normalizeKey(name)
      return key.includes(needle.slice(0, 16)) || needle.includes(key.slice(0, 16))
    })
  if (matches.length === 1) return matches[0]
  const withSaves = matches.filter((name) => {
    const dir = childPath(root, name)
    return listDirents(dir).some((entry) => entry.isFile())
  })
  return withSaves.length === 1 ? withSaves[0] : null
}

function fuzzySaveDirectory(title: string): string | null {
  if (!title.trim()) return null
  return matchSaveFolder(title) ?? matchSaveFolder(cleanThreadTitle(title))
}

const EMPTY_TOOLS: Record<RenpyToolId, boolean> = {
  console: false,
  quick: false,
  skip: false,
  rollback: false
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

async function listSaves(savePath: string): Promise<RenpySaveFile[]> {
  if (!pathExists(savePath)) return []
  const entries = await readdir(toFsPath(savePath), { withFileTypes: true })
  const files: RenpySaveFile[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    if (!lower.endsWith('.save') && !lower.startsWith('persistent')) continue
    const full = join(savePath, entry.name)
    const info = await stat(toFsPath(full)).catch(() => null)
    if (!info) continue
    const kind = saveKind(entry.name)
    const page = savePage(entry.name, kind)
    const slot = saveSlot(entry.name, kind)
    files.push({
      name: entry.name,
      label: saveLabel(entry.name, kind, slot),
      path: resolveLongPath(full),
      size: info.size,
      modifiedAt: info.mtimeMs,
      kind,
      page,
      slot
    })
  }
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
  if (saveDirectory) return join(renpySavesRoot(), saveDirectory)
  if (gameRoot) return join(gameDirFromRoot(gameRoot), 'saves')
  return null
}

type SaveLookup = {
  file?: Awaited<ReturnType<typeof getGameFile>>
  fileId: string
  title: string
  gameRoot: string | null
}

async function loadSaveLookup(fileId: string, titleHint = ''): Promise<SaveLookup> {
  const hint = titleHint.trim()
  if (!fileId) {
    if (!hint) throw new Error('The save folder is not known yet.')
    return { fileId: '', title: hint, gameRoot: null }
  }

  const file = await getGameFile(fileId)
  if (file.engine && engineKind(file.engine) !== 'renpy') {
    throw new Error("Save management is only available for Ren'Py games.")
  }

  let gameRoot: string | null = null
  if (file.installPath && pathExists(file.installPath)) {
    gameRoot = findRenpyGameRoot(file.installPath)
    if (!gameRoot) throw new Error("Could not find a Ren'Py game folder in that install.")
  }

  return {
    file,
    fileId: file.id,
    title: hint || file.title,
    gameRoot
  }
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
    file && file.renpySaveDirectory !== undefined ? file.renpySaveDirectory : options?.saveDirectory

  if (prepare && file && gameRoot && (saveDirectory === undefined || !options)) {
    await ensureOptions(file.id, gameRoot)
    options = await readOptions(gameRoot)
    if (options && options.saveDirectory !== undefined) saveDirectory = options.saveDirectory
  }

  if (saveDirectory === undefined && options?.name) {
    const named = join(renpySavesRoot(), options.name)
    if (pathExists(named)) saveDirectory = options.name
  }

  if (saveDirectory === undefined) {
    saveDirectory =
      fuzzySaveDirectory(lookup.title) ?? fuzzySaveDirectory(options?.name || '') ?? undefined
  }

  if (file && saveDirectory !== undefined && file.renpySaveDirectory !== saveDirectory) {
    await setRenpySaveDirectory(file.id, saveDirectory)
  }

  return { saveDirectory, options }
}

async function readOptions(
  gameRoot: string
): Promise<{ path: string; saveDirectory: string | null | undefined; name: string } | null> {
  const options = findNamedFiles(gameDirFromRoot(gameRoot), 'options.rpy')
  if (!options[0]) return null
  const parsed = await parseOptions(options[0])
  return { path: options[0], saveDirectory: parsed.saveDirectory, name: parsed.name }
}

async function ensureOptions(fileId: string, gameRoot: string): Promise<boolean> {
  if (findNamedFiles(gameDirFromRoot(gameRoot), 'options.rpy').length) return true
  const scripts = scanScripts(gameRoot)
  if (scripts.packed && !scripts.optionsRpyc) {
    await runUnRen(gameRoot, 'extract', fileId)
  }
  if (findNamedFiles(gameDirFromRoot(gameRoot), 'options.rpy').length) return true
  if (scanScripts(gameRoot).optionsRpyc || scanScripts(gameRoot).compiled) {
    await runUnRen(gameRoot, 'decompile', fileId)
  }
  return findNamedFiles(gameDirFromRoot(gameRoot), 'options.rpy').length > 0
}

function requireRenpyRoot(installPath: string | null): string {
  if (!installPath) throw new Error('That game is not installed.')
  const root = findRenpyGameRoot(installPath)
  if (!root) throw new Error("Could not find a Ren'Py game folder in that install.")
  return root
}

async function requireKnownSaveFolder(fileId: string, title = ''): Promise<string> {
  const lookup = await loadSaveLookup(fileId, title)
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
  scripts: ReturnType<typeof scanScripts> | null,
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
    return "No matching save folder was found in the Ren'Py saves directory."
  }
  if (scripts?.packed && !scripts.unpacked) {
    return 'Scripts are still packed in .rpa archives. Use the UnRen tab to extract them, then decompile if needed.'
  }
  if (scripts?.compiled && !scripts.optionsRpy) {
    return 'options.rpy is still compiled. Use the UnRen tab to decompile scripts.'
  }
  return 'Save folder is not known yet. Extract/decompile on the UnRen tab if options.rpy is packed.'
}

export async function getRenpyInfo(fileId: string, prepare = false, title = ''): Promise<RenpyInfo> {
  const lookup = await loadSaveLookup(fileId, title)
  const { file, gameRoot } = lookup
  const { saveDirectory, options } = await resolveSaveDirectory(lookup, prepare)
  const savePath = saveDirectory !== undefined ? resolveSavePath(gameRoot, saveDirectory) : null
  const saves = savePath ? await listSaves(savePath) : []
  const scripts = gameRoot ? scanScripts(gameRoot) : null
  if (file) replayUnRenStatus(file.id)

  return {
    fileId: lookup.fileId,
    gameRoot,
    saveDirectory: saveDirectory ?? null,
    savePath,
    savePathExists: Boolean(savePath && pathExists(savePath)),
    saveFolderBytes: savePath && pathExists(savePath) ? folderBytes(savePath) : 0,
    optionsFound: Boolean(options),
    tools: gameRoot ? readRenpyTools(gameDirFromRoot(gameRoot)) : { ...EMPTY_TOOLS },
    saves,
    scripts,
    lastRun: file ? getLastUnRenRun(file.id) : null,
    message: saveMessage(saveDirectory, savePath, scripts, gameRoot)
  }
}

export async function runRenpyAction(fileId: string, action: UnRenAction): Promise<RenpyInfo> {
  const file = await getGameFile(fileId)
  const gameRoot = requireRenpyRoot(file.installPath)
  const gameDir = gameDirFromRoot(gameRoot)
  if (action === 'extract' || action === 'decompile') {
    await runUnRen(gameRoot, action, fileId)
  } else if (action === 'all-tools') {
    await setAllRenpyTools(gameDir, true)
  } else {
    await setRenpyTool(gameDir, action, true)
  }
  return getRenpyInfo(fileId, false)
}

export async function setRenpyToolForFile(fileId: string, tool: RenpyToolId, enabled: boolean): Promise<RenpyInfo> {
  const file = await getGameFile(fileId)
  const gameRoot = requireRenpyRoot(file.installPath)
  await setRenpyTool(gameDirFromRoot(gameRoot), tool, enabled)
  return getRenpyInfo(fileId, false)
}

function assertInsideSaveFolder(savePath: string, target: string): void {
  const root = resolve(savePath)
  const file = resolve(target)
  if (file !== root && !file.startsWith(root + sep)) {
    throw new Error('That file is not inside the save folder.')
  }
}

export async function openRenpySaves(fileId: string, title = ''): Promise<void> {
  const savePath = await requireKnownSaveFolder(fileId, title)
  const target = pathExists(savePath) ? savePath : dirname(savePath)
  if (!pathExists(target)) throw new Error('The save folder does not exist yet.')
  const error = await shell.openPath(target)
  if (error) throw new Error(error)
}

export async function showRenpySave(fileId: string, savePath: string, title = ''): Promise<void> {
  const folder = await requireKnownSaveFolder(fileId, title)
  assertInsideSaveFolder(folder, savePath)
  if (!pathExists(savePath)) throw new Error('That save is missing.')
  shell.showItemInFolder(savePath)
}

export async function deleteRenpySave(fileId: string, savePath: string, title = ''): Promise<RenpyInfo> {
  return deleteRenpySaves(fileId, [savePath], title)
}

export async function deleteRenpySaves(fileId: string, savePaths: string[], title = ''): Promise<RenpyInfo> {
  const folder = await requireKnownSaveFolder(fileId, title)
  const unique = [...new Set(savePaths.map((item) => String(item || '')).filter(Boolean))]
  if (!unique.length) return getRenpyInfo(fileId, false, title)
  for (const savePath of unique) {
    assertInsideSaveFolder(folder, savePath)
    invalidateSaveMeta(savePath)
    if (pathExists(savePath)) await rm(toFsPath(savePath), { force: true })
  }
  return getRenpyInfo(fileId, false, title)
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
  if (resolve(nextPath) === resolve(savePath)) return getRenpyInfo(fileId, false, title)
  const used = occupiedKey(await listSavePlaces(folder), savePath)
  if (used.has(placeKey(nextPage, nextSlot))) {
    const pageLabel = nextPage === 'auto' ? 'Auto' : nextPage === 'quick' ? 'Quick' : nextPage
    throw new Error(`Page ${pageLabel} slot ${nextSlot} is already used.`)
  }
  if (pathExists(nextPath)) throw new Error('A file already exists at that slot.')
  invalidateSaveMeta(savePath)
  await rename(toFsPath(savePath), toFsPath(nextPath))
  return getRenpyInfo(fileId, false, title)
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
  if (source === dest) return getRenpyInfo(fileId, false, title)
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
    await rename(toFsPath(place.path), toFsPath(nextPath))
  }
  return getRenpyInfo(fileId, false, title)
}
