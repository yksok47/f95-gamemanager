import { copyFile, mkdir, readdir, rm, stat, utimes, writeFile } from 'fs/promises'
import { basename, dirname, join, resolve, sep } from 'path'
import { app, shell } from 'electron'
import { engineKind } from '@shared/engines'
import type { RpgMakerInfo, RpgMakerSaveEditPatch, RpgMakerSaveEditorData, RpgMakerSaveFile, RpgMakerSaveKind } from '@shared/types'
import { mapLimit } from '../disk-usage'
import { getGameFile } from '../game-files-store'
import { findRpgMakerWww, rpgMakerSaveDirFromWww } from '../launch'
import { getPlaySession } from '../play-sessions'
import { childPath, listDirents, pathExists, resolveLongPath, toFsPath } from '../win-path'
import {
  isRpgMakerSaveName,
  listRpgMakerSaveNames,
  rpgMakerSaveFileBytes,
  wipeRpgMakerSaveDirs
} from './save-disk'
import { recordLocalSaveDeletes, recordLocalSaveEdit, recordLocalSaveFolderCleared } from '../cloud-saves/local-manifest'
import { applySaveEditor, readSaveEditor } from './save-edit'

const MTIME_SKEW_MS = 1000
const UNSTABLE_MS = 2000

export function rpgMakerSavesRoot(): string {
  return join(app.getPath('userData'), 'rpgmaker-saves')
}

export function rpgMakerBackupDir(threadId: number): string {
  return join(rpgMakerSavesRoot(), String(threadId))
}

export type RpgMakerDiskSaveFolder = {
  threadId: number
  name: string
  path: string
  bytes: number
}

export async function listRpgMakerBackupFolders(): Promise<RpgMakerDiskSaveFolder[]> {
  const root = rpgMakerSavesRoot()
  if (!pathExists(root)) return []
  const dirs = listDirents(root).filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
  const folders = await mapLimit(dirs, 4, async (entry) => {
    const folderPath = join(root, entry.name)
    return {
      threadId: Number(entry.name),
      name: entry.name,
      path: folderPath,
      bytes: await rpgMakerSaveFileBytes(folderPath)
    }
  })
  return folders.filter((folder): folder is RpgMakerDiskSaveFolder => Boolean(folder))
}

export type RpgMakerSyncMode = 'merge' | 'backup'

export type RpgMakerSyncInput = {
  installPath?: string | null
  threadId: number
  title?: string
  mode?: RpgMakerSyncMode
  skipUnstable?: boolean
}

export type RpgMakerSyncResult = {
  gameSavePath: string | null
  backupPath: string
  copiedToGame: number
  copiedToBackup: number
}

function isSaveName(name: string): boolean {
  return isRpgMakerSaveName(name)
}

function saveKind(name: string): RpgMakerSaveKind {
  const lower = name.toLowerCase()
  if (/^auto/i.test(lower)) return 'auto'
  if (/^quick/i.test(lower)) return 'quick'
  if (/^config/i.test(lower)) return 'config'
  if (/^global/i.test(lower)) return 'global'
  if (/^(file)?\d+\.(rpgsave|rmmzsave)$/i.test(lower)) return 'slot'
  return 'other'
}

function saveSlot(name: string, kind: RpgMakerSaveKind): number | null {
  if (kind !== 'slot') return null
  const match = name.match(/^(?:file)?(\d+)\./i)
  return match ? Number(match[1]) : null
}

function saveLabel(name: string, kind: RpgMakerSaveKind, slot: number | null): string {
  if (kind === 'auto') return 'Auto'
  if (kind === 'quick') return 'Quick'
  if (kind === 'config') return 'Config'
  if (kind === 'global') return 'Save index'
  if (slot != null) return `Slot ${slot}`
  return name
}

function kindRank(kind: RpgMakerSaveKind): number {
  if (kind === 'slot') return 0
  if (kind === 'auto') return 1
  if (kind === 'quick') return 2
  if (kind === 'config') return 3
  if (kind === 'global') return 4
  return 5
}

async function fileStat(filePath: string): Promise<{ size: number; mtimeMs: number } | null> {
  try {
    const info = await stat(toFsPath(filePath))
    if (!info.isFile()) return null
    return { size: info.size, mtimeMs: info.mtimeMs }
  } catch {
    return null
  }
}

