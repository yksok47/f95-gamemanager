import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type {
  CatalogGame,
  FavoriteTag,
  HatedTag,
  GameRarity,
  RosterGame,
  Subscription
} from '@shared/types'
import { FilterToolbarSplit, LocalAdvancedFilters } from '../components/AdvancedFilterUi'
import GameCard from '../components/GameCard'
import LazyMount from '../components/LazyMount'
import FooterPortal from '../components/FooterPortal'
import SelectMenu from '../components/SelectMenu'
import { CustomOrderIcon, ThumbDownIcon, ThumbUpIcon } from '../components/ToolbarIcons'
import ToolbarPortal from '../components/ToolbarPortal'
import ToolbarSearch from '../components/ToolbarSearch'
import { notifyCaught } from '../components/ErrorNotifications'
import {
  favoriteToolbarTitle,
  hatedToolbarTitle,
  toolbarTriStateClass,
  triStateMouseProps
} from '../components/FilterChip'
import { toCatalogGame } from '../lib/catalog-game'
import { useAdvancedFilters } from '../lib/use-advanced-filters'
import { useLibraryByThread, usePlaySessions } from '../lib/library'

type RosterSort = 'added' | 'title' | 'date' | 'rating' | 'likes' | 'views'

const SORTS: Array<{ value: RosterSort; label: string }> = [
  { value: 'added', label: 'Added' },
  { value: 'date', label: 'Updated' },
  { value: 'title', label: 'Name' },
  { value: 'rating', label: 'Rating' },
  { value: 'likes', label: 'Likes' },
  { value: 'views', label: 'Views' }
]

const EAGER_CARDS = 12
const CUSTOM_ORDER_KEY = 'roster-custom-order'
const DRAG_THRESHOLD_PX = 8

function readCustomOrder(): boolean {
  try {
    return window.localStorage.getItem(CUSTOM_ORDER_KEY) !== '0'
  } catch {
    return true
  }
}

function applyIdOrder<T extends { threadId: number }>(items: T[], ids: number[] | null): T[] {
  if (!ids) return items
  const byId = new Map(items.map((item) => [item.threadId, item]))
  const next: T[] = []
  const seen = new Set<number>()
  for (const id of ids) {
    const item = byId.get(id)
    if (!item) continue
    next.push(item)
    seen.add(id)
  }
  for (const item of items) {
    if (!seen.has(item.threadId)) next.push(item)
  }
  return next
}

function mergeVisibleOrder(fullIds: number[], visibleIds: number[], nextVisible: number[]): number[] {
  const visible = new Set(visibleIds)
  const queue = nextVisible.filter((id) => visible.has(id))
  return fullIds.map((id) => (visible.has(id) ? (queue.shift() as number) : id))
}

function moveIdToIndex(ids: number[], id: number, toIndex: number): number[] {
  const from = ids.indexOf(id)
  if (from < 0 || from === toIndex) return ids
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, moved)
  return next
}

/** Layout box without FLIP translations, so hit-testing stays stable mid-animation. */
function layoutRect(el: HTMLElement): DOMRect {
  const visual = el.getBoundingClientRect()
  const transform = getComputedStyle(el).transform
  if (!transform || transform === 'none') return visual
  const matrix = new DOMMatrix(transform)
  return new DOMRect(visual.left - matrix.e, visual.top - matrix.f, visual.width, visual.height)
}

function overlapArea(
  left: number,
  top: number,
  right: number,
  bottom: number,
  rect: DOMRect
): number {
  const width = Math.min(right, rect.right) - Math.max(left, rect.left)
  const height = Math.min(bottom, rect.bottom) - Math.max(top, rect.top)
  if (width <= 0 || height <= 0) return 0
  return width * height
}

function targetSlotIndex(
  slots: Map<number, HTMLElement>,
  ids: number[],
  dragId: number,
  lift: { x: number; y: number; width: number; height: number }
): number {
  const current = ids.indexOf(dragId)
  if (current < 0) return 0
  const left = lift.x
  const top = lift.y
  const right = lift.x + lift.width
  const bottom = lift.y + lift.height
  const holeEl = slots.get(dragId)
  let best = current
  let bestArea = holeEl ? overlapArea(left, top, right, bottom, layoutRect(holeEl)) : 0
  for (let index = 0; index < ids.length; index += 1) {
    if (ids[index] === dragId) continue
    const el = slots.get(ids[index])
    if (!el) continue
    const area = overlapArea(left, top, right, bottom, layoutRect(el))
    if (area > bestArea) {
      bestArea = area
      best = index
    }
  }
  return best
}

