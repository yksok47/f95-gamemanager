import type { MatchMode } from '@shared/types'
import type { FilterChipState } from '../components/FilterChip'

export const QUICK_FILTERS_STORAGE_KEY = 'quick-filters'

export type QuickFilterSnapshot = {
  prefixState: Record<number, FilterChipState>
  tagState: Record<number, FilterChipState>
  tagType: MatchMode
  creator: string
  favoritesFilter: FilterChipState
  hatedFilter: FilterChipState
}

export type QuickFilter = {
  id: string
  name: string
  snapshot: QuickFilterSnapshot
}

export function emptyQuickFilterSnapshot(): QuickFilterSnapshot {
  return {
    prefixState: {},
    tagState: {},
    tagType: 'or',
    creator: '',
    favoritesFilter: 'off',
    hatedFilter: 'off'
  }
}

export function captureQuickFilterSnapshot(input: QuickFilterSnapshot): QuickFilterSnapshot {
  return {
    prefixState: cloneChipState(input.prefixState),
    tagState: cloneChipState(input.tagState),
    tagType: input.tagType === 'and' ? 'and' : 'or',
    creator: input.creator.trim(),
    favoritesFilter: normalizeChipState(input.favoritesFilter),
    hatedFilter: normalizeChipState(input.hatedFilter)
  }
}

export function snapshotsEqual(a: QuickFilterSnapshot, b: QuickFilterSnapshot): boolean {
  return (
    a.tagType === b.tagType &&
    a.creator === b.creator &&
    a.favoritesFilter === b.favoritesFilter &&
    a.hatedFilter === b.hatedFilter &&
    chipStateEqual(a.prefixState, b.prefixState) &&
    chipStateEqual(a.tagState, b.tagState)
  )
}

export function parseQuickFilters(raw: unknown): QuickFilter[] {
  if (!Array.isArray(raw)) return []
  const items: QuickFilter[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id) continue
    if (typeof record.name !== 'string' || !record.name.trim()) continue
    items.push({
      id: record.id,
      name: record.name.trim(),
      snapshot: parseSnapshot(record.snapshot)
    })
  }
  return items
}

export function loadQuickFilters(): QuickFilter[] {
  try {
    const raw = window.localStorage.getItem(QUICK_FILTERS_STORAGE_KEY)
    if (!raw) return []
    return parseQuickFilters(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

export function saveQuickFilters(items: QuickFilter[]): void {
  try {
    window.localStorage.setItem(QUICK_FILTERS_STORAGE_KEY, JSON.stringify(items))
  } catch {
    /* ignore quota / private-mode failures */
  }
}

function parseSnapshot(raw: unknown): QuickFilterSnapshot {
  if (!raw || typeof raw !== 'object') return emptyQuickFilterSnapshot()
  const record = raw as Record<string, unknown>
  return captureQuickFilterSnapshot({
    prefixState: parseChipStateRecord(record.prefixState),
    tagState: parseChipStateRecord(record.tagState),
    tagType: record.tagType === 'and' ? 'and' : 'or',
    creator: typeof record.creator === 'string' ? record.creator : '',
    favoritesFilter: normalizeChipState(record.favoritesFilter),
    hatedFilter: normalizeChipState(record.hatedFilter)
  })
}

function parseChipStateRecord(raw: unknown): Record<number, FilterChipState> {
  if (!raw || typeof raw !== 'object') return {}
  const next: Record<number, FilterChipState> = {}
  for (const [key, value] of Object.entries(raw)) {
    const id = Number(key)
    if (!Number.isInteger(id)) continue
    const state = normalizeChipState(value)
    if (state === 'off') continue
    next[id] = state
  }
  return next
}

function cloneChipState(state: Record<number, FilterChipState>): Record<number, FilterChipState> {
  return parseChipStateRecord(state)
}

function chipStateEqual(
  a: Record<number, FilterChipState>,
  b: Record<number, FilterChipState>
): boolean {
  const left = cloneChipState(a)
  const right = cloneChipState(b)
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every((key) => left[Number(key)] === right[Number(key)])
}

function normalizeChipState(value: unknown): FilterChipState {
  if (value === 'include' || value === 'exclude') return value
  return 'off'
}
