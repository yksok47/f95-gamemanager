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
import { decodeHtmlEntities } from '@shared/engines'
import FilterChip, { nextChipState, type FilterChipState } from '../components/FilterChip'
import GameCard from '../components/GameCard'
import ToolbarPortal from '../components/ToolbarPortal'
import { sortFavoriteTags } from '../lib/favorites'
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
  const activeFilterCount =
    prefixes.length + excludePrefixes.length + tags.length + excludeTags.length + (creator ? 1 : 0)

  useEffect(() => {
    setPage(1)
  }, [sort, search, creator, prefixes, excludePrefixes, tags, excludeTags, tagType, prefixType])

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
          tags: tags.length ? tags : undefined,
          excludeTags: excludeTags.length ? excludeTags : undefined,
          tagType
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
    tags,
    excludeTags,
    tagType,
    onSessionExpired
  ])

  const statusOptions = filters.prefixes.filter((prefix) => prefix.group === 'status')
  const engineOptions = filters.prefixes.filter((prefix) => prefix.group === 'engine')
  const favoriteTagIds = useMemo(() => new Set(favoriteTags.map((tag) => tag.id)), [favoriteTags])
  const sortedFavorites = useMemo(() => sortFavoriteTags(favoriteTags), [favoriteTags])
  const visibleTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase()
    const list = q
      ? filters.tags.filter((tag) => tag.name.toLowerCase().includes(q) && !favoriteTagIds.has(tag.id))
      : filters.tags.filter((tag) => !tagState[tag.id] && !favoriteTagIds.has(tag.id))
    return list.slice(0, 80)
  }, [filters.tags, tagQuery, tagState, favoriteTagIds])

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
        <select
          className="toolbar-select"
          value={sort}
          onChange={(event) => setSort(event.target.value as CatalogSort)}
        >
          {SORTS.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          className={filtersOpen ? 'ghost-btn nav-btn-active' : 'ghost-btn'}
          type="button"
          onClick={() => setFiltersOpen((open) => !open)}
        >
          Filters{activeFilterCount ? ` (${activeFilterCount})` : ''}
        </button>
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
        <button className="ghost-btn" disabled={busy} onClick={() => setReloadToken((value) => value + 1)}>
          Refresh
        </button>
      </ToolbarPortal>

      {filtersOpen ? (
        <section className="filter-shelf">
          <p className="muted filter-hint">Click a chip to include it, click again to exclude, again to clear.</p>
          <div className="filter-row">
            <span className="filter-label">Creator</span>
            <input
              className="tag-search"
              value={creatorInput}
              onChange={(event) => setCreatorInput(event.target.value)}
              placeholder="Filter by creator"
            />
          </div>
          <div className="filter-row">
            <span className="filter-label">Status</span>
            <div className="filter-chips">
              {statusOptions.map((prefix) => (
                <FilterChip
                  key={prefix.id}
                  label={decodeHtmlEntities(prefix.name)}
                  state={prefixState[prefix.id] ?? 'off'}
                  onClick={() => togglePrefix(prefix.id)}
                />
              ))}
            </div>
          </div>
          <div className="filter-row">
            <span className="filter-label">Engine</span>
            <div className="filter-chips">
              {engineOptions.map((prefix) => (
                <FilterChip
                  key={prefix.id}
                  label={decodeHtmlEntities(prefix.name)}
                  state={prefixState[prefix.id] ?? 'off'}
                  onClick={() => togglePrefix(prefix.id)}
                />
              ))}
            </div>
          </div>
          <div className="filter-row">
            <span className="filter-label">Match</span>
            <label className="mode-toggle">
              Status / engine
              <select value={prefixType} onChange={(event) => setPrefixType(event.target.value as MatchMode)}>
                <option value="and">AND</option>
                <option value="or">OR</option>
              </select>
            </label>
          </div>
          {sortedFavorites.length ? (
            <div className="filter-row">
              <span className="filter-label">Favorites</span>
              <div className="filter-chips">
                {sortedFavorites.map((tag) => (
                  <FilterChip
                    key={tag.id}
                    label={tag.name}
                    state={tagState[tag.id] ?? 'off'}
                    tone={tag.tier}
                    onClick={() => toggleTag(tag.id)}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div className="filter-row">
            <span className="filter-label">Tags</span>
            <label className="mode-toggle">
              Match
              <select value={tagType} onChange={(event) => setTagType(event.target.value as MatchMode)}>
                <option value="or">OR</option>
                <option value="and">AND</option>
              </select>
            </label>
            <input
              className="tag-search"
              value={tagQuery}
              onChange={(event) => setTagQuery(event.target.value)}
              placeholder="Find a tag"
            />
          </div>
          {filters.tags.some((tag) => tagState[tag.id] && !favoriteTagIds.has(tag.id)) ? (
            <div className="filter-chips">
              {filters.tags
                .filter((tag) => tagState[tag.id] && !favoriteTagIds.has(tag.id))
                .map((tag) => (
                  <FilterChip
                    key={tag.id}
                    label={tag.name}
                    state={tagState[tag.id]}
                    onClick={() => toggleTag(tag.id)}
                  />
                ))}
            </div>
          ) : null}
          <div className="filter-chips tag-results">
            {visibleTags.map((tag) => (
              <FilterChip
                key={tag.id}
                label={tag.name}
                state={tagState[tag.id] ?? 'off'}
                onClick={() => toggleTag(tag.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {error ? <p className="catalog-status error-text">{error}</p> : null}
      {busy && !data ? <p className="catalog-status muted">Loading catalog…</p> : null}
      {data ? (
        <p className="catalog-status muted">{data.totalGames.toLocaleString()} titles</p>
      ) : null}

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
