import { mkdir, readFile, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { app, shell } from 'electron'
import type { HtmlGameInfo, HtmlGameSaveKey } from '@shared/types'
import { recordLocalSaveEdit, recordLocalSaveFolderCleared } from '../cloud-saves/local-manifest'
import { folderBytes, mapLimit } from '../disk-usage'
import { getGameFile } from '../game-files-store'
import { findHtmlEntry } from './detect'
import { getPlaySession } from '../play-sessions'
import { listDirents, pathExists, resolveLongPath, toFsPath } from '../win-path'
import {
  emptyHtmlStorageDump,
  HTML_STORAGE_FILE,
  htmlStorageBytes,
  htmlStoragePreview,
  parseHtmlStorageDump,
  serializeHtmlStorageDump,
  type HtmlStorageDump
} from './storage'

export const HTML_CLOUD_FOLDER = 'html'

export function htmlSavesRoot(): string {
  return join(app.getPath('userData'), 'html-saves')
}

export function htmlBackupDir(threadId: number): string {
  return join(htmlSavesRoot(), String(threadId))
}

export function htmlBackupFile(threadId: number): string {
  return join(htmlBackupDir(threadId), HTML_STORAGE_FILE)
}

export type HtmlDiskSaveFolder = {
  threadId: number
  name: string
  path: string
  bytes: number
}

export async function listHtmlBackupFolders(): Promise<HtmlDiskSaveFolder[]> {
  const root = htmlSavesRoot()
  if (!pathExists(root)) return []
  const dirs = listDirents(root).filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
  const folders = await mapLimit(dirs, 4, async (entry) => {
    const folderPath = join(root, entry.name)
    return {
      threadId: Number(entry.name),
      name: entry.name,
      path: folderPath,
      bytes: await measureHtmlSaveBytes(folderPath)
    }
  })
  return folders.filter((folder): folder is HtmlDiskSaveFolder => Boolean(folder))
}

export async function measureHtmlSaveBytes(dir: string | null | undefined): Promise<number> {
  if (!dir || !pathExists(dir)) return 0
  const file = join(dir, HTML_STORAGE_FILE)
  if (pathExists(file)) {
    try {
      return (await stat(toFsPath(file))).size
    } catch {
      return 0
    }
  }
  return folderBytes(dir)
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

export async function readHtmlStorageBackup(threadId: number): Promise<HtmlStorageDump> {
  const file = htmlBackupFile(threadId)
  if (!pathExists(file)) return emptyHtmlStorageDump()
  const raw = await readFile(toFsPath(file), 'utf8').catch(() => '')
  return parseHtmlStorageDump(raw) ?? emptyHtmlStorageDump()
}

export async function writeHtmlStorageBackup(
  threadId: number,
  keys: Record<string, string>,
  title?: string
): Promise<HtmlStorageDump> {
  const dump: HtmlStorageDump = { savedAt: Date.now(), keys }
  const dir = htmlBackupDir(threadId)
  await mkdir(toFsPath(dir), { recursive: true })
  await noteBackupTitle(dir, title)
  await writeFile(toFsPath(htmlBackupFile(threadId)), serializeHtmlStorageDump(dump), 'utf8')
  await recordLocalSaveEdit(dir, HTML_STORAGE_FILE, {
    threadId,
    title,
    folderKey: HTML_CLOUD_FOLDER
  }).catch(() => undefined)
  return dump
}

export function htmlStorageForRestore(dump: HtmlStorageDump): Record<string, string> {
  return dump.keys
}

function presentKeys(keys: Record<string, string>): HtmlGameSaveKey[] {
  return Object.entries(keys)
    .map(([key, value]) => ({
      key,
      size: Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8'),
      preview: htmlStoragePreview(value)
    }))
    .sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: 'base' }))
}

function infoMessage(info: {
  playing: boolean
  keyCount: number
  backupExists: boolean
  entryPath: string | null
}): string | undefined {
  if (!info.entryPath) {
    return 'No HTML file was found in the installed folder.'
  }
  if (info.playing) {
    return 'Game is running. Browser localStorage is copied to the backup folder while you play, then kept when you install a new version.'
  }
  if (!info.keyCount && !info.backupExists) {
    return 'No browser saves yet. Play the game once and progress stored in localStorage will be backed up automatically.'
  }
  if (!info.keyCount) {
    return 'The backup folder is empty. Play the game to create saves.'
  }
  return undefined
}