function listSaveNames(dir: string): string[] {
  return listRpgMakerSaveNames(dir)
}

async function copyPreserve(src: string, dest: string): Promise<void> {
  await mkdir(toFsPath(dirname(dest)), { recursive: true })
  await copyFile(toFsPath(src), toFsPath(dest))
  const info = await stat(toFsPath(src))
  await utimes(toFsPath(dest), info.atime, info.mtime)
}

function newerWins(
  left: { size: number; mtimeMs: number },
  right: { size: number; mtimeMs: number }
): 'left' | 'right' | 'same' {
  if (Math.abs(left.mtimeMs - right.mtimeMs) <= MTIME_SKEW_MS && left.size === right.size) return 'same'
  if (left.mtimeMs > right.mtimeMs + MTIME_SKEW_MS) return 'left'
  if (right.mtimeMs > left.mtimeMs + MTIME_SKEW_MS) return 'right'
  if (left.size !== right.size) return left.mtimeMs >= right.mtimeMs ? 'left' : 'right'
  return 'same'
}

async function noteBackupTitle(backupPath: string, title?: string): Promise<void> {
  const label = title?.trim()
  if (!label) return
  try {
    await mkdir(toFsPath(backupPath), { recursive: true })
    await writeFile(toFsPath(join(backupPath, 'game.txt')), `${label}\n`, 'utf8')
  } catch {
    // Title file is only for browsing the backup folder.
  }
}

export function findRpgMakerGameSaveDir(installPath: string | null | undefined): string | null {
  if (!installPath) return null
  const www = findRpgMakerWww(installPath)
  if (!www) return null
  return resolveLongPath(rpgMakerSaveDirFromWww(www))
}

export async function syncRpgMakerSaves(input: RpgMakerSyncInput): Promise<RpgMakerSyncResult> {
  const threadId = Number(input.threadId)
  const backupPath = rpgMakerBackupDir(threadId)
  const mode = input.mode || 'merge'
  const gameSavePath = findRpgMakerGameSaveDir(input.installPath)
  const result: RpgMakerSyncResult = {
    gameSavePath,
    backupPath,
    copiedToGame: 0,
    copiedToBackup: 0
  }
  if (!threadId) return result
  // Backups are only created from an installed game that actually has save files.
  if (!gameSavePath) return result
  if (mode !== 'merge' && !pathExists(gameSavePath)) return result

  const names = new Set([...listSaveNames(gameSavePath), ...listSaveNames(backupPath)])
  if (!names.size) return result
  for (const name of names) {
    const gameFile = childPath(gameSavePath, name)
    const backupFile = childPath(backupPath, name)
    const gameInfo = await fileStat(gameFile)
    const backupInfo = await fileStat(backupFile)
    try {
      if (mode === 'backup') {
        if (gameInfo && input.skipUnstable && Date.now() - gameInfo.mtimeMs < UNSTABLE_MS) continue
        if (gameInfo && (!backupInfo || newerWins(gameInfo, backupInfo) === 'left')) {
          await copyPreserve(gameFile, backupFile)
          result.copiedToBackup += 1
        }
        continue
      }
      if (gameInfo && !backupInfo) {
        await copyPreserve(gameFile, backupFile)
        result.copiedToBackup += 1
        continue
      }
      if (!gameInfo && backupInfo) {
        await copyPreserve(backupFile, gameFile)
        result.copiedToGame += 1
        continue
      }
      if (!gameInfo || !backupInfo) continue
      const winner = newerWins(gameInfo, backupInfo)
      if (winner === 'left') {
        await copyPreserve(gameFile, backupFile)
        result.copiedToBackup += 1
      } else if (winner === 'right') {
        await copyPreserve(backupFile, gameFile)
        result.copiedToGame += 1
      }
    } catch (error) {
      console.warn('Could not sync RPG Maker save', name, error)
    }
  }
  if (result.copiedToBackup) await noteBackupTitle(backupPath, input.title)
  else if (pathExists(backupPath)) await noteBackupTitle(backupPath, input.title)
  return result
}