type LiftedTile = {
  id: number
  x: number
  y: number
  width: number
  height: number
}

type RosterPageProps = {
  games: RosterGame[]
  subscriptions: Subscription[]
  favoriteTags: FavoriteTag[]
  hatedTags: HatedTag[]
  rarityById: Map<number, GameRarity>
  onToggleFollow: (game: CatalogGame) => Promise<void>
  onToggleRoster: (game: CatalogGame) => Promise<void>
  onOpen: (game: RosterGame) => void
  onSessionExpired: () => Promise<void>
}

function matchesQuery(game: RosterGame, query: string): boolean {
  if (!query) return true
  const haystack = `${game.title} ${game.creator} ${game.version}`.toLowerCase()
  return haystack.includes(query)
}

function compareGames(a: RosterGame, b: RosterGame, sort: RosterSort, descending: boolean): number {
  let result = 0
  if (sort === 'title') {
    result = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    if (!result) result = a.creator.localeCompare(b.creator, undefined, { sensitivity: 'base' })
  } else if (sort === 'rating') {
    result = (a.rating || 0) - (b.rating || 0)
  } else if (sort === 'likes') {
    result = (a.likes || 0) - (b.likes || 0)
  } else if (sort === 'views') {
    result = (a.views || 0) - (b.views || 0)
  } else if (sort === 'date') {
    result = (a.timestamp || 0) - (b.timestamp || 0)
  } else {
    result = a.addedAt - b.addedAt
  }
  if (!result) result = b.addedAt - a.addedAt
  return descending ? -result : result
}

function overlayRosterGame(entry: RosterGame, followed?: Subscription): RosterGame & {
  lastPlayedVersion?: string
  lastPlayedAt?: number
  playtimeMs?: number
  playedVersions?: Subscription['playedVersions']
  rarity?: GameRarity
} {
  if (!followed) return entry
  return {
    ...entry,
    title: followed.title || entry.title,
    creator: followed.creator || entry.creator,
    version: followed.version || entry.version,
    coverUrl: followed.coverUrl || entry.coverUrl,
    rating: followed.rating || entry.rating,
    likes: followed.likes || entry.likes,
    views: followed.views || entry.views,
    updatedAt: followed.updatedAt || entry.updatedAt,
    timestamp: followed.timestamp || entry.timestamp,
    prefixes: followed.prefixes?.length ? followed.prefixes : entry.prefixes,
    tags: followed.tags?.length ? followed.tags : entry.tags,
    screens: followed.screens?.length ? followed.screens : entry.screens,
    engine: followed.engine || entry.engine,
    lastPlayedVersion: followed.lastPlayedVersion,
    lastPlayedAt: followed.lastPlayedAt,
    playtimeMs: followed.playtimeMs,
    playedVersions: followed.playedVersions,
    rarity: followed.rarity
  }
}

