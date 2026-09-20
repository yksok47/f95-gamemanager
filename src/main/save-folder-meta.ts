import { basename, resolve } from 'path'
import { maxLikeCount, maxViewCount } from '@shared/counts'
import type { IdentifiedSaveFolder } from '@shared/types'

function firstIds(...lists: number[][]): number[] {
  for (const list of lists) {
    if (list.length) return list
  }
  return []
}

export function mergeIdentifiedSaveFolder(
  prev: IdentifiedSaveFolder | undefined,
  next: IdentifiedSaveFolder
): IdentifiedSaveFolder {
  if (!prev) return next
  return {
    title: next.title || prev.title,
    threadId: next.threadId || prev.threadId,
    coverUrl: next.coverUrl || prev.coverUrl,
    savePath: next.savePath || prev.savePath,
    folderName: next.folderName || prev.folderName,
    identifiedAt: Math.max(next.identifiedAt || 0, prev.identifiedAt || 0),
    creator: next.creator || prev.creator,
    engine: next.engine || prev.engine,
    version: next.version || prev.version,
    rating: Math.max(next.rating || 0, prev.rating || 0) || undefined,
    likes: maxLikeCount(next.likes, prev.likes) || undefined,
    views: maxViewCount(next.views, prev.views) || undefined,
    threadUrl: next.threadUrl || prev.threadUrl,
    prefixes: firstIds(next.prefixes || [], prev.prefixes || []),
    tags: firstIds(next.tags || [], prev.tags || []),
    timestamp: Math.max(next.timestamp || 0, prev.timestamp || 0) || undefined,
    updatedAt: next.updatedAt || prev.updatedAt,
    screens: next.screens?.length ? next.screens : prev.screens
  }
}

export function saveFolderKey(savePath: string): string {
  return resolve(savePath).toLowerCase()
}

export function identifiedSaveFoldersForGame(
  records: IdentifiedSaveFolder[],
  threadId?: number,
  title?: string
): IdentifiedSaveFolder[] {
  if (threadId) {
    return records
      .filter((item) => item.threadId === threadId)
      .sort((a, b) => b.identifiedAt - a.identifiedAt)
  }
  const needle = (title || '').trim().toLowerCase()
  if (!needle) return []
  return records
    .filter((item) => item.title.trim().toLowerCase() === needle)
    .sort((a, b) => b.identifiedAt - a.identifiedAt)
}

export function pickIdentifiedSaveFolder(
  records: IdentifiedSaveFolder[],
  threadId?: number,
  title?: string
): IdentifiedSaveFolder | null {
  const matches = identifiedSaveFoldersForGame(records, threadId, title)
  if (threadId) return matches[0] ?? null
  return matches.length === 1 ? matches[0] : null
}

export type RenpySaveLocationOption = {
  savePath: string
  folderName: string
}

export function renpySaveLocationOptions(
  identified: IdentifiedSaveFolder[],
  currentSavePath: string | null | undefined
): RenpySaveLocationOption[] {
  const byKey = new Map<string, { savePath: string; folderName: string; identifiedAt: number }>()
  for (const item of identified) {
    if (!item.savePath) continue
    byKey.set(saveFolderKey(item.savePath), {
      savePath: item.savePath,
      folderName: item.folderName || basename(item.savePath),
      identifiedAt: item.identifiedAt || 0
    })
  }
  const current = (currentSavePath || '').trim()
  const currentKey = current ? saveFolderKey(current) : ''
  if (current && !byKey.has(currentKey)) {
    byKey.set(currentKey, {
      savePath: current,
      folderName: basename(current),
      identifiedAt: Number.MAX_SAFE_INTEGER
    })
  }
  return [...byKey.values()]
    .sort((a, b) => {
      const aCur = saveFolderKey(a.savePath) === currentKey ? 1 : 0
      const bCur = saveFolderKey(b.savePath) === currentKey ? 1 : 0
      if (aCur !== bCur) return bCur - aCur
      return b.identifiedAt - a.identifiedAt
    })
    .map(({ savePath, folderName }) => ({ savePath, folderName }))
}