export async function getHtmlGameInfo(input: {
  fileId?: string
  threadId: number
  title?: string
}): Promise<HtmlGameInfo> {
  const threadId = Number(input.threadId)
  if (!threadId) throw new Error('Missing game id.')
  let fileId = String(input.fileId || '')
  let entryPath: string | null = null
  let title = input.title || ''

  if (fileId) {
    const file = await getGameFile(fileId)
    title = title || file.title
    fileId = file.id
    if (file.installPath && pathExists(file.installPath)) {
      entryPath = file.executablePath && pathExists(file.executablePath)
        ? resolveLongPath(file.executablePath)
        : findHtmlEntry(file.installPath)
    }
  }

  const live = await readLiveHtmlStorage(fileId)
  const backup = live ?? (await readHtmlStorageBackup(threadId))
  if (live) {
    await writeHtmlStorageBackup(threadId, live.keys, title).catch(() => undefined)
  }
  const backupPath = htmlBackupDir(threadId)
  const backupExists = pathExists(htmlBackupFile(threadId))
  const keys = presentKeys(backup.keys)
  const playing = Boolean(fileId && getPlaySession(fileId))

  return {
    fileId,
    threadId,
    entryPath,
    backupPath,
    backupPathExists: backupExists || pathExists(backupPath),
    saveFolderBytes: htmlStorageBytes(backup.keys),
    keys,
    playing,
    message: infoMessage({
      playing,
      keyCount: keys.length,
      backupExists,
      entryPath
    })
  }
}

export async function openHtmlSaves(threadId: number, title?: string): Promise<void> {
  const dir = htmlBackupDir(threadId)
  await mkdir(toFsPath(dir), { recursive: true })
  await noteBackupTitle(dir, title)
  const error = await shell.openPath(dir)
  if (error) throw new Error(error)
}

export async function deleteHtmlSaveKeys(
  input: { fileId?: string; threadId: number; title?: string },
  keys: string[]
): Promise<HtmlGameInfo> {
  const threadId = Number(input.threadId)
  const unique = [...new Set(keys.map((key) => String(key)).filter(Boolean))]
  const dump = await readHtmlStorageBackup(threadId)
  for (const key of unique) delete dump.keys[key]
  await writeHtmlStorageBackup(threadId, dump.keys, input.title)
  await removeLiveHtmlKeys(String(input.fileId || ''), unique)
  if (!unique.length) {
    // nothing to record
  } else {
    await recordLocalSaveEdit(htmlBackupDir(threadId), HTML_STORAGE_FILE, {
      threadId,
      title: input.title,
      folderKey: HTML_CLOUD_FOLDER
    }).catch(() => undefined)
  }
  return getHtmlGameInfo(input)
}

export async function clearHtmlSavesForGame(threadId: number): Promise<void> {
  const dir = htmlBackupDir(threadId)
  if (pathExists(dir)) {
    await recordLocalSaveFolderCleared(dir, {
      threadId,
      folderKey: HTML_CLOUD_FOLDER
    }).catch(() => undefined)
    await rm(toFsPath(dir), { recursive: true, force: true })
  }
  await clearHtmlGameOrigin(threadId).catch(() => undefined)
}

let liveStorageReader: ((fileId: string) => Promise<Record<string, string> | null>) | null = null
let liveKeyRemover: ((fileId: string, keys: string[]) => Promise<void>) | null = null
let originClearer: ((threadId: number) => Promise<void>) | null = null

export function setHtmlLiveStorageHooks(hooks: {
  read: (fileId: string) => Promise<Record<string, string> | null>
  removeKeys: (fileId: string, keys: string[]) => Promise<void>
  clearOrigin: (threadId: number) => Promise<void>
}): void {
  liveStorageReader = hooks.read
  liveKeyRemover = hooks.removeKeys
  originClearer = hooks.clearOrigin
}

async function readLiveHtmlStorage(fileId: string): Promise<HtmlStorageDump | null> {
  if (!fileId || !liveStorageReader) return null
  const keys = await liveStorageReader(fileId)
  if (!keys) return null
  return { savedAt: Date.now(), keys }
}

async function removeLiveHtmlKeys(fileId: string, keys: string[]): Promise<void> {
  if (!fileId || !keys.length) return
  await liveKeyRemover?.(fileId, keys)
}

async function clearHtmlGameOrigin(threadId: number): Promise<void> {
  await originClearer?.(threadId)
}