export default function RosterPage({
  games,
  subscriptions,
  favoriteTags,
  hatedTags,
  rarityById,
  onToggleFollow,
  onToggleRoster,
  onOpen,
  onSessionExpired
}: RosterPageProps): JSX.Element {
  const libraryByThread = useLibraryByThread()
  const sessions = usePlaySessions()
  const advanced = useAdvancedFilters(favoriteTags, hatedTags)
  const prefixCatalog = advanced.filters.prefixes
  const [query, setQuery] = useState('')
  const [customOrder, setCustomOrder] = useState(readCustomOrder)
  const [sort, setSort] = useState<RosterSort>('added')
  const [descending, setDescending] = useState(true)
  const [previewIds, setPreviewIds] = useState<number[] | null>(null)
  const [lifted, setLifted] = useState<LiftedTile | null>(null)
  const slotRefs = useRef(new Map<number, HTMLElement>())
  const previewIdsRef = useRef<number[] | null>(null)
  const liftedRef = useRef<LiftedTile | null>(null)
  const flipFrom = useRef<Map<number, DOMRect> | null>(null)
  const dragMoveFrame = useRef(0)
  const draggingRef = useRef(false)
  const orderedGames = useMemo(() => applyIdOrder(games, previewIds), [games, previewIds])
  useEffect(() => {
    if (draggingRef.current || !previewIds) return
    if (previewIds.length !== games.length) return
    if (!previewIds.every((id, index) => games[index]?.threadId === id)) return
    previewIdsRef.current = null
    setPreviewIds(null)
  }, [games, previewIds])
  useEffect(() => {
    return () => document.body.classList.remove('is-roster-dragging')
  }, [])
  useEffect(() => {
    liftedRef.current = lifted
  }, [lifted])
  useLayoutEffect(() => {
    const first = flipFrom.current
    if (!first) return
    flipFrom.current = null
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const skipId = liftedRef.current?.id
    for (const [id, el] of slotRefs.current) {
      if (id === skipId) continue
      const prev = first.get(id)
      if (!prev) continue
      for (const animation of el.getAnimations()) animation.cancel()
      const next = el.getBoundingClientRect()
      const dx = prev.left - next.left
      const dy = prev.top - next.top
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
        { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }
      )
    }
  }, [previewIds])
  const followedById = useMemo(
    () => new Map(subscriptions.map((game) => [game.threadId, game])),
    [subscriptions]
  )
  const archivedIds = useMemo(
    () => new Set(subscriptions.filter((game) => game.archived).map((game) => game.threadId)),
    [subscriptions]
  )
  const presented = useMemo(
    () => orderedGames.map((game) => overlayRosterGame(game, followedById.get(game.threadId))),
    [orderedGames, followedById]
  )
  const needle = query.trim().toLowerCase()
  const playingByThread = useMemo(() => {
    const ids = new Set<number>()
    for (const session of sessions) ids.add(session.threadId)
    return ids
  }, [sessions])
  const visible = useMemo(() => {
    const filtered = presented
      .filter((game) => matchesQuery(game, needle))
      .filter((game) => advanced.matches(game))
    if (customOrder) return filtered
    return filtered.sort((a, b) => compareGames(a, b, sort, descending))
  }, [presented, needle, sort, descending, advanced.matches, customOrder])

  function storeCustomOrder(next: boolean): void {
    setCustomOrder(next)
    try {
      window.localStorage.setItem(CUSTOM_ORDER_KEY, next ? '1' : '0')
    } catch {
      // Preference stays in memory for this session.
    }
  }

  function bindSlot(threadId: number, node: HTMLDivElement | null): void {
    if (node) slotRefs.current.set(threadId, node)
    else slotRefs.current.delete(threadId)
  }

  function writeLiftedPosition(id: number, x: number, y: number): void {
    const tile = slotRefs.current.get(id)?.firstElementChild as HTMLElement | undefined
    if (!tile) return
    tile.style.left = `${x}px`
    tile.style.top = `${y}px`
  }

  function commitPreview(next: number[]): void {
    const first = new Map<number, DOMRect>()
    for (const [id, el] of slotRefs.current) first.set(id, el.getBoundingClientRect())
    flipFrom.current = first
    previewIdsRef.current = next
    setPreviewIds(next)
  }

  function onTilePointerDown(event: ReactPointerEvent<HTMLDivElement>, threadId: number): void {
    if (!customOrder || event.button !== 0) return
    const target = event.target
    if (
      target instanceof Element &&
      target.closest(
        'button, a, input, textarea, select, label, .card-tile-action, .follow-btn, .play-badge'
      )
    ) {
      return
    }
    const slot = slotRefs.current.get(threadId)
    if (!slot) return
    const rect = slot.getBoundingClientRect()
    const session = {
      pointerId: event.pointerId,
      id: threadId,
      grabX: event.clientX - rect.left,
      grabY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      startX: event.clientX,
      startY: event.clientY,
      lifted: false,
      pointerX: event.clientX,
      pointerY: event.clientY,
      visibleIds: visible.map((game) => game.threadId),
      fullIds: orderedGames.map((game) => game.threadId)
    }

    const onMove = (moveEvent: PointerEvent): void => {
      if (moveEvent.pointerId !== session.pointerId) return
      if (!session.lifted) {
        const dx = moveEvent.clientX - session.startX
        const dy = moveEvent.clientY - session.startY
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return
        session.lifted = true
        draggingRef.current = true
        previewIdsRef.current = session.visibleIds
        setPreviewIds(session.visibleIds)
        const nextLift = {
          id: threadId,
          x: moveEvent.clientX - session.grabX,
          y: moveEvent.clientY - session.grabY,
          width: session.width,
          height: session.height
        }
        liftedRef.current = nextLift
        setLifted(nextLift)
        document.body.classList.add('is-roster-dragging')
      }
      moveEvent.preventDefault()
      session.pointerX = moveEvent.clientX
      session.pointerY = moveEvent.clientY
      const x = moveEvent.clientX - session.grabX
      const y = moveEvent.clientY - session.grabY
      if (liftedRef.current?.id === threadId) {
        liftedRef.current = { ...liftedRef.current, x, y }
      }
      writeLiftedPosition(threadId, x, y)
      if (dragMoveFrame.current) return
      dragMoveFrame.current = requestAnimationFrame(() => {
        dragMoveFrame.current = 0
        const ids = previewIdsRef.current
        if (!ids) return
        const nextIndex = targetSlotIndex(slotRefs.current, ids, threadId, {
          x: session.pointerX - session.grabX,
          y: session.pointerY - session.grabY,
          width: session.width,
          height: session.height
        })
        if (ids[nextIndex] === threadId) return
        commitPreview(moveIdToIndex(ids, threadId, nextIndex))
      })
    }

    const onUp = async (upEvent: PointerEvent): Promise<void> => {
      if (upEvent.pointerId !== session.pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (dragMoveFrame.current) {
        cancelAnimationFrame(dragMoveFrame.current)
        dragMoveFrame.current = 0
      }
      const ids = previewIdsRef.current
      if (session.lifted && ids) {
        const nextIndex = targetSlotIndex(slotRefs.current, ids, threadId, {
          x: session.pointerX - session.grabX,
          y: session.pointerY - session.grabY,
          width: session.width,
          height: session.height
        })
        if (ids[nextIndex] !== threadId) {
          previewIdsRef.current = moveIdToIndex(ids, threadId, nextIndex)
        }
      }
      document.body.classList.remove('is-roster-dragging')
      draggingRef.current = false
      liftedRef.current = null
      setLifted(null)
      if (!session.lifted) return
      const swallowClick = (clickEvent: MouseEvent): void => {
        clickEvent.preventDefault()
        clickEvent.stopPropagation()
        window.removeEventListener('click', swallowClick, true)
      }
      window.addEventListener('click', swallowClick, true)
      window.setTimeout(() => window.removeEventListener('click', swallowClick, true), 400)
      const nextVisible = previewIdsRef.current
      if (!nextVisible) {
        setPreviewIds(null)
        return
      }
      const nextIds = mergeVisibleOrder(session.fullIds, session.visibleIds, nextVisible)
      const unchanged =
        nextIds.length === session.fullIds.length &&
        nextIds.every((id, index) => id === session.fullIds[index])
      if (unchanged) {
        previewIdsRef.current = null
        setPreviewIds(null)
        return
      }
      previewIdsRef.current = nextIds
      setPreviewIds(nextIds)
      try {
        await window.api.roster.reorder(nextIds)
      } catch (err) {
        previewIdsRef.current = null
        setPreviewIds(null)
        notifyCaught(err, 'Could not save the roster order.')
      }
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }

  async function playThread(game: RosterGame): Promise<void> {
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

  return (
    <div className="catalog-page">
      <ToolbarPortal>
        <ToolbarSearch
          value={query}
          onChange={setQuery}
          placeholder="Filter roster"
          addon={
            <FilterToolbarSplit
              open={advanced.filtersOpen}
              count={advanced.activeFilterCount}
              onToggle={advanced.toggleFilters}
              onClear={advanced.clearFilters}
            />
          }
        />
        <button
          className={customOrder ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
          type="button"
          aria-pressed={customOrder}
          title={customOrder ? 'Custom order on. Turn off to sort automatically.' : 'Custom order off. Turn on to drag tiles.'}
          aria-label="Custom roster order"
          onClick={() => storeCustomOrder(!customOrder)}
        >
          <CustomOrderIcon />
        </button>
        {customOrder ? null : (
          <SelectMenu
            value={sort}
            options={SORTS}
            ariaLabel="Sort roster"
            onChange={(next) => {
              setSort(next)
              setDescending(next !== 'title')
            }}
            addon={
              <button
                className="ghost-btn icon-btn sort-split-dir"
                type="button"
                title={
                  sort === 'title'
                    ? descending
                      ? 'Z–A'
                      : 'A–Z'
                    : sort === 'rating' || sort === 'likes' || sort === 'views'
                      ? descending
                        ? 'Highest first'
                        : 'Lowest first'
                      : descending
                        ? 'Newest first'
                        : 'Oldest first'
                }
                aria-label={
                  sort === 'title'
                    ? descending
                      ? 'Sort Z to A'
                      : 'Sort A to Z'
                    : sort === 'rating' || sort === 'likes' || sort === 'views'
                      ? descending
                        ? 'Highest first'
                        : 'Lowest first'
                      : descending
                        ? 'Newest first'
                        : 'Oldest first'
                }
                onClick={() => setDescending((value) => !value)}
              >
                {descending ? '↓' : '↑'}
              </button>
            }
          />
        )}
        <button
          className={toolbarTriStateClass(advanced.favoritesFilter)}
          type="button"
          aria-pressed={advanced.favoritesFilter === 'include'}
          disabled={!favoriteTags.length}
          title={favoriteToolbarTitle(advanced.favoritesFilter, favoriteTags.length > 0)}
          aria-label="Filter by favorite tags"
          {...triStateMouseProps(advanced.cycleFavoritesFilter)}
        >
          <ThumbUpIcon />
        </button>
        <button
          className={toolbarTriStateClass(advanced.hatedFilter)}
          type="button"
          aria-pressed={advanced.hatedFilter === 'include'}
          disabled={!hatedTags.length}
          title={hatedToolbarTitle(advanced.hatedFilter, hatedTags.length > 0)}
          aria-label="Filter by hated tags"
          {...triStateMouseProps(advanced.cycleHatedFilter)}
        >
          <ThumbDownIcon />
        </button>
      </ToolbarPortal>
      <FooterPortal>
        <span className="muted pager-label">
          {needle || advanced.activeFilterCount
            ? `${visible.length}/${games.length}`
            : `${games.length} on roster`}
        </span>
      </FooterPortal>

      <LocalAdvancedFilters
        advanced={advanced}
        favoriteTags={favoriteTags}
        hatedTags={hatedTags}
      />

      {games.length === 0 ? (
        <div className="empty-state">
          Nothing on the roster yet. Use Add to roster on any game tile, including catalog games you
          are not following.
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {advanced.favoritesFilter === 'include' && !needle
            ? 'No roster games match your favorite tags.'
            : advanced.favoritesFilter === 'exclude' && !needle
              ? 'No roster games remain after hiding favorite tags.'
              : advanced.hatedFilter === 'include' && !needle
                ? 'No roster games match your hated tags.'
                : advanced.hatedFilter === 'exclude' && !needle
                  ? 'No roster games remain after hiding hated tags.'
                  : 'No roster games match that filter.'}
        </div>
      ) : (
        <div className={lifted ? 'catalog-grid is-reordering' : 'catalog-grid'}>
          {visible.map((game, index) => {
            const catalog = toCatalogGame(game)
            const isLifted = lifted?.id === game.threadId
            const tileClass = [
              'roster-tile',
              customOrder ? 'is-draggable' : '',
              isLifted ? 'is-lifted' : ''
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <div
                key={game.threadId}
                ref={(node) => bindSlot(game.threadId, node)}
                className={isLifted ? 'roster-slot is-origin' : 'roster-slot'}
              >
                <div
                  className={tileClass}
                  style={
                    isLifted
                      ? {
                          left: liftedRef.current?.x ?? lifted?.x,
                          top: liftedRef.current?.y ?? lifted?.y,
                          width: lifted?.width,
                          height: lifted?.height
                        }
                      : undefined
                  }
                  onPointerDown={(event) => onTilePointerDown(event, game.threadId)}
                >
                  <LazyMount eager={index < EAGER_CARDS}>
                    <GameCard
                      game={{ ...game, rarity: rarityById.get(game.threadId) ?? game.rarity }}
                      subscribed={followedById.has(game.threadId)}
                      archived={archivedIds.has(game.threadId)}
                      favoriteTags={favoriteTags}
                      hatedTags={hatedTags}
                      onToggle={() => void onToggleFollow(catalog)}
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
                      playing={playingByThread.has(game.threadId)}
                      prefixCatalog={prefixCatalog}
                      coverEager={index < EAGER_CARDS}
                      inRoster
                      onToggleRoster={() => onToggleRoster(catalog)}
                    />
                  </LazyMount>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
