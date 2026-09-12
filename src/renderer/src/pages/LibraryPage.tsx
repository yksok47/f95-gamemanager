import { useMemo, useState, type JSX } from 'react'
import type { CatalogGame, FavoriteTag, GameRarity, Subscription } from '@shared/types'
import { gameStatusFlags, isInactiveStatus } from '@shared/prefixes'
import GameCard from '../components/GameCard'
import FooterPortal from '../components/FooterPortal'
import SelectMenu from '../components/SelectMenu'
import { HideCompletedIcon, StarIcon } from '../components/ToolbarIcons'
import ToolbarPortal from '../components/ToolbarPortal'
import { gameHasFavoriteTag } from '../lib/favorites'
import { useCatalogPrefixes } from '../lib/catalog-prefixes'
import {
  groupLibraryGames,
  summarizeLibrary,
  useLibraryFiles,
  usePlaySessions,
  type LibraryGame
} from '../lib/library'

type LibrarySort = 'title' | 'played' | 'added' | 'rating' | 'likes' | 'views'

const SORTS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'played', label: 'Last played' },
  { value: 'added', label: 'Added' },
  { value: 'title', label: 'Name' },
  { value: 'rating', label: 'Rating' },
  { value: 'likes', label: 'Likes' },
  { value: 'views', label: 'Views' }
]

type LibraryPageProps = {
  subscriptions: Subscription[]
  favoriteTags: FavoriteTag[]
  rarityById: Map<number, GameRarity>
  onToggleFollow: (game: CatalogGame) => Promise<void>
  onOpen: (game: LibraryGame) => void
  onSessionExpired: () => Promise<void>
}

function matchesQuery(game: LibraryGame, query: string): boolean {
  if (!query) return true
  const haystack = `${game.title} ${game.creator} ${game.version}`.toLowerCase()
  return haystack.includes(query)
}

function compareGames(a: LibraryGame, b: LibraryGame, sort: LibrarySort, descending: boolean): number {
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
  } else if (sort === 'played') {
    result = (a.lastPlayedAt || 0) - (b.lastPlayedAt || 0)
    if (!result) result = a.downloadedAt - b.downloadedAt
  } else {
    result = a.downloadedAt - b.downloadedAt
  }
  if (!result) result = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  return descending ? -result : result
}

function toCatalogGame(game: LibraryGame): CatalogGame {
  return {
    threadId: game.threadId,
    title: game.title,
    creator: game.creator,
    version: game.version,
    views: game.views,
    likes: game.likes,
    rating: game.rating,
    coverUrl: game.coverUrl,
    updatedAt: '',
    timestamp: game.timestamp,
    isNew: false,
    threadUrl: game.threadUrl,
    prefixes: game.prefixes,
    tags: game.tags,
    screens: game.screens,
    engine: game.engine
  }
}

export default function LibraryPage({
  subscriptions,
  favoriteTags,
  rarityById,
  onToggleFollow,
  onOpen,
  onSessionExpired
}: LibraryPageProps): JSX.Element {
  const files = useLibraryFiles()
  const sessions = usePlaySessions()
  const prefixCatalog = useCatalogPrefixes()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LibrarySort>('played')
  const [descending, setDescending] = useState(true)
  const [hideCompleted, setHideCompleted] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const followedIds = useMemo(
    () => new Set(subscriptions.map((game) => game.threadId)),
    [subscriptions]
  )
  const libraryByThread = useMemo(() => summarizeLibrary(files), [files])
  const games = useMemo(() => groupLibraryGames(files, subscriptions), [files, subscriptions])
  const needle = query.trim().toLowerCase()
  const visible = useMemo(
    () =>
      games
        .filter((game) => matchesQuery(game, needle))
        .filter((game) => {
          if (hideCompleted && isInactiveStatus(gameStatusFlags(game.prefixes, prefixCatalog))) {
            return false
          }
          if (favoritesOnly && !gameHasFavoriteTag(game.tags, favoriteTags)) return false
          return true
        })
        .sort((a, b) => compareGames(a, b, sort, descending)),
    [games, needle, sort, descending, hideCompleted, favoritesOnly, favoriteTags, prefixCatalog]
  )

  function sessionForThread(threadId: number) {
    return sessions.find((session) => session.threadId === threadId) ?? null
  }

  async function playThread(game: LibraryGame): Promise<void> {
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

  return (
    <div className="catalog-page">
      <ToolbarPortal>
        <input
          className="toolbar-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter library"
        />
        <SelectMenu
          value={sort}
          options={SORTS}
          ariaLabel="Sort library"
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
      </ToolbarPortal>
      <FooterPortal>
        <span className="muted pager-label">
          {needle || hideCompleted || favoritesOnly
            ? `${visible.length}/${games.length}`
            : `${games.length} in library`}
        </span>
      </FooterPortal>

      {error ? <p className="catalog-status error-text">{error}</p> : null}

      {games.length === 0 ? (
        <div className="empty-state">
          Nothing in the library yet. Download or install a game from a thread and it will show up
          here, even if you are not following it.
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {favoritesOnly && !needle
            ? 'No library games match your favorite tags.'
            : 'No library games match that filter.'}
        </div>
      ) : (
        <div className="catalog-grid">
          {visible.map((game) => {
            const subscribed = followedIds.has(game.threadId)
            return (
              <GameCard
                key={game.threadId}
                game={{ ...game, rarity: rarityById.get(game.threadId) }}
                subscribed={subscribed}
                favoriteTags={favoriteTags}
                onToggle={() => void onToggleFollow(toCatalogGame(game))}
                onOpen={() => onOpen(game)}
                onPlay={
                  libraryByThread.get(game.threadId)?.isInstalled
                    ? () => void playThread(game)
                    : undefined
                }
                library={libraryByThread.get(game.threadId)}
                playing={Boolean(sessionForThread(game.threadId))}
                prefixCatalog={prefixCatalog}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
