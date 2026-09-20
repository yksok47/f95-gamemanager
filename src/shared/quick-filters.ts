import type { FilterChipState, QuickFilter, QuickFilterSnapshot } from './types'

export type { QuickFilter, QuickFilterSnapshot }

export const MAX_QUICK_FILTERS = 40

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
  const seen = new Set<string>()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id) continue
    if (seen.has(record.id)) continue
    if (typeof record.name !== 'string' || !record.name.trim()) continue
    seen.add(record.id)
    items.push({
      id: record.id,
      name: record.name.trim(),
      snapshot: parseSnapshot(record.snapshot)
    })
    if (items.length >= MAX_QUICK_FILTERS) break
  }
  return items
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