async function listSaves(dir: string | null): Promise<RpgMakerSaveFile[]> {
  if (!dir || !pathExists(dir)) return []
  const entries = await readdir(toFsPath(dir), { withFileTypes: true }).catch(() => [])
  const files: RpgMakerSaveFile[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !isSaveName(entry.name)) continue
    const full = join(dir, entry.name)
    const info = await fileStat(full)
    if (!info) continue
    const kind = saveKind(entry.name)
    const slot = saveSlot(entry.name, kind)
    files.push({
      name: entry.name,
      label: saveLabel(entry.name, kind, slot),
      path: resolveLongPath(full),
      size: info.size,
      modifiedAt: info.mtimeMs,
      kind,
      slot
    })
  }
  return files.sort((a, b) => {
    const kind = kindRank(a.kind) - kindRank(b.kind)
    if (kind) return kind
    if (a.slot != null && b.slot != null && a.slot !== b.slot) return a.slot - b.slot
    return a.label.localeCompare(b.label, undefined, { numeric: true })
  })
}

function saveMessage(info: {
  gameSavePath: string | null
  backupExists: boolean
  saveCount: number
  copiedToGame: number
  copiedToBackup: number
}): string | undefined {
  if (info.copiedToGame && info.copiedToBackup) {
    return `Synced saves both ways (${info.copiedToGame} into the game folder, ${info.copiedToBackup} into the backup folder).`
  }
  if (info.copiedToGame) {
    return `Restored ${info.copiedToGame} save ${info.copiedToGame === 1 ? 'file' : 'files'} from the backup folder into the game folder.`
  }
  if (info.copiedToBackup) {
    return `Backed up ${info.copiedToBackup} save ${info.copiedToBackup === 1 ? 'file' : 'files'} to the backup folder.`
  }
  if (!info.gameSavePath && info.backupExists) {
    return 'Saves are kept in the backup folder. Install the game to copy them into www/save so it can load them.'
  }
  if (!info.gameSavePath && !info.backupExists) {
    return 'No RPG Maker save folder yet. Install and play once, or copy saves into the backup folder, and they will stay in sync.'
  }
  if (!info.saveCount) {
    return 'No save files yet. Play the game to create some; they will be backed up automatically.'
  }
  return undefined
}

export async function getRpgMakerInfo(input: {
  fileId?: string
  threadId: number
  title?: string
}): Promise<RpgMakerInfo> {
  const threadId = Number(input.threadId)
  if (!threadId) throw new Error('Missing game id.')
  let fileId = String(input.fileId || '')
  let installPath: string | null = null
  let title = input.title || ''

  if (fileId) {
    const file = await getGameFile(fileId)
    if (file.engine && engineKind(file.engine) !== 'rpgmaker') {
      throw new Error('Save backup is only available for RPG Maker games.')
    }
    if (file.installPath && pathExists(file.installPath)) installPath = file.installPath
    title = title || file.title
    fileId = file.id
  }

  const playing = Boolean(fileId && getPlaySession(fileId))
  const sync = await syncRpgMakerSaves({
    installPath,
    threadId,
    title,
    mode: playing ? 'backup' : 'merge',
    skipUnstable: playing
  })
  const listFrom = sync.gameSavePath && pathExists(sync.gameSavePath) ? sync.gameSavePath : sync.backupPath
  const saves = await listSaves(listFrom)
  const backupHasSaves = pathExists(sync.backupPath) && listSaveNames(sync.backupPath).length > 0
  const backupExists = pathExists(sync.backupPath)
  const gameExists = Boolean(sync.gameSavePath && pathExists(sync.gameSavePath))

  return {
    fileId,
    threadId,
    gameSavePath: sync.gameSavePath,
    gameSavePathExists: gameExists,
    backupPath: sync.backupPath,
    backupPathExists: backupExists,
    saveFolderBytes: await rpgMakerSaveFileBytes(listFrom),
    copiedToGame: sync.copiedToGame,
    copiedToBackup: sync.copiedToBackup,
    saves,
    message: saveMessage({
      gameSavePath: sync.gameSavePath,
      backupExists: backupHasSaves,
      saveCount: saves.length,
      copiedToGame: sync.copiedToGame,
      copiedToBackup: sync.copiedToBackup
    })
  }
}

function assertManagedSave(info: RpgMakerInfo, target: string): void {
  const file = resolve(target)
  const roots = [info.gameSavePath, info.backupPath].filter(Boolean) as string[]
  for (const root of roots) {
    const base = resolve(root)
    if (file === base || file.startsWith(base + sep)) return
  }
  throw new Error('That file is not inside an RPG Maker save folder.')
}

