import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
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
import LazyMount from '../components/LazyMount'
import SelectMenu from '../components/SelectMenu'
import FooterPortal from '../components/FooterPortal'
import CatalogPageTurn, {
  type CatalogPageTurnState,
  type PageTurnDirection
} from '../components/CatalogPageTurn'
import { selectTagsForQuery } from '../lib/favorites'
import { ClearIcon, FilterIcon, HateIcon, PagerIcon, RefreshIcon, StarIcon } from '../components/ToolbarIcons'
import ToolbarPortal from '../components/ToolbarPortal'
import ToolbarSearch from '../components/ToolbarSearch'
import { notifyCaught, notifyError } from '../components/ErrorNotifications'
import { useLibraryByThread, usePlaySessions } from '../lib/library'

type CatalogViewProps = {
  followedIds: Set<number>
  followedPlayById: Map<number, { lastPlayedVersion: string; playedVersions: VersionPlayStat[] }>
  rarityById: Map<number, GameRarity>
  favoriteTags: FavoriteTag[]
  hatedTags: HatedTag[]
  rosterIds: Set<number>
  onToggleFollow: (game: CatalogGame) => Promise<void>
  onToggleRoster: (game: CatalogGame) => Promise<void>
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

/** Enough tiles to fill a wide catalog viewport; the rest wait until they scroll near. */
const EAGER_CARDS = 40

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
  rosterIds,
  onToggleFollow,
  onToggleRoster,
  onOpen,
  onSessionExpired
}: CatalogViewProps): JSX.Element {
  const libraryByThread = useLibraryByThread()
  const sessions = usePlaySessions()
  const [page, setPage] = useState(1)
  const [reloadToken, setReloadToken] = useState(0)
  const [data, setData] = useState<CatalogPageData | null>(null)
  const [displayPage, setDisplayPage] = useState(1)
  const [displayGames, setDisplayGames] = useState<CatalogGame[] | null>(null)
  const [incomingGames, setIncomingGames] = useState<CatalogGame[] | null>(null)
  const [busy, setBusy] = useState(true)
  const [turn, setTurn] = useState<CatalogPageTurnState>(null)
  const pendingRevertRef = useRef<number | null>(null)
  const turnLockRef = useRef(false)
  const turnRef = useRef<CatalogPageTurnState>(null)
  turnRef.current = turn
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
    try {
      await window.api.library.playLatest(game.threadId, game.engine)
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not start the game.'
      if (text.includes('Not logged in')) {
        await onSessionExpired()
        throw err
      }
      notifyCaught(err, 'Could not start the game.')
      throw err instanceof Error ? err : new Error(text)
    }
  }

  async function stopThread(threadId: number): Promise<void> {
    try {
      const active = sessions.filter((session) => session.threadId === threadId)
      for (const session of active) {
        await window.api.library.stop(session.fileId)
      }
    } catch (err) {
      notifyCaught(err, 'Could not stop the game.')
    }
  }

  useEffect(() => {
    turnLockRef.current = false
    setTurn(null)
    setIncomingGames(null)
    setPage(1)
    setDisplayPage(1)
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
        if (cancelled) return
        setData(result)
        const currentTurn = turnRef.current
        if (currentTurn?.phase === 'preparing') {
          setIncomingGames(result.games)
          setTurn({ ...currentTurn, phase: 'animating' })
        } else {
          setDisplayGames(result.games)
          setDisplayPage(page)
          setIncomingGames(null)
        }
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not load the catalog.'
        // Capture direction before clearing; `page` is the failed target.
        setTurn((current) => {
          if (current) {
            pendingRevertRef.current = current.fromPage
          }
          return null
        })
        turnLockRef.current = false
        setIncomingGames(null)
        if (message.includes('Not logged in')) {
          await onSessionExpired()
          return
        }
        notifyError(message, {
          label: 'Retry',
          onClick: () => setReloadToken((value) => value + 1)
        })
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

  useEffect(() => {
    const revertTo = pendingRevertRef.current
    if (revertTo == null) return
    pendingRevertRef.current = null
    if (revertTo !== page) setPage(revertTo)
  }, [turn, page])

  const incomingGamesRef = useRef<CatalogGame[] | null>(null)
  incomingGamesRef.current = incomingGames

  const finishTurn = useCallback((): void => {
    const settled = turnRef.current
    const incoming = incomingGamesRef.current
    if (incoming) setDisplayGames(incoming)
    if (settled) setDisplayPage(settled.toPage)
    setIncomingGames(null)
    turnLockRef.current = false
    setTurn(null)
  }, [])

  function goToPage(target: number, direction: PageTurnDirection): void {
    if (turnLockRef.current || turn || busy || !data) return
    if (target < 1 || target > data.totalPages || target === displayPage) return
    turnLockRef.current = true
    setTurn({
      direction,
      phase: 'preparing',
      fromPage: displayPage,
      toPage: target
    })
    setPage(target)
  }

  function goPrev(): void {
    goToPage(displayPage - 1, 'prev')
  }

  function goNext(): void {
    goToPage(displayPage + 1, 'next')
  }

  function goFirst(): void {
    goToPage(1, 'prev')
  }

  function goLast(): void {
    if (!data) return
    goToPage(data.totalPages, 'next')
  }

  function renderGameGrid(games: CatalogGame[], pageNum: number, eagerCovers = false): JSX.Element {
    return (
      <div className="catalog-grid">
        {games.map((game, index) => {
          const play = followedPlayById.get(game.threadId)
          const eager = index < EAGER_CARDS
          return (
            <LazyMount key={game.threadId} eager={eager}>
              <GameCard
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
                coverRetryKey={`${pageNum}-${reloadToken}`}
                coverEager={eagerCovers || eager}
                inRoster={rosterIds.has(game.threadId)}
                onToggleRoster={() => onToggleRoster(game)}
              />
            </LazyMount>
          )
        })}
      </div>
    )
  }

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
        <ToolbarSearch
          value={searchInput}
          onChange={setSearchInput}
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
            disabled={busy || Boolean(turn)}
            title="Refresh catalog"
            aria-label="Refresh catalog"
            onClick={() => {
              if (turn) return
              setReloadToken((value) => value + 1)
            }}
          >
            <RefreshIcon spinning={busy && Boolean(data)} />
          </button>
        </div>
      </ToolbarPortal>
      <FooterPortal>
        <div className="footer-cluster">
          <div className="pager">
            <button
              className="ghost-btn icon-btn"
              type="button"
              disabled={Boolean(turn) || busy || page <= 1}
              title="First page"
              aria-label="First page"
              onClick={goFirst}
            >
              <PagerIcon kind="first" />
            </button>
            <button
              className="ghost-btn icon-btn"
              type="button"
              disabled={Boolean(turn) || busy || page <= 1}
              title="Previous page"
              aria-label="Previous page"
              onClick={goPrev}
            >
              <PagerIcon kind="prev" />
            </button>
            <span className="muted pager-label">
              {page}/{data?.totalPages ?? '…'}
            </span>
            <button
              className="ghost-btn icon-btn"
              type="button"
              disabled={Boolean(turn) || busy || !data || page >= data.totalPages}
              title="Next page"
              aria-label="Next page"
              onClick={goNext}
            >
              <PagerIcon kind="next" />
            </button>
            <button
              className="ghost-btn icon-btn"
              type="button"
              disabled={Boolean(turn) || busy || !data || page >= data.totalPages}
              title="Last page"
              aria-label="Last page"
              onClick={goLast}
            >
              <PagerIcon kind="last" />
            </button>
          </div>
          <span className="muted pager-label">
            {data ? `${data.totalGames.toLocaleString()} titles` : 'Loading…'}
          </span>
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

      {busy && !data ? <p className="catalog-status muted">Loading catalog…</p> : null}

      {displayGames && displayGames.length === 0 && !turn ? (
        <div className="empty-state">No games match these filters.</div>
      ) : displayGames || incomingGames ? (
        <CatalogPageTurn
          totalPages={data?.totalPages ?? 1}
          disabled={busy && !turn}
          turn={turn}
          currentKey={displayPage}
          incomingKey={turn?.toPage ?? page}
          incoming={
            incomingGames ? (
              incomingGames.length === 0 ? (
                <div className="empty-state">No games match these filters.</div>
              ) : (
                renderGameGrid(incomingGames, turn?.toPage ?? page, true)
              )
            ) : null
          }
          onPrev={goPrev}
          onNext={goNext}
          onTurnAnimationEnd={finishTurn}
        >
          {!displayGames || displayGames.length === 0 ? (
            <div className="empty-state">No games match these filters.</div>
          ) : (
            renderGameGrid(displayGames, displayPage)
          )}
        </CatalogPageTurn>
      ) : null}
    </div>
  )
}
