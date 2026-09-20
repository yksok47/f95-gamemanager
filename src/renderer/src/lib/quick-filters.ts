import {
  captureQuickFilterSnapshot,
  emptyQuickFilterSnapshot,
  parseQuickFilters,
  snapshotsEqual,
  type QuickFilter,
  type QuickFilterSnapshot
} from '@shared/quick-filters'

export {
  captureQuickFilterSnapshot,
  emptyQuickFilterSnapshot,
  parseQuickFilters,
  snapshotsEqual
}
export type { QuickFilter, QuickFilterSnapshot }

export const QUICK_FILTERS_STORAGE_KEY = 'quick-filters'

export function loadLegacyQuickFilters(): QuickFilter[] {
  try {
    const raw = window.localStorage.getItem(QUICK_FILTERS_STORAGE_KEY)
    if (!raw) return []
    return parseQuickFilters(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

export function clearLegacyQuickFilters(): void {
  try {
    window.localStorage.removeItem(QUICK_FILTERS_STORAGE_KEY)
  } catch {
    /* ignore quota / private-mode failures */
  }
}
