import { useMemo, useState, type JSX } from 'react'
import type {
  CatalogGame,
  FavoriteTag,
  HatedTag,
  GameRarity,
  RosterGame,
  Subscription
} from '@shared/types'
import { gameStatusFlags, isInactiveStatus } from '@shared/prefixes'
import GameCard from '../components/GameCard'
import LazyMount from '../components/LazyMount'
import FooterPortal from '../components/FooterPortal'
import SelectMenu from '../components/SelectMenu'
import { HateIcon, HideCompletedIcon, StarIcon } from '../components/ToolbarIcons'
import ToolbarPortal from '../components/ToolbarPortal'
import ToolbarSearch from '../components/ToolbarSearch'
import { toCatalogGame } from '../lib/catalog-game'
import { gameHasFavoriteTag } from '../lib/favorites'
import { useCatalogPrefixes } from '../lib/catalog-prefixes'
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
  const prefixCatalog = useCatalogPrefixes()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<RosterSort>('added')
  const [descending, setDescending] = useState(true)
  const [hideCompleted, setHideCompleted] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [hatedActive, setHatedActive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const followedById = useMemo(
    () => new Map(subscriptions.map((game) => [game.threadId, game])),
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
        .filter((game) => {
          if (hideCompleted && isInactiveStatus(gameStatusFlags(game.prefixes, prefixCatalog))) {
            return false
          }
          if (favoritesOnly && !gameHasFavoriteTag(game.tags, favoriteTags)) return false
          if (hatedActive && gameHasFavoriteTag(game.tags, hatedTags)) return false
          return true
        })
        .sort((a, b) => compareGames(a, b, sort, descending)),
    [
      presented,
      needle,
      sort,
      descending,
      hideCompleted,
      favoritesOnly,
      favoriteTags,
      hatedActive,
      hatedTags,
      prefixCatalog
    ]
  )

  async function playThread(game: RosterGame): Promise<void> {
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

  return (
    <div className="catalog-page">
      <ToolbarPortal>
        <ToolbarSearch value={query} onChange={setQuery} placeholder="Filter roster" />
        <SelectMenu
          value={sort}
          options={SORTS}
          ariaLabel="Sort roster"
          onChange={(next) => {
            setSort(next)
            setDescending(next !== 'title')
          }}
        />
        <button
          className="ghost-btn pager-btn"
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
          onClick={() => setDescending((value) => !value)}
        >
          {descending ? '↓' : '↑'}
        </button>
        <button
          className={hideCompleted ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
          type="button"
          aria-pressed={hideCompleted}
          title={
            hideCompleted
              ? 'Show completed, on hold, and abandoned titles'
              : 'Hide completed, on hold, and abandoned titles'
          }
          aria-label={
            hideCompleted
              ? 'Show completed, on hold, and abandoned titles'
              : 'Hide completed, on hold, and abandoned titles'
          }
          onClick={() => setHideCompleted((value) => !value)}
        >
          <HideCompletedIcon />
        </button>
        <button
          className={favoritesOnly ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
          type="button"
          aria-pressed={favoritesOnly}
          disabled={!favoriteTags.length}
          title={
            favoriteTags.length
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
          className={hatedActive ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
          type="button"
          aria-pressed={hatedActive}
          disabled={!hatedTags.length}
          title={
            hatedTags.length
              ? hatedActive
                ? 'Showing hated tags'
                : 'Hide games with hated tags'
              : 'Add hated tags in Settings'
          }
          aria-label="Hide games with hated tags"
          onClick={() => setHatedActive((value) => !value)}
        >
          <HateIcon />
        </button>
      </ToolbarPortal>
      <FooterPortal>
        <span className="muted pager-label">
          {needle || hideCompleted || favoritesOnly || hatedActive
            ? `${visible.length}/${games.length}`
            : `${games.length} on roster`}
        </span>
      </FooterPortal>

      {error ? <p className="catalog-status error-text">{error}</p> : null}

      {games.length === 0 ? (
        <div className="empty-state">
          Nothing on the roster yet. Use Add to roster on any game tile, including catalog games you
          are not following.
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {favoritesOnly && !needle
            ? 'No roster games match your favorite tags.'
            : hatedActive && !needle
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
