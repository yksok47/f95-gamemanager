import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type MouseEvent } from 'react'
import type { FavoriteTag, HatedTag, MatchMode } from '@shared/types'
import {
  cycleChipState,
  cycleDirectionFromEvent,
  type ChipCycleDirection,
  type FilterChipState
} from '../components/FilterChip'
import { matchesLocalFilters, selectedChipIds, type LocalFilterGame } from './game-filters'
import { useCatalogFilters } from './catalog-prefixes'
import {
  captureQuickFilterSnapshot,
  type QuickFilterSnapshot
} from './quick-filters'
import { selectTagsForQuery } from './favorites'
import {
  getAdvancedFilterSelection,
  subscribeAdvancedFilterSelection,
  updateAdvancedFilterSelection,
  type AdvancedFilterSelection
} from './advanced-filter-selection'

function setSelectionField<K extends keyof AdvancedFilterSelection>(
  key: K,
  action: AdvancedFilterSelection[K] | ((current: AdvancedFilterSelection[K]) => AdvancedFilterSelection[K])
): void {
  updateAdvancedFilterSelection((current) => {
    const next = typeof action === 'function' ? action(current[key]) : action
    if (next === current[key]) return current
    return { ...current, [key]: next }
  })
}

export function useAdvancedFilters(
  favoriteTags: FavoriteTag[],
  hatedTags: HatedTag[],
  tagQueryLimit?: number
) {
  const filters = useCatalogFilters()
  const selection = useSyncExternalStore(
    subscribeAdvancedFilterSelection,
    getAdvancedFilterSelection,
    getAdvancedFilterSelection
  )
  const {
    prefixState,
    tagState,
    tagType,
    tagQuery,
    creatorInput,
    creator,
    favoritesFilter,
    hatedFilter
  } = selection
  const [filtersOpen, setFiltersOpen] = useState(false)

  const includePrefixes = useMemo(() => selectedChipIds(prefixState, 'include'), [prefixState])
  const excludePrefixes = useMemo(() => selectedChipIds(prefixState, 'exclude'), [prefixState])
  const favoriteIds = useMemo(() => favoriteTags.map((tag) => tag.id), [favoriteTags])
  const hatedIds = useMemo(() => hatedTags.map((tag) => tag.id), [hatedTags])
  const appliedFavoriteIds = useMemo(
    () => selectTagsForQuery(favoriteTags).map((tag) => tag.id),
    [favoriteTags]
  )
  const lockedFavoriteIds = favoritesFilter === 'off' ? [] : appliedFavoriteIds
  const lockedHatedIds = hatedFilter === 'off' ? [] : hatedIds
  const lockedFavoriteSet = useMemo(() => new Set(lockedFavoriteIds), [lockedFavoriteIds])
  const lockedHatedSet = useMemo(() => new Set(lockedHatedIds), [lockedHatedIds])
  const includeTags = useMemo(() => selectedChipIds(tagState, 'include'), [tagState])
  const excludeTags = useMemo(() => selectedChipIds(tagState, 'exclude'), [tagState])
  const queryTagType = favoritesFilter !== 'off' || hatedFilter !== 'off' ? 'or' : tagType
  const activeFilterCount =
    includePrefixes.length +
    excludePrefixes.length +
    includeTags.length +
    excludeTags.length +
    (creator ? 1 : 0)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      updateAdvancedFilterSelection((current) => {
        const next = current.creatorInput.trim()
        if (next === current.creator) return current
        return { ...current, creator: next }
      })
    }, 400)
    return () => window.clearTimeout(timer)
  }, [creatorInput])

  useEffect(() => {
    if (favoritesFilter === 'off') return
    const selected = new Set(appliedFavoriteIds)
    setSelectionField('tagState', (current) => {
      const next = { ...current }
      let changed = false
      for (const id of favoriteIds) {
        if (selected.has(id)) {
          if (next[id] !== favoritesFilter) {
            next[id] = favoritesFilter
            changed = true
          }
        } else if (next[id]) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : current
    })
    setSelectionField('tagType', 'or')
  }, [favoritesFilter, favoriteIds, appliedFavoriteIds])

  useEffect(() => {
    if (hatedFilter === 'off') return
    const selected = new Set(hatedIds)
    setSelectionField('tagState', (current) => {
      const next = { ...current }
      let changed = false
      for (const id of hatedIds) {
        if (selected.has(id)) {
          if (next[id] !== hatedFilter) {
            next[id] = hatedFilter
            changed = true
          }
        } else if (next[id]) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : current
    })
    setSelectionField('tagType', 'or')
  }, [hatedFilter, hatedIds])

  const closeFilters = useCallback(() => setFiltersOpen(false), [])
  const toggleFilters = useCallback(() => setFiltersOpen((open) => !open), [])

  const togglePrefix = useCallback((id: number, direction: ChipCycleDirection = 'forward'): void => {
    setSelectionField('prefixState', (current) => {
      const next = cycleChipState(current[id] ?? 'off', direction)
      const copy = { ...current }
      if (next === 'off') delete copy[id]
      else copy[id] = next
      return copy
    })
  }, [])

  const toggleTag = useCallback(
    (id: number, direction: ChipCycleDirection = 'forward'): void => {
      if (lockedFavoriteSet.has(id) || lockedHatedSet.has(id)) return
      updateAdvancedFilterSelection((current) => {
        const currentState = current.tagState[id] ?? 'off'
        let next = cycleChipState(currentState, direction)
        if (tagQueryLimit != null) {
          const included = selectedChipIds(current.tagState, 'include').length
          const excluded = selectedChipIds(current.tagState, 'exclude').length
          if (currentState === 'off' && included >= tagQueryLimit && excluded >= tagQueryLimit) {
            return current
          }
          if (next === 'include' && included >= tagQueryLimit) next = cycleChipState(next, direction)
          if (next === 'exclude' && excluded >= tagQueryLimit) next = cycleChipState(next, direction)
        }
        if (next === currentState) return current
        const copy = { ...current.tagState }
        if (next === 'off') delete copy[id]
        else copy[id] = next
        return { ...current, tagState: copy }
      })
    },
    [lockedFavoriteSet, lockedHatedSet, tagQueryLimit]
  )

  function applyLockedTagFilters(
    ids: number[],
    appliedIds: number[],
    state: FilterChipState
  ): void {
    const selected = new Set(appliedIds)
    setSelectionField('tagState', (current) => {
      const next = { ...current }
      for (const id of ids) {
        if (state !== 'off' && selected.has(id)) next[id] = state
        else delete next[id]
      }
      return next
    })
    if (state !== 'off') setSelectionField('tagType', 'or')
  }

  function cycleFavoritesFilter(event: MouseEvent): void {
    event.preventDefault()
    const next = cycleChipState(favoritesFilter, cycleDirectionFromEvent(event))
    setSelectionField('favoritesFilter', next)
    applyLockedTagFilters(favoriteIds, appliedFavoriteIds, next)
  }

  function cycleHatedFilter(event: MouseEvent): void {
    event.preventDefault()
    const next = cycleChipState(hatedFilter, cycleDirectionFromEvent(event, 'reverse'))
    setSelectionField('hatedFilter', next)
    applyLockedTagFilters(hatedIds, hatedIds, next)
  }

  function lockedTagState(): Record<number, FilterChipState> {
    const next: Record<number, FilterChipState> = {}
    if (favoritesFilter !== 'off') {
      for (const id of appliedFavoriteIds) next[id] = favoritesFilter
    }
    if (hatedFilter !== 'off') {
      for (const id of hatedIds) next[id] = hatedFilter
    }
    return next
  }

  function clearFilters(): void {
    updateAdvancedFilterSelection((current) => ({
      ...current,
      prefixState: {},
      tagQuery: '',
      creatorInput: '',
      creator: '',
      tagState: lockedTagState(),
      tagType: 'or'
    }))
  }

  const applyQuickFilter = useCallback((snapshot: QuickFilterSnapshot): void => {
    const next = captureQuickFilterSnapshot(snapshot)
    updateAdvancedFilterSelection((current) => ({
      ...current,
      prefixState: next.prefixState,
      tagState: next.tagState,
      tagType: next.tagType,
      creatorInput: next.creator,
      creator: next.creator,
      favoritesFilter: next.favoritesFilter,
      hatedFilter: next.hatedFilter
    }))
  }, [])

  const matches = useCallback(
    (game: LocalFilterGame): boolean =>
      matchesLocalFilters(game, {
        includePrefixes,
        excludePrefixes,
        includeTags,
        excludeTags,
        tagType: queryTagType,
        creator
      }),
    [includePrefixes, excludePrefixes, includeTags, excludeTags, queryTagType, creator]
  )

  return {
    filters,
    filtersOpen,
    closeFilters,
    toggleFilters,
    prefixState,
    tagState,
    tagType,
    tagQuery,
    setTagQuery: (value: string) => setSelectionField('tagQuery', value),
    creatorInput,
    setCreatorInput: (value: string) => setSelectionField('creatorInput', value),
    creator,
    favoritesFilter,
    hatedFilter,
    lockedFavoriteIds,
    lockedHatedIds,
    includePrefixes,
    excludePrefixes,
    includeTags,
    excludeTags,
    queryTagType,
    activeFilterCount,
    togglePrefix,
    toggleTag,
    setTagType: (value: MatchMode) => setSelectionField('tagType', value),
    clearFilters,
    applyQuickFilter,
    cycleFavoritesFilter,
    cycleHatedFilter,
    matches
  }
}

export type AdvancedFilters = ReturnType<typeof useAdvancedFilters>
