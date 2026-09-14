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
