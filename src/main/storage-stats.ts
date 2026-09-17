import { resolve } from 'path'
import type { GameLibraryFile, LibraryStorageGame, LibraryStorageItem, LibraryStorageStats } from '@shared/types'
import { fileBytes, folderBytes } from './disk-usage'
import { listGameFiles } from './game-files-store'
import { clearGameSaves, collectSaveItems } from './save-folders'

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

export async function libraryStorageStats(): Promise<LibraryStorageStats> {
  const files = await listGameFiles()
  const byThread = new Map<number, GameLibraryFile[]>()
  for (const file of files) {
    if (!file.hasArchive && !file.isInstalled) continue
    const list = byThread.get(file.threadId)
    if (list) list.push(file)
    else byThread.set(file.threadId, [file])
  }

  const items: LibraryStorageItem[] = []
  const games: LibraryStorageGame[] = []
  const installSeen = new Map<string, number>()

  for (const file of files) {
    if (file.hasArchive && file.archivePath) {
      const bytes = fileBytes(file.archivePath) || file.size || 0
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
        bytes,
        fileId: file.id,
        hasArchive: true,
        isInstalled: file.isInstalled
      })
    }
    if (file.isInstalled && file.installPath) {
      const key = resolve(file.installPath).toLowerCase()
      let bytes = installSeen.get(key)
      if (bytes == null) {
        bytes = folderBytes(file.installPath)
        installSeen.set(key, bytes)
      }
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
        bytes,
        fileId: file.id,
        hasArchive: file.hasArchive,
        isInstalled: true
      })
    }
  }

  const saveItems = await collectSaveItems(files)
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

export { clearGameSaves }
