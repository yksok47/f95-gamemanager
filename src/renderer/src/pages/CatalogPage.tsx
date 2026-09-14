import { useEffect, useMemo, useState, type JSX } from 'react'
import type {
  CatalogFilters,
  CatalogGame,
  CatalogPage as CatalogPageData,
  CatalogSort,
  FavoriteTag,
  HatedTag,
  GameRarity,
  MatchMode,
  VersionPlayStat
} from '@shared/types'
import { TAG_QUERY_LIMIT } from '@shared/types'
import { FALLBACK_PREFIXES } from '@shared/prefixes'
import { nextChipState, type FilterChipState } from '../components/FilterChip'
import FilterShelf from '../components/FilterShelf'
import GameCard from '../components/GameCard'
import SelectMenu from '../components/SelectMenu'
import FooterPortal from '../components/FooterPortal'
import { selectTagsForQuery } from '../lib/favorites'
import { ClearIcon, FilterIcon, HateIcon, RefreshIcon, StarIcon } from '../components/ToolbarIcons'
import ToolbarPortal from '../components/ToolbarPortal'
import { useLibraryByThread, usePlaySessions } from '../lib/library'

type CatalogViewProps = {
  followedIds: Set<number>
  followedPlayById: Map<number, { lastPlayedVersion: string; playedVersions: VersionPlayStat[] }>
  rarityById: Map<number, GameRarity>
  favoriteTags: FavoriteTag[]
  hatedTags: HatedTag[]
  onToggleFollow: (game: CatalogGame) => Promise<void>
  onOpen: (game: CatalogGame) => void
  onSessionExpired: () => Promise<void>
}

const SORTS: Array<{ value: CatalogSort; label: string }> = [
  { value: 'date', label: 'Updated' },
  { value: 'likes', label: 'Likes' },
  { value: 'views', label: 'Views' },
  { value: 'rating', label: 'Rating' },
  { value: 'title', label: 'Title' }
]

function selectedIds(
  state: Record<number, FilterChipState>,
  which: Exclude<FilterChipState, 'off'>
): number[] {
  return Object.entries(state)
    .filter(([, value]) => value === which)
    .map(([id]) => Number(id))
}

