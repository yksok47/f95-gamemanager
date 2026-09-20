import { useMemo, useState, type JSX } from 'react'
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
import { ThumbDownIcon, ThumbUpIcon } from '../components/ToolbarIcons'
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

const EAGER_CARDS = 18

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
  const [sort, setSort] = useState<RosterSort>('added')
  const [descending, setDescending] = useState(true)
  const followedById = useMemo(
    () => new Map(subscriptions.map((game) => [game.threadId, game])),
    [subscriptions]
  )
  const archivedIds = useMemo(
    () => new Set(subscriptions.filter((game) => game.archived).map((game) => game.threadId)),
    [subscriptions]
  )
  const presented = useMemo(
    () => games.map((game) => overlayRosterGame(game, followedById.get(game.threadId))),
    [games, followedById]
  )
  const needle = query.trim().toLowerCase()
  const playingByThread = useMemo(() => {
    const ids = new Set<number>()
    for (const session of sessions) ids.add(session.threadId)
    return ids
  }, [sessions])
  const visible = useMemo(
    () =>
      presented
        .filter((game) => matchesQuery(game, needle))
        .filter((game) => advanced.matches(game))
        .sort((a, b) => compareGames(a, b, sort, descending)),
    [presented, needle, sort, descending, advanced.matches]
  )

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
        <div className="catalog-grid">
          {visible.map((game, index) => {
            const catalog = toCatalogGame(game)
            return (
              <LazyMount key={game.threadId} eager={index < EAGER_CARDS}>
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
            )
          })}
        </div>
      )}
    </div>
  )
}
