import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  CatalogGame,
  CatalogPage as CatalogPageData,
  CatalogSort,
  FavoriteTag,
  HatedTag,
  GameRarity,
  VersionPlayStat
} from '@shared/types'
import { DEFAULT_CATALOG_PAGE_SIZE, TAG_QUERY_LIMIT, type CatalogPageSize } from '@shared/types'
import {
  favoriteToolbarTitle,
  hatedToolbarTitle,
  toolbarTriStateClass,
  triStateMouseProps
} from '../components/FilterChip'
import { FilterOverlay, FilterToolbarSplit } from '../components/AdvancedFilterUi'
import FilterShelf from '../components/FilterShelf'
import GameCard from '../components/GameCard'
import LazyMount from '../components/LazyMount'
import SelectMenu from '../components/SelectMenu'
import FooterPortal from '../components/FooterPortal'
import CatalogPageTurn, {
  type CatalogPageTurnState,
  type PageTurnDirection
} from '../components/CatalogPageTurn'
import { useAdvancedFilters } from '../lib/use-advanced-filters'
import { PagerIcon, RefreshIcon, ThumbDownIcon, ThumbUpIcon } from '../components/ToolbarIcons'
import ToolbarPortal from '../components/ToolbarPortal'
import ToolbarSearch from '../components/ToolbarSearch'
import { notifyCaught, notifyError } from '../components/ErrorNotifications'
import { useLibraryByThread, usePlaySessions } from '../lib/library'

type CatalogViewProps = {
  followedIds: Set<number>
  archivedIds: Set<number>
  followedPlayById: Map<number, { lastPlayedVersion: string; playedVersions: VersionPlayStat[] }>
  rarityById: Map<number, GameRarity>
  favoriteTags: FavoriteTag[]
  hatedTags: HatedTag[]
  catalogPageSize?: CatalogPageSize
  rosterIds: Set<number>
  onToggleFollow: (game: CatalogGame) => Promise<void>
  onToggleRoster: (game: CatalogGame) => Promise<void>
  onOpen: (game: CatalogGame) => void
  onSessionExpired: () => Promise<void>
  hiddenThreadIds?: ReadonlySet<number>
}

const SORTS: Array<{ value: CatalogSort; label: string }> = [
  { value: 'date', label: 'Updated' },
  { value: 'likes', label: 'Likes' },
  { value: 'views', label: 'Views' },
  { value: 'rating', label: 'Rating' },
  { value: 'title', label: 'Title' }
]

/** First viewport of tiles; the rest wait until they scroll near. */
const EAGER_CARDS = 12