export default function CatalogPage({
  followedIds,
  followedPlayById,
  rarityById,
  favoriteTags,
  hatedTags,
  onToggleFollow,
  onOpen,
  onSessionExpired
}: CatalogViewProps): JSX.Element {
  const libraryByThread = useLibraryByThread()
  const sessions = usePlaySessions()
  const [page, setPage] = useState(1)
  const [reloadToken, setReloadToken] = useState(0)
  const [data, setData] = useState<CatalogPageData | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<CatalogFilters>({ prefixes: FALLBACK_PREFIXES, tags: [] })
  const [sort, setSort] = useState<CatalogSort>('date')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [prefixState, setPrefixState] = useState<Record<number, FilterChipState>>({})
  const [tagState, setTagState] = useState<Record<number, FilterChipState>>({})
  const [tagType, setTagType] = useState<MatchMode>('or')
  const [tagQuery, setTagQuery] = useState('')
  const [creatorInput, setCreatorInput] = useState('')
  const [creator, setCreator] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [hatedActive, setHatedActive] = useState(false)

  const prefixes = useMemo(() => selectedIds(prefixState, 'include'), [prefixState])
  const excludePrefixes = useMemo(() => selectedIds(prefixState, 'exclude'), [prefixState])
  const favoriteIds = useMemo(() => favoriteTags.map((tag) => tag.id), [favoriteTags])
  const hatedIds = useMemo(() => hatedTags.map((tag) => tag.id), [hatedTags])
  const appliedFavoriteIds = useMemo(
    () => selectTagsForQuery(favoriteTags).map((tag) => tag.id),
    [favoriteTags]
  )
  const appliedHatedIds = hatedIds
  const lockedFavoriteIds = favoritesOnly ? appliedFavoriteIds : []
  const lockedHatedIds = hatedActive ? appliedHatedIds : []
  const lockedFavoriteSet = useMemo(() => new Set(lockedFavoriteIds), [lockedFavoriteIds])
  const lockedHatedSet = useMemo(() => new Set(lockedHatedIds), [lockedHatedIds])
  const includedTags = useMemo(() => selectedIds(tagState, 'include'), [tagState])
  const excludedTags = useMemo(() => selectedIds(tagState, 'exclude'), [tagState])
  const includeLimitReached = includedTags.length >= TAG_QUERY_LIMIT
  const excludeLimitReached = excludedTags.length >= TAG_QUERY_LIMIT
  const queryTagType = favoritesOnly || hatedActive ? 'or' : tagType
  const activeFilterCount =
    prefixes.length + excludePrefixes.length + includedTags.length + excludedTags.length + (creator ? 1 : 0)

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    const timer = window.setTimeout(() => setCreator(creatorInput.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [creatorInput])

  useEffect(() => {
    void window.api.catalog.filters().then(setFilters).catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!favoritesOnly) return
    const selected = new Set(appliedFavoriteIds)
    setTagState((current) => {
      const next = { ...current }
      let changed = false
      for (const id of favoriteIds) {
        if (selected.has(id)) {
          if (next[id] !== 'include') {
            next[id] = 'include'
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
  }, [favoritesOnly, favoriteIds, appliedFavoriteIds])

  useEffect(() => {
    if (!hatedActive) return
    const selected = new Set(appliedHatedIds)
    setTagState((current) => {
      const next = { ...current }
      let changed = false
      for (const id of hatedIds) {
        if (selected.has(id)) {
          if (next[id] !== 'exclude') {
            next[id] = 'exclude'
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
  }, [hatedActive, hatedIds, appliedHatedIds])

  useEffect(() => {
    if (!filtersOpen) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setFiltersOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [filtersOpen])

  function sessionForThread(threadId: number) {
    return sessions.find((session) => session.threadId === threadId) ?? null
  }

  async function playThread(game: CatalogGame): Promise<void> {
    setError(null)
    try {
      await window.api.library.playLatest(game.threadId, game.engine)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not start the game.'
      if (text.includes('Not logged in')) {
        await onSessionExpired()
        throw err
      }
      setError(text)
      throw err instanceof Error ? err : new Error(text)
    }
  }

  async function stopThread(threadId: number): Promise<void> {
    setError(null)
    try {
      const active = sessions.filter((session) => session.threadId === threadId)
      for (const session of active) {
        await window.api.library.stop(session.fileId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not stop the game.')
    }
  }

  useEffect(() => {
    setPage(1)
  }, [
    sort,
    search,
    creator,
    prefixes,
    excludePrefixes,
    includedTags,
    excludedTags,
    queryTagType,
    favoritesOnly,
    hatedActive
  ])

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      setBusy(true)
      setError(null)
      try {
        const result = await window.api.catalog.list({
          page,
          rows: 90,
          sort,
          search: search || undefined,
          creator: creator || undefined,
          prefixes: prefixes.length ? prefixes : undefined,
          excludePrefixes: excludePrefixes.length ? excludePrefixes : undefined,
          prefixType: 'and',
          tags: includedTags.length ? includedTags : undefined,
          excludeTags: excludedTags.length ? excludedTags : undefined,
          tagType: queryTagType
        })
        if (!cancelled) setData(result)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not load the catalog.'
        if (message.includes('Not logged in')) {
          await onSessionExpired()
          return
        }
        setError(message)
      } finally {
        if (!cancelled) setBusy(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [
    page,
    reloadToken,
    sort,
    search,
    creator,
    prefixes,
    excludePrefixes,
    includedTags,
    excludedTags,
    queryTagType,
    favoritesOnly,
    hatedActive,
    onSessionExpired
  ])

  function togglePrefix(id: number): void {
    setPrefixState((current) => {
      const next = nextChipState(current[id] ?? 'off')
      const copy = { ...current }
      if (next === 'off') delete copy[id]
      else copy[id] = next
      return copy
    })
  }

  function toggleTag(id: number): void {
    if (lockedFavoriteSet.has(id) || lockedHatedSet.has(id)) return
    setTagState((current) => {
      const currentState = current[id] ?? 'off'
      if (currentState === 'off' && (includeLimitReached || excludeLimitReached)) return current
      let next = nextChipState(currentState)
      if (next === 'include' && includeLimitReached) return current
      if (next === 'exclude' && excludeLimitReached) next = 'off'
      const copy = { ...current }
      if (next === 'off') delete copy[id]
      else copy[id] = next
      return copy
    })
  }

  function setFavoriteTagFilters(on: boolean): void {
    const selected = new Set(appliedFavoriteIds)
    setTagState((current) => {
      const next = { ...current }
      for (const id of favoriteIds) {
        if (on && selected.has(id)) next[id] = 'include'
        else delete next[id]
      }
      return next
    })
    if (on) setTagType('or')
  }

  function setHatedTagFilters(on: boolean): void {
    const selected = new Set(appliedHatedIds)
    setTagState((current) => {
      const next = { ...current }
      for (const id of hatedIds) {
        if (on && selected.has(id)) next[id] = 'exclude'
        else delete next[id]
      }
      return next
    })
    if (on) setTagType('or')
  }

  function toggleFavoritesOnly(): void {
    const next = !favoritesOnly
    setFavoritesOnly(next)
    setFavoriteTagFilters(next)
  }

  function toggleHatedActive(): void {
    const next = !hatedActive
    setHatedActive(next)
    setHatedTagFilters(next)
  }

  function lockedTagState(): Record<number, FilterChipState> {
    const next: Record<number, FilterChipState> = {}
    if (favoritesOnly) {
      for (const id of appliedFavoriteIds) next[id] = 'include'
    }
    if (hatedActive) {
      for (const id of appliedHatedIds) next[id] = 'exclude'
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

  return (
    <div className="catalog-page">
      <ToolbarPortal>
        <input
          className="toolbar-search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search games"
        />
        <SelectMenu
          value={sort}
          options={SORTS}
          ariaLabel="Sort catalog"
          onChange={setSort}
        />
        <button
          className={favoritesOnly ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
          type="button"
          aria-pressed={favoritesOnly}
          disabled={!favoriteIds.length}
          title={
            favoriteIds.length
              ? favoritesOnly
                ? 'Showing all tags'
                : 'Show only favorite tags'
              : 'Add favorite tags in Settings'
          }
          aria-label="Filter by favorite tags"
          onClick={toggleFavoritesOnly}
        >
          <StarIcon />
        </button>
        <button
          className={hatedActive ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
          type="button"
          aria-pressed={hatedActive}
          disabled={!hatedIds.length}
          title={
            hatedIds.length
              ? hatedActive
                ? 'Showing hated tags'
                : 'Hide games with hated tags'
              : 'Add hated tags in Settings'
          }
          aria-label="Hide games with hated tags"
          onClick={toggleHatedActive}
        >
          <HateIcon />
        </button>
        <div
          className={[
            'filter-split',
            filtersOpen ? 'is-open' : '',
            activeFilterCount ? 'is-split' : ''
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <button
            className={filtersOpen ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
            type="button"
            aria-pressed={filtersOpen}
            title={activeFilterCount ? `Filters (${activeFilterCount})` : 'Filters'}
            aria-label={activeFilterCount ? `Filters, ${activeFilterCount} active` : 'Filters'}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <FilterIcon />
          </button>
          {activeFilterCount ? (
            <button
              className="ghost-btn icon-btn filter-split-clear"
              type="button"
              title="Clear filters"
              aria-label="Clear filters"
              onClick={clearFilters}
            >
              <span className="filter-split-count">{activeFilterCount}</span>
              <span className="filter-split-x">
                <ClearIcon />
              </span>
            </button>
          ) : null}
        </div>
        <div className="toolbar-actions">
          <button
            className="ghost-btn icon-btn"
            type="button"
            disabled={busy}
            title="Refresh catalog"
            aria-label="Refresh catalog"
            onClick={() => setReloadToken((value) => value + 1)}
          >
            <RefreshIcon spinning={busy && Boolean(data)} />
          </button>
        </div>
      </ToolbarPortal>
      <FooterPortal>
        <span className="muted pager-label">
          {data ? `${data.totalGames.toLocaleString()} titles` : 'Loading…'}
        </span>
        <div className="pager">
          <button
            className="ghost-btn pager-btn"
            disabled={busy || page <= 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
          >
            ‹
          </button>
          <span className="muted pager-label">
            {data?.page ?? page}/{data?.totalPages ?? '…'}
          </span>
          <button
            className="ghost-btn pager-btn"
            disabled={busy || !data || page >= data.totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            ›
          </button>
        </div>
      </FooterPortal>

      {filtersOpen ? (
        <div className="filter-overlay">
          <button
            className="filter-backdrop"
            type="button"
            aria-label="Close filters"
            onClick={() => setFiltersOpen(false)}
          />
          <FilterShelf
            filters={filters}
            prefixState={prefixState}
            tagState={tagState}
            tagType={tagType}
            tagQuery={tagQuery}
            creatorInput={creatorInput}
            favoriteTags={favoriteTags}
            hatedTags={hatedTags}
            favoritesOnly={favoritesOnly}
            hatedActive={hatedActive}
            lockedFavoriteIds={lockedFavoriteIds}
            lockedHatedIds={lockedHatedIds}
            includeLimitReached={includeLimitReached}
            excludeLimitReached={excludeLimitReached}
            onTogglePrefix={togglePrefix}
            onToggleTag={toggleTag}
            onTagType={setTagType}
            onTagQuery={setTagQuery}
            onCreatorInput={setCreatorInput}
          />
        </div>
      ) : null}

      {error ? <p className="catalog-status error-text">{error}</p> : null}
      {busy && !data ? <p className="catalog-status muted">Loading catalog…</p> : null}

      {data && data.games.length === 0 ? (
        <div className="empty-state">No games match these filters.</div>
      ) : (
        <div className="catalog-grid">
          {data?.games.map((game) => {
            const play = followedPlayById.get(game.threadId)
            return (
            <GameCard
              key={game.threadId}
              game={{
                ...game,
                rarity: rarityById.get(game.threadId),
                lastPlayedVersion: play?.lastPlayedVersion,
                playedVersions: play?.playedVersions
              }}
              subscribed={followedIds.has(game.threadId)}
              favoriteTags={favoriteTags}
              hatedTags={hatedTags}
              onToggle={() => void onToggleFollow(game)}
              onOpen={() => onOpen(game)}
              onPlay={
                libraryByThread.get(game.threadId)?.isInstalled
                  ? () => playThread(game)
                  : undefined
              }
              onStop={
                libraryByThread.get(game.threadId)?.isInstalled
                  ? () => stopThread(game.threadId)
                  : undefined
              }
              library={libraryByThread.get(game.threadId)}
              playing={Boolean(sessionForThread(game.threadId))}
              prefixCatalog={filters.prefixes}
            />
            )
          })}
        </div>
      )}
    </div>
  )
}
