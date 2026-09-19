import { isInFlightP2pState, type P2pTransferProgress } from '@shared/p2p'
import type { DownloadRecord, DownloadStatus } from '@shared/types'

export function isActiveDownload(item: DownloadRecord): boolean {
  return item.status === 'progressing' || item.status === 'paused' || item.status === 'interrupted'
}

/** Completed downloads that still need hashing or approve/reject before they leave the dock. */
export function needsReviewDownload(item: DownloadRecord): boolean {
  if (item.status !== 'completed') return false
  return item.libraryStatus === 'pendingReview' || item.libraryStatus === 'hashing'
}

export function isDockDownload(item: DownloadRecord): boolean {
  return isActiveDownload(item) || needsReviewDownload(item)
}

/** In-progress P2P downloads for UI lists (excludes background seeds of mapped shares). */
export function isActiveP2pDownload(
  item: P2pTransferProgress,
  sharedContentHashes?: ReadonlySet<string>
): boolean {
  if (!isInFlightP2pState(item.state)) return false
  // create-torrent / skipVerify hashing is background work after the file is usable.
  if (item.state === 'checking') return false
  if (
    item.id.startsWith('seed:') &&
    item.contentHash &&
    sharedContentHashes?.has(item.contentHash.toLowerCase()) &&
    item.state !== 'paused' &&
    item.state !== 'error'
  ) {
    return false
  }
  return true
}

/** P2P transfers that should keep the downloads dock visible (in-flight + quarantined). */
export function isDockP2pDownload(
  item: P2pTransferProgress,
  sharedContentHashes?: ReadonlySet<string>
): boolean {
  return isActiveP2pDownload(item, sharedContentHashes) || item.state === 'quarantined'
}

/** True when a HTTP/P2P row is the archive currently being extracted. */
export function transferMatchesLibraryFile(
  item: {
    contentHash?: string
    hash?: string
    path?: string
    savePath?: string
    filename?: string
    normalizedName?: string
  },
  file: { hash: string; archivePath: string; filename: string }
): boolean {
  const fileHash = file.hash.trim().toLowerCase()
  const itemHash = (item.contentHash || item.hash || '').trim().toLowerCase()
  if (fileHash && itemHash && fileHash === itemHash) return true
  const filename = file.filename.trim().toLowerCase()
  const archive = file.archivePath.replace(/\\/g, '/').toLowerCase()
  const path = (item.path || item.savePath || '').replace(/\\/g, '/').toLowerCase()
  if (archive && path && (path === archive || (filename && path.endsWith('/' + filename)))) {
    return true
  }
  const itemName = (item.normalizedName || item.filename || '').trim().toLowerCase()
  return Boolean(filename && itemName && filename === itemName)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

export function formatSpeed(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return ''
  return `${formatBytes(bytesPerSecond)}/s`
}

export function formatEta(item: DownloadRecord): string {
  if (item.status !== 'progressing' || item.totalBytes <= 0 || item.bytesPerSecond <= 0) return ''
  const remaining = Math.max(0, item.totalBytes - item.receivedBytes)
  const seconds = Math.round(remaining / item.bytesPerSecond)
  if (seconds < 60) return `${seconds}s left`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m left`
  return `${Math.round(seconds / 3600)}h left`
}

export function downloadPercent(item: DownloadRecord): number | null {
  if (item.totalBytes <= 0) return item.status === 'completed' ? 100 : null
  return Math.max(0, Math.min(100, Math.round((item.receivedBytes / item.totalBytes) * 100)))
}

export function downloadLibraryLabel(item: { libraryStatus?: DownloadRecord['libraryStatus'] }): string {
  if (item.libraryStatus === 'hashing') return 'Hashing…'
  if (item.libraryStatus === 'pendingReview') return 'Needs review'
  if (item.libraryStatus === 'indexed') return 'Added to game files'
  if (item.libraryStatus === 'error') return 'Could not add to game files'
  return ''
}

export function downloadStatusLabel(status: DownloadStatus): string {
  if (status === 'progressing') return 'Downloading'
  if (status === 'paused') return 'Paused'
  if (status === 'completed') return 'Completed'
  if (status === 'cancelled') return 'Cancelled'
  return 'Interrupted'
}

export type ThreadDownloadProgress = {
  threadId: number
  title: string
  version: string
  creator: string
  coverUrl: string | null
  engine: string
  percent: number | null
  startedAt: number
}

function p2pPercent(item: P2pTransferProgress): number {
  return Math.max(0, Math.min(100, Math.round((item.progress || 0) * 100)))
}

function mergeThreadDownload(
  existing: ThreadDownloadProgress | undefined,
  next: ThreadDownloadProgress
): ThreadDownloadProgress {
  if (!existing) return next
  const percents = [existing.percent, next.percent].filter((value): value is number => value != null)
  return {
    threadId: next.threadId,
    title: existing.title.trim() || next.title,
    version: existing.version || next.version,
    creator: existing.creator || next.creator,
    coverUrl: existing.coverUrl || next.coverUrl,
    engine: existing.engine || next.engine,
    percent: percents.length
      ? Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length)
      : null,
    startedAt: Math.min(existing.startedAt, next.startedAt)
  }
}

/** In-flight HTTP/P2P downloads keyed by F95 thread, including hashing/review until they join the library. */
export function collectThreadDownloads(
  downloads: DownloadRecord[],
  p2pTransfers: P2pTransferProgress[] = [],
  sharedContentHashes?: ReadonlySet<string>
): Map<number, ThreadDownloadProgress> {
  const byThread = new Map<number, ThreadDownloadProgress>()
  const now = Date.now()

  for (const item of downloads) {
    if (!isDockDownload(item)) continue
    const threadId = item.gameThreadId
    if (threadId == null || !Number.isFinite(threadId)) continue
    byThread.set(
      threadId,
      mergeThreadDownload(byThread.get(threadId), {
        threadId,
        title: item.gameTitle?.trim() || item.filename,
        version: item.gameVersion || '',
        creator: item.gameCreator || '',
        coverUrl: item.gameCoverUrl || null,
        engine: item.gameEngine || '',
        percent: downloadPercent(item),
        startedAt: item.startedAt
      })
    )
  }

  for (const item of p2pTransfers) {
    if (!isDockP2pDownload(item, sharedContentHashes)) continue
    const threadId = item.f95ThreadId
    if (threadId == null || !Number.isFinite(threadId)) continue
    byThread.set(
      threadId,
      mergeThreadDownload(byThread.get(threadId), {
        threadId,
        title: item.gameName?.trim() || item.normalizedName || 'Download',
        version: item.gameVersion || '',
        creator: '',
        coverUrl: null,
        engine: '',
        percent: p2pPercent(item),
        startedAt: now
      })
    )
  }

  return byThread
}