export default function CatalogPage({
  followedIds,
  archivedIds,
  followedPlayById,
  rarityById,
  favoriteTags,
  hatedTags,
  catalogPageSize = DEFAULT_CATALOG_PAGE_SIZE,
  rosterIds,
  onToggleFollow,
  onToggleRoster,
  onOpen,
  onSessionExpired,
  hiddenThreadIds
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
  const advanced = useAdvancedFilters(favoriteTags, hatedTags, TAG_QUERY_LIMIT)
  const {
    filters,
    filtersOpen,
    prefixState,
    tagState,
    tagType,
    tagQuery,
    creatorInput,
    creator,
    favoritesFilter,
    hatedFilter,
    lockedFavoriteIds,
    lockedHatedIds,
    includePrefixes: prefixes,
    excludePrefixes,
    includeTags: includedTags,
    excludeTags: excludedTags,
    queryTagType,
    activeFilterCount,
    togglePrefix,
    toggleTag,
    setTagType,
    setTagQuery,
    setCreatorInput,
    clearFilters,
    applyQuickFilter,
    cycleFavoritesFilter,
    cycleHatedFilter,
    closeFilters
  } = advanced
  const includeLimitReached = includedTags.length >= TAG_QUERY_LIMIT
  const excludeLimitReached = excludedTags.length >= TAG_QUERY_LIMIT
  const [sort, setSort] = useState<CatalogSort>('date')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 400)
    return () => window.clearTimeout(timer)
  }, [searchInput])

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
    favoritesFilter,
    hatedFilter,
    catalogPageSize
  ])

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      setBusy(true)
      try {
        const result = await window.api.catalog.list({
          page,
          rows: catalogPageSize,
          sort,
          search: search || undefined,
          creator: creator || undefined,
          prefixes: prefixes.length ? prefixes : undefined,
          excludePrefixes: excludePrefixes.length ? excludePrefixes : undefined,
          prefixType: 'and',
          tags: includedTags.length ? includedTags.slice(0, TAG_QUERY_LIMIT) : undefined,
          excludeTags: excludedTags.length ? excludedTags.slice(0, TAG_QUERY_LIMIT) : undefined,
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
    favoritesFilter,
    hatedFilter,
    catalogPageSize,
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

  const visibleDisplayGames = useMemo(() => {
    if (!displayGames || !hiddenThreadIds?.size) return displayGames
    return displayGames.filter((game) => !hiddenThreadIds.has(game.threadId))
  }, [displayGames, hiddenThreadIds])

  const visibleIncomingGames = useMemo(() => {
    if (!incomingGames || !hiddenThreadIds?.size) return incomingGames
    return incomingGames.filter((game) => !hiddenThreadIds.has(game.threadId))
  }, [incomingGames, hiddenThreadIds])

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
                archived={archivedIds.has(game.threadId)}
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

  return (
    <div className="catalog-page">
      <ToolbarPortal>
        <ToolbarSearch
          value={searchInput}
          onChange={setSearchInput}
          placeholder="Search games"
          addon={
            <FilterToolbarSplit
              open={filtersOpen}
              count={activeFilterCount}
              onToggle={advanced.toggleFilters}
              onClear={clearFilters}
            />
          }
        />
        <SelectMenu
          value={sort}
          options={SORTS}
          ariaLabel="Sort catalog"
          onChange={setSort}
        />
        <button
          className={toolbarTriStateClass(favoritesFilter)}
          type="button"
          aria-pressed={favoritesFilter === 'include'}
          disabled={!favoriteTags.length}
          title={favoriteToolbarTitle(favoritesFilter, favoriteTags.length > 0)}
          aria-label="Filter by favorite tags"
          {...triStateMouseProps(cycleFavoritesFilter)}
        >
          <ThumbUpIcon />
        </button>
        <button
          className={toolbarTriStateClass(hatedFilter)}
          type="button"
          aria-pressed={hatedFilter === 'include'}
          disabled={!hatedTags.length}
          title={hatedToolbarTitle(hatedFilter, hatedTags.length > 0)}
          aria-label="Filter by hated tags"
          {...triStateMouseProps(cycleHatedFilter)}
        >
          <ThumbDownIcon />
        </button>
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

      <FilterOverlay open={filtersOpen} onClose={closeFilters}>
        <FilterShelf
          filters={filters}
          prefixState={prefixState}
          tagState={tagState}
          tagType={tagType}
          tagQuery={tagQuery}
          creatorInput={creatorInput}
          favoriteTags={favoriteTags}
          hatedTags={hatedTags}
          favoriteFilter={favoritesFilter}
          hatedFilter={hatedFilter}
          lockedFavoriteIds={lockedFavoriteIds}
          lockedHatedIds={lockedHatedIds}
          includeLimitReached={includeLimitReached}
          excludeLimitReached={excludeLimitReached}
          onTogglePrefix={togglePrefix}
          onToggleTag={toggleTag}
          onTagType={setTagType}
          onTagQuery={setTagQuery}
          onCreatorInput={setCreatorInput}
          onApplyQuickFilter={applyQuickFilter}
        />
      </FilterOverlay>

      {busy && !data ? <p className="catalog-status muted">Loading catalog…</p> : null}

      {visibleDisplayGames && visibleDisplayGames.length === 0 && !turn ? (
        <div className="empty-state">No games match these filters.</div>
      ) : visibleDisplayGames || visibleIncomingGames ? (
        <CatalogPageTurn
          totalPages={data?.totalPages ?? 1}
          disabled={busy && !turn}
          turn={turn}
          currentKey={displayPage}
          incomingKey={turn?.toPage ?? page}
          incoming={
            visibleIncomingGames ? (
              visibleIncomingGames.length === 0 ? (
                <div className="empty-state">No games match these filters.</div>
              ) : (
                renderGameGrid(visibleIncomingGames, turn?.toPage ?? page, true)
              )
            ) : null
          }
          onPrev={goPrev}
          onNext={goNext}
          onTurnAnimationEnd={finishTurn}
        >
          {!visibleDisplayGames || visibleDisplayGames.length === 0 ? (
            <div className="empty-state">No games match these filters.</div>
          ) : (
            renderGameGrid(visibleDisplayGames, displayPage)
          )}
        </CatalogPageTurn>
      ) : null}
    </div>
  )
}
