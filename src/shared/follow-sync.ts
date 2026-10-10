import type { FollowSyncStatus } from './types'

/** 0–1 progress for the catch-up/manual follow sync, or 1 when idle. */
export function followSyncProgress(sync: FollowSyncStatus): number {
  if (!sync.running) return 1
  if (sync.mode === 'catchup') {
    const page = Math.max(0, sync.page)
    if (!page) return 0
    return page / (page + (sync.pending > 0 ? 1 : 0))
  }
  const total = sync.checked + sync.pending
  return total ? sync.checked / total : 0
}

export function followSyncLabel(sync: FollowSyncStatus): string {
  if (!sync.running) return ''
  if (sync.mode === 'manual' && (sync.checked > 0 || sync.pending > 0)) {
    return `Checking ${sync.checked}/${sync.checked + sync.pending}`
  }
  if (sync.page > 0) return `Checking page ${sync.page}`
  return 'Checking updates…'
}
