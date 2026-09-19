import { resolve } from 'path'
import type {
  GameLibraryFile,
  LibraryStorageGame,
  LibraryStorageItem,
  LibraryStorageScan,
  LibraryStorageStats
} from '@shared/types'
import { fileBytes, folderBytes, mapLimit } from './disk-usage'
import { listGameFiles } from './game-files-store'
import { clearGameSaves, collectSaveItems } from './save-folders'
import { patchLibraryStorageStatsForSaveFolder, type SaveFolderIdentityPatch } from './storage-identity'
import { sendToRenderer } from './windows'

const INSTALL_CONCURRENCY = 4
const ARCHIVE_CONCURRENCY = 8

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

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return 'Could not measure disk usage.'
}

const scan: LibraryStorageScan = {
  scanning: false,
  scannedAt: null,
  error: null,
  stats: null
}

export function getLibraryStorageScan(): LibraryStorageScan {
  return {
    scanning: scan.scanning,
    scannedAt: scan.scannedAt,
    error: scan.error,
    stats: scan.stats
  }
}

function broadcastStorageScan(): void {
  sendToRenderer('library:storage-scan', getLibraryStorageScan())
}

let chain: Promise<void> = Promise.resolve()
let latest: Promise<LibraryStorageStats> | null = null
let pendingCount = 0

async function runOneScan(): Promise<LibraryStorageStats> {
  scan.scanning = true
  scan.error = null
  broadcastStorageScan()
  try {
    const stats = await computeLibraryStorageStats()
    scan.stats = stats
    scan.scannedAt = Date.now()
    scan.error = null
    return stats
  } catch (error) {
    scan.error = errorMessage(error)
    throw error
  } finally {
    pendingCount = Math.max(0, pendingCount - 1)
    scan.scanning = pendingCount > 0
    broadcastStorageScan()
  }
}

function enqueueLibraryStorageScan(): Promise<LibraryStorageStats> {
  pendingCount += 1
  scan.scanning = true
  scan.error = null
  broadcastStorageScan()
  const next = chain.then(runOneScan, runOneScan)
  chain = next.then(
    () => undefined,
    () => undefined
  )
  latest = next
  return next
}

export function requestLibraryStorageStats(options?: { force?: boolean }): Promise<LibraryStorageStats> {
  const force = Boolean(options?.force)
  if (!force && scan.stats) return Promise.resolve(scan.stats)
  if (!force && latest && pendingCount > 0) return latest
  return enqueueLibraryStorageScan()
}

export async function applySaveFolderIdentityToScan(
  patch: SaveFolderIdentityPatch
): Promise<LibraryStorageStats> {
  if (scan.stats) {
    const next = patchLibraryStorageStatsForSaveFolder(scan.stats, patch)
    if (next) {
      scan.stats = next
      scan.error = null
      broadcastStorageScan()
      return next
    }
  }
  return requestLibraryStorageStats({ force: true })
}

async function measureLibraryFiles(files: GameLibraryFile[]): Promise<{
  archiveBytesById: Map<string, number>
  installSeen: Map<string, number>
}> {
  const archives = files.filter((file) => file.hasArchive && file.archivePath)
  const archiveBytesById = new Map<string, number>()
  const installSeen = new Map<string, number>()
  const installJobs: Array<{ key: string; path: string }> = []
  const installQueued = new Set<string>()

  for (const file of files) {
    if (!file.isInstalled || !file.installPath) continue
    const key = resolve(file.installPath).toLowerCase()
    if (installQueued.has(key)) continue
    installQueued.add(key)
    installJobs.push({ key, path: file.installPath })
  }

  await Promise.all([
    mapLimit(archives, ARCHIVE_CONCURRENCY, async (file) => {
      archiveBytesById.set(file.id, (await fileBytes(file.archivePath as string)) || file.size || 0)
    }),
    mapLimit(installJobs, INSTALL_CONCURRENCY, async (job) => {
      installSeen.set(job.key, await folderBytes(job.path))
    })
  ])

  return { archiveBytesById, installSeen }
}

