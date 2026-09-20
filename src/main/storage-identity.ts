import { resolve } from 'path'
import type { LibraryStorageGame, LibraryStorageItem, LibraryStorageStats } from '@shared/types'

export type SaveFolderIdentityPatch = {
  savePath: string
  identified: boolean
  identifyFailed?: boolean
  threadId?: number
  title?: string
  coverUrl?: string | null
  creator?: string
  engine?: string
  inLibrary?: boolean
  inFollowed?: boolean
  fileId?: string | null
  hasArchive?: boolean
  isInstalled?: boolean
}

function saveFolderKey(savePath: string): string {
  return resolve(savePath).toLowerCase()
}

function saveItemFromPatch(prev: LibraryStorageItem, patch: SaveFolderIdentityPatch): LibraryStorageItem {
  if (!patch.identified) {
    return {
      ...prev,
      threadId: 0,
      title: prev.saveFolderName || prev.title,
      creator: '',
      coverUrl: null,
      fileId: null,
      hasArchive: false,
      isInstalled: false,
      inLibrary: false,
      inFollowed: false,
      identified: false,
      identifyFailed: true
    }
  }
  return {
    ...prev,
    threadId: patch.threadId || 0,
    title: patch.title || prev.title,
    creator: patch.creator || '',
    coverUrl: patch.coverUrl ?? prev.coverUrl,
    engine: patch.engine || prev.engine,
    fileId: patch.fileId ?? prev.fileId,
    hasArchive: Boolean(patch.hasArchive ?? prev.hasArchive),
    isInstalled: Boolean(patch.isInstalled ?? prev.isInstalled),
    inLibrary: Boolean(patch.inLibrary),
    inFollowed: Boolean(patch.inFollowed),
    identified: true,
    identifyFailed: false
  }
}

function rebuildGames(items: LibraryStorageItem[], previous: LibraryStorageGame[]): LibraryStorageGame[] {
  const savesByThread = new Map<number, LibraryStorageItem[]>()
  for (const item of items) {
    if (item.kind !== 'saves' || !item.threadId) continue
    const list = savesByThread.get(item.threadId)
    if (list) list.push(item)
    else savesByThread.set(item.threadId, [item])
  }

  const games: LibraryStorageGame[] = []
  const seen = new Set<number>()
  for (const game of previous) {
    const threadSaves = savesByThread.get(game.threadId) || []
    const saveBytes = threadSaves.reduce((sum, item) => sum + item.bytes, 0)
    const totalBytes = game.archiveBytes + game.installBytes + saveBytes
    if (totalBytes <= 0 && !threadSaves.length) continue
    seen.add(game.threadId)
    const sample = threadSaves[0]
    games.push({
      ...game,
      title: game.archiveIds.length || game.installIds.length ? game.title : sample?.title || game.title,
      creator: game.creator || sample?.creator || '',
      coverUrl: game.coverUrl || sample?.coverUrl || null,
      engine: game.engine || sample?.engine || '',
      saveBytes,
      totalBytes,
      saveFileId: threadSaves.find((item) => item.fileId)?.fileId || null,
      savePath: sample?.savePath || null
    })
  }

  for (const [threadId, threadSaves] of savesByThread) {
    if (seen.has(threadId)) continue
    const sample = threadSaves[0]
    const saveBytes = threadSaves.reduce((sum, item) => sum + item.bytes, 0)
    if (!threadSaves.length) continue
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
  return games
}

export function patchLibraryStorageStatsForSaveFolder(
  stats: LibraryStorageStats,
  patch: SaveFolderIdentityPatch
): LibraryStorageStats | null {
  const key = saveFolderKey(patch.savePath)
  const index = stats.items.findIndex(
    (item) => item.kind === 'saves' && item.savePath && saveFolderKey(item.savePath) === key
  )
  if (index < 0) return null
  const items = stats.items.slice()
  items[index] = saveItemFromPatch(items[index], patch)
  items.sort((a, b) => b.bytes - a.bytes || a.title.localeCompare(b.title))
  return {
    ...stats,
    items,
    games: rebuildGames(items, stats.games)
  }
}
