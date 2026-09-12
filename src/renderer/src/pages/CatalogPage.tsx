import { useEffect, useMemo, useState, type JSX } from 'react'
import type {
  CatalogFilters,
  CatalogGame,
  CatalogPage as CatalogPageData,
  CatalogSort,
  FavoriteTag,
  GameRarity,
  MatchMode
} from '@shared/types'
import { FALLBACK_PREFIXES } from '@shared/prefixes'
import { nextChipState, type FilterChipState } from '../components/FilterChip'
import FilterShelf from '../components/FilterShelf'
import GameCard from '../components/GameCard'
import SelectMenu from '../components/SelectMenu'
import FooterPortal from '../components/FooterPortal'
import { FilterIcon, RefreshIcon, StarIcon } from '../components/ToolbarIcons'
import ToolbarPortal from '../components/ToolbarPortal'
import { useLibraryByThread, usePlaySessions } from '../lib/library'

type CatalogViewProps = {
  followedIds: Set<number>
  rarityById: Map<number, GameRarity>
  favoriteTags: FavoriteTag[]
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
  rarityById,
  favoriteTags,
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
  const [prefixType, setPrefixType] = useState<MatchMode>('and')
  const [tagQuery, setTagQuery] = useState('')
  const [creatorInput, setCreatorInput] = useState('')
  const [creator, setCreator] = useState('')
  const [favoritesOnly, setFavoritesOnly] = useState(false)

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
        return
      }
      setError(text)
    }
  }

  const prefixes = useMemo(() => selectedIds(prefixState, 'include'), [prefixState])
  const excludePrefixes = useMemo(() => selectedIds(prefixState, 'exclude'), [prefixState])
  const tags = useMemo(() => selectedIds(tagState, 'include'), [tagState])
  const excludeTags = useMemo(() => selectedIds(tagState, 'exclude'), [tagState])
  const favoriteIds = useMemo(() => favoriteTags.map((tag) => tag.id), [favoriteTags])
  const queryTags = useMemo(
    () => (tags.length ? tags : favoritesOnly ? favoriteIds : []),
    [tags, favoritesOnly, favoriteIds]
  )
  const activeFilterCount =
    prefixes.length + excludePrefixes.length + tags.length + excludeTags.length + (creator ? 1 : 0)

  useEffect(() => {
    setPage(1)
  }, [
    sort,
    search,
    creator,
    prefixes,
    excludePrefixes,
    queryTags,
    excludeTags,
    tagType,
    prefixType,
    favoritesOnly
  ])

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      setBusy(true)
      setError(null)
      try {
        const result = await window.api.catalog.list({
          page,
          rows: 30,
          sort,
          search: search || undefined,
          creator: creator || undefined,
          prefixes: prefixes.length ? prefixes : undefined,
          excludePrefixes: excludePrefixes.length ? excludePrefixes : undefined,
          prefixType,
          tags: queryTags.length ? queryTags : undefined,
          excludeTags: excludeTags.length ? excludeTags : undefined,
          tagType: favoritesOnly && !tags.length ? 'or' : tagType
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
    prefixType,
    queryTags,
    excludeTags,
    tagType,
    favoritesOnly,
    tags,
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
    setTagState((current) => {
      const next = nextChipState(current[id] ?? 'off')
      const copy = { ...current }
      if (next === 'off') delete copy[id]
      else copy[id] = next
      return copy
    })
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
          onClick={() => setFavoritesOnly((value) => !value)}
        >
          <StarIcon />
        </button>
        <button
          className={filtersOpen ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
          type="button"
          aria-pressed={filtersOpen}
          title={activeFilterCount ? `Filters (${activeFilterCount})` : 'Filters'}
          aria-label={activeFilterCount ? `Filters, ${activeFilterCount} active` : 'Filters'}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <FilterIcon />
          {activeFilterCount ? <span className="icon-btn-badge">{activeFilterCount}</span> : null}
        </button>
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
        <FilterShelf
          filters={filters}
          prefixState={prefixState}
          tagState={tagState}
          prefixType={prefixType}
          tagType={tagType}
          tagQuery={tagQuery}
          creatorInput={creatorInput}
          favoriteTags={favoriteTags}
          onTogglePrefix={togglePrefix}
          onToggleTag={toggleTag}
          onPrefixType={setPrefixType}
          onTagType={setTagType}
          onTagQuery={setTagQuery}
          onCreatorInput={setCreatorInput}
        />
      ) : null}

      {error ? <p className="catalog-status error-text">{error}</p> : null}
      {busy && !data ? <p className="catalog-status muted">Loading catalog…</p> : null}

      {data && data.games.length === 0 ? (
        <div className="empty-state">No games match these filters.</div>
      ) : (
        <div className="catalog-grid">
          {data?.games.map((game) => (
            <GameCard
              key={game.threadId}
              game={{ ...game, rarity: rarityById.get(game.threadId) }}
              subscribed={followedIds.has(game.threadId)}
              favoriteTags={favoriteTags}
              onToggle={() => void onToggleFollow(game)}
              onOpen={() => onOpen(game)}
              onPlay={
                libraryByThread.get(game.threadId)?.isInstalled
                  ? () => void playThread(game)
                  : undefined
              }
              library={libraryByThread.get(game.threadId)}
              playing={Boolean(sessionForThread(game.threadId))}
              prefixCatalog={filters.prefixes}
            />
          ))}
        </div>
      )}
    </div>
  )
}