async function computeLibraryStorageStats(): Promise<LibraryStorageStats> {
  const files = await listGameFiles()
  const byThread = new Map<number, GameLibraryFile[]>()
  for (const file of files) {
    if (!file.hasArchive && !file.isInstalled) continue
    const list = byThread.get(file.threadId)
    if (list) list.push(file)
    else byThread.set(file.threadId, [file])
  }

  const saveItemsPromise = collectSaveItems(files)
  const { archiveBytesById, installSeen } = await measureLibraryFiles(files)
  const saveItems = await saveItemsPromise

  const items: LibraryStorageItem[] = []
  const games: LibraryStorageGame[] = []

  for (const file of files) {
    if (file.hasArchive && file.archivePath) {
      items.push({
        id: `archive:${file.id}`,
        kind: 'archive',
        threadId: file.threadId,
        title: file.title,
        creator: file.creator || '',
        version: file.version,
        filename: file.filename,
        coverUrl: file.coverUrl ?? null,
        engine: file.engine || '',
        bytes: archiveBytesById.get(file.id) || file.size || 0,
        fileId: file.id,
        hasArchive: true,
        isInstalled: file.isInstalled
      })
    }
    if (file.isInstalled && file.installPath) {
      const key = resolve(file.installPath).toLowerCase()
      items.push({
        id: `install:${file.id}`,
        kind: 'install',
        threadId: file.threadId,
        title: file.title,
        creator: file.creator || '',
        version: file.version,
        filename: file.filename,
        coverUrl: file.coverUrl ?? null,
        engine: file.engine || '',
        bytes: installSeen.get(key) || 0,
        fileId: file.id,
        hasArchive: file.hasArchive,
        isInstalled: true
      })
    }
  }

  items.push(...saveItems)

  const savesByThread = new Map<number, LibraryStorageItem[]>()
  for (const item of saveItems) {
    if (!item.threadId) continue
    const list = savesByThread.get(item.threadId)
    if (list) list.push(item)
    else savesByThread.set(item.threadId, [item])
  }

  const seenGameThreads = new Set<number>()

  for (const [threadId, threadFiles] of byThread) {
    const title = firstText(...threadFiles.map((file) => file.title)) || `Thread ${threadId}`
    const creator = firstText(...threadFiles.map((file) => file.creator))
    const coverUrl = coverOf(threadFiles)
    const engine = engineOf(threadFiles)
    const archiveIds = threadFiles.filter((file) => file.hasArchive).map((file) => file.id)
    const installIds = threadFiles.filter((file) => file.isInstalled).map((file) => file.id)
    const archiveBytes = items
      .filter((item) => item.kind === 'archive' && item.threadId === threadId)
      .reduce((sum, item) => sum + item.bytes, 0)
    const seenInstalls = new Set<string>()
    let installBytes = 0
    for (const file of threadFiles) {
      if (!file.isInstalled || !file.installPath) continue
      const key = resolve(file.installPath).toLowerCase()
      if (seenInstalls.has(key)) continue
      seenInstalls.add(key)
      installBytes += installSeen.get(key) || 0
    }
    const threadSaves = savesByThread.get(threadId) || []
    const saveBytes = threadSaves.reduce((sum, item) => sum + item.bytes, 0)
    const totalBytes = archiveBytes + installBytes + saveBytes
    if (totalBytes <= 0) continue
    seenGameThreads.add(threadId)
    games.push({
      threadId,
      title,
      creator,
      coverUrl,
      engine,
      archiveBytes,
      installBytes,
      saveBytes,
      totalBytes,
      archiveIds,
      installIds,
      saveFileId: threadSaves.find((item) => item.fileId)?.fileId || null,
      savePath: threadSaves[0]?.savePath || null
    })
  }

  for (const [threadId, threadSaves] of savesByThread) {
    if (seenGameThreads.has(threadId)) continue
    const sample = threadSaves[0]
    const saveBytes = threadSaves.reduce((sum, item) => sum + item.bytes, 0)
    if (saveBytes <= 0) continue
    games.push({
      threadId,
      title: sample.title,
      creator: sample.creator,
      coverUrl: sample.coverUrl,
      engine: sample.engine,
      archiveBytes: 0,
      installBytes: 0,
      saveBytes,
      totalBytes: saveBytes,
      archiveIds: [],
      installIds: [],
      saveFileId: sample.fileId,
      savePath: sample.savePath || null
    })
  }

  games.sort((a, b) => b.totalBytes - a.totalBytes || a.title.localeCompare(b.title))
  items.sort((a, b) => b.bytes - a.bytes || a.title.localeCompare(b.title))

  const archiveBytes = items.filter((item) => item.kind === 'archive').reduce((sum, item) => sum + item.bytes, 0)
  const installBytes = [...installSeen.values()].reduce((sum, bytes) => sum + bytes, 0)
  const saveBytes = saveItems.reduce((sum, item) => sum + item.bytes, 0)

  return {
    archiveBytes,
    installBytes,
    saveBytes,
    totalBytes: archiveBytes + installBytes + saveBytes,
    games,
    items
  }
}

export function libraryStorageStats(): Promise<LibraryStorageStats> {
  return requestLibraryStorageStats({ force: false })
}

export { clearGameSaves }
