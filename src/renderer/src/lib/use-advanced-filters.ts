import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
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

export function useAdvancedFilters(favoriteTags: FavoriteTag[], hatedTags: HatedTag[]) {
  const filters = useCatalogFilters()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [prefixState, setPrefixState] = useState<Record<number, FilterChipState>>({})
  const [tagState, setTagState] = useState<Record<number, FilterChipState>>({})
  const [tagType, setTagType] = useState<MatchMode>('or')
  const [tagQuery, setTagQuery] = useState('')
  const [creatorInput, setCreatorInput] = useState('')
  const [creator, setCreator] = useState('')
  const [favoritesFilter, setFavoritesFilter] = useState<FilterChipState>('off')
  const [hatedFilter, setHatedFilter] = useState<FilterChipState>('off')

  const prefixes = useMemo(() => selectedChipIds(prefixState, 'include'), [prefixState])
  const excludePrefixes = useMemo(() => selectedChipIds(prefixState, 'exclude'), [prefixState])
  const favoriteIds = useMemo(() => favoriteTags.map((tag) => tag.id), [favoriteTags])
  const hatedIds = useMemo(() => hatedTags.map((tag) => tag.id), [hatedTags])
  const lockedFavoriteIds = favoritesFilter === 'off' ? [] : favoriteIds
  const lockedHatedIds = hatedFilter === 'off' ? [] : hatedIds
  const lockedFavoriteSet = useMemo(() => new Set(lockedFavoriteIds), [lockedFavoriteIds])
  const lockedHatedSet = useMemo(() => new Set(lockedHatedIds), [lockedHatedIds])
  const includedTags = useMemo(() => selectedChipIds(tagState, 'include'), [tagState])
  const excludedTags = useMemo(() => selectedChipIds(tagState, 'exclude'), [tagState])
  const queryTagType = favoritesFilter !== 'off' || hatedFilter !== 'off' ? 'or' : tagType
  const activeFilterCount =
    prefixes.length + excludePrefixes.length + includedTags.length + excludedTags.length + (creator ? 1 : 0)

  useEffect(() => {
    const timer = window.setTimeout(() => setCreator(creatorInput.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [creatorInput])

  useEffect(() => {
    if (favoritesFilter === 'off') return
    const selected = new Set(favoriteIds)
    setTagState((current) => {
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
    setTagType('or')
  }, [favoritesFilter, favoriteIds])

  useEffect(() => {
    if (hatedFilter === 'off') return
    const selected = new Set(hatedIds)
    setTagState((current) => {
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
    setTagType('or')
  }, [hatedFilter, hatedIds])

  const closeFilters = useCallback(() => setFiltersOpen(false), [])
  const toggleFilters = useCallback(() => setFiltersOpen((open) => !open), [])

  const togglePrefix = useCallback((id: number, direction: ChipCycleDirection = 'forward'): void => {
    setPrefixState((current) => {
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
      setTagState((current) => {
        const next = cycleChipState(current[id] ?? 'off', direction)
        const copy = { ...current }
        if (next === 'off') delete copy[id]
        else copy[id] = next
        return copy
      })
    },
    [lockedFavoriteSet, lockedHatedSet]
  )

  function applyLockedTagFilters(
    ids: number[],
    appliedIds: number[],
    state: FilterChipState
  ): void {
    const selected = new Set(appliedIds)
    setTagState((current) => {
      const next = { ...current }
      for (const id of ids) {
        if (state !== 'off' && selected.has(id)) next[id] = state
        else delete next[id]
      }
      return next
    })
    if (state !== 'off') setTagType('or')
  }

  function cycleFavoritesFilter(event: MouseEvent): void {
    event.preventDefault()
    const next = cycleChipState(favoritesFilter, cycleDirectionFromEvent(event))
    setFavoritesFilter(next)
    applyLockedTagFilters(favoriteIds, favoriteIds, next)
  }

  function cycleHatedFilter(event: MouseEvent): void {
    event.preventDefault()
    const next = cycleChipState(hatedFilter, cycleDirectionFromEvent(event, 'reverse'))
    setHatedFilter(next)
    applyLockedTagFilters(hatedIds, hatedIds, next)
  }

  function lockedTagState(): Record<number, FilterChipState> {
    const next: Record<number, FilterChipState> = {}
    if (favoritesFilter !== 'off') {
      for (const id of favoriteIds) next[id] = favoritesFilter
    }
    if (hatedFilter !== 'off') {
      for (const id of hatedIds) next[id] = hatedFilter
    }
    return next
  }

  function clearFilters(): void {
    setPrefixState({})
    setTagQuery('')
    setCreatorInput('')
    setCreator('')
    setTagState(lockedTagState())
    setTagType('or')
  }

  const applyQuickFilter = useCallback((snapshot: QuickFilterSnapshot): void => {
    const next = captureQuickFilterSnapshot(snapshot)
    setPrefixState(next.prefixState)
    setTagState(next.tagState)
    setTagType(next.tagType)
    setCreatorInput(next.creator)
    setCreator(next.creator)
    setFavoritesFilter(next.favoritesFilter)
    setHatedFilter(next.hatedFilter)
  }, [])

  const matches = useCallback(
    (game: LocalFilterGame): boolean =>
      matchesLocalFilters(game, {
        includePrefixes: prefixes,
        excludePrefixes,
        includeTags: includedTags,
        excludeTags: excludedTags,
        tagType: queryTagType,
        creator
      }),
    [prefixes, excludePrefixes, includedTags, excludedTags, queryTagType, creator]
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
    setTagQuery,
    creatorInput,
    setCreatorInput,
    favoritesFilter,
    hatedFilter,
    lockedFavoriteIds,
    lockedHatedIds,
    activeFilterCount,
    togglePrefix,
    toggleTag,
    setTagType,
    clearFilters,
    applyQuickFilter,
    cycleFavoritesFilter,
    cycleHatedFilter,
    matches
  }
}

export type AdvancedFilters = ReturnType<typeof useAdvancedFilters>