export async function openRpgMakerSaves(input: {
  fileId?: string
  threadId: number
  title?: string
  which?: 'game' | 'backup'
}): Promise<void> {
  const info = await getRpgMakerInfo(input)
  const preferred =
    input.which === 'backup'
      ? info.backupPath
      : input.which === 'game'
        ? info.gameSavePath
        : info.gameSavePathExists
          ? info.gameSavePath
          : info.backupPath
  if (!preferred || !pathExists(preferred)) throw new Error('The save folder does not exist yet.')
  const error = await shell.openPath(preferred)
  if (error) throw new Error(error)
}

export async function showRpgMakerSave(
  input: { fileId?: string; threadId: number; title?: string },
  savePath: string
): Promise<void> {
  const info = await getRpgMakerInfo(input)
  assertManagedSave(info, savePath)
  if (!pathExists(savePath)) throw new Error('That save is missing.')
  shell.showItemInFolder(savePath)
}

export async function readRpgMakerSaveEditor(
  input: { fileId?: string; threadId: number; title?: string },
  savePath: string
): Promise<RpgMakerSaveEditorData> {
  const info = await getRpgMakerInfo(input)
  assertManagedSave(info, savePath)
  if (!pathExists(savePath)) throw new Error('That save is missing.')
  return readSaveEditor(savePath)
}

export async function applyRpgMakerSaveEditor(
  input: { fileId?: string; threadId: number; title?: string },
  savePath: string,
  patches: RpgMakerSaveEditPatch[]
): Promise<RpgMakerInfo> {
  const info = await getRpgMakerInfo(input)
  assertManagedSave(info, savePath)
  if (!pathExists(savePath)) throw new Error('That save is missing.')
  await applySaveEditor(savePath, patches)
  const next = await getRpgMakerInfo(input)
  if (next.backupPath) {
    await recordLocalSaveEdit(next.backupPath, basename(savePath), {
      threadId: input.threadId,
      title: input.title,
      folderKey: 'rpgmaker'
    }).catch(() => undefined)
  }
  const threadId = Number(input.threadId)
  if (threadId) {
    void import('../cloud-saves/sync')
      .then(({ scheduleCloudSyncForThread }) => scheduleCloudSyncForThread(threadId))
      .catch((error) => console.warn('Could not sync cloud saves', error))
  }
  return next
}

export async function deleteRpgMakerSaves(
  input: { fileId?: string; threadId: number; title?: string },
  savePaths: string[]
): Promise<RpgMakerInfo> {
  const info = await getRpgMakerInfo(input)
  const unique = [...new Set(savePaths.map((item) => String(item || '')).filter(Boolean))]
  const names = new Set<string>()
  for (const savePath of unique) {
    assertManagedSave(info, savePath)
    names.add(basename(savePath))
  }
  if (info.backupPath) {
    await recordLocalSaveDeletes(info.backupPath, [...names], {
      threadId: input.threadId,
      title: input.title,
      folderKey: 'rpgmaker'
    }).catch(() => undefined)
  }
  for (const name of names) {
    for (const root of [info.gameSavePath, info.backupPath]) {
      if (!root) continue
      const full = childPath(root, name)
      if (pathExists(full)) await rm(toFsPath(full), { force: true })
    }
  }
  return getRpgMakerInfo(input)
}

export async function measureRpgMakerSaveBytes(input: {
  installPath?: string | null
  threadId: number
}): Promise<number> {
  const threadId = Number(input.threadId)
  if (!threadId) return 0
  const backupPath = rpgMakerBackupDir(threadId)
  const gameSavePath = findRpgMakerGameSaveDir(input.installPath)
  return (
    (await rpgMakerSaveFileBytes(gameSavePath)) + (await rpgMakerSaveFileBytes(backupPath))
  )
}

export async function clearRpgMakerSaveFiles(input: {
  installPath?: string | null
  threadId: number
}): Promise<void> {
  const threadId = Number(input.threadId)
  if (!threadId) throw new Error('Missing game id.')
  const backupPath = rpgMakerBackupDir(threadId)
  await recordLocalSaveFolderCleared(backupPath, {
    threadId,
    folderKey: 'rpgmaker'
  }).catch(() => undefined)
  await wipeRpgMakerSaveDirs(findRpgMakerGameSaveDir(input.installPath), backupPath)
}
