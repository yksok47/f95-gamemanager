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
