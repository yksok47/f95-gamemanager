import { useMemo, useState, type JSX } from 'react'
import type { CatalogGame, FavoriteTag, GameRarity, HatedTag, Subscription } from '@shared/types'
import { gameStatusFlags, isInactiveStatus } from '@shared/prefixes'
import GameCard from '../components/GameCard'
import LazyMount from '../components/LazyMount'
import FooterPortal from '../components/FooterPortal'
import SelectMenu from '../components/SelectMenu'
import { HateIcon, HideCompletedIcon, StarIcon } from '../components/ToolbarIcons'
import ToolbarPortal from '../components/ToolbarPortal'
import ToolbarSearch from '../components/ToolbarSearch'
import { notifyCaught } from '../components/ErrorNotifications'
import { toCatalogGame } from '../lib/catalog-game'
import { gameHasFavoriteTag } from '../lib/favorites'
import { useCatalogPrefixes } from '../lib/catalog-prefixes'
import {
  groupLibraryGames,
  mergeDownloadingLibraryGames,
  summarizeLibrary,
  useLibraryFiles,
  usePlaySessions,
  type LibraryGame
} from '../lib/library'
import { usePendingDownloads } from '../lib/download-progress'

type LibrarySort = 'title' | 'played' | 'added' | 'rating' | 'likes' | 'views'

const SORTS: Array<{ value: LibrarySort; label: string }> = [
  { value: 'played', label: 'Last played' },
  { value: 'added', label: 'Added' },
  { value: 'title', label: 'Name' },
  { value: 'rating', label: 'Rating' },
  { value: 'likes', label: 'Likes' },
  { value: 'views', label: 'Views' }
]

const EAGER_CARDS = 18

type LibraryPageProps = {
  subscriptions: Subscription[]
  favoriteTags: FavoriteTag[]
  hatedTags: HatedTag[]
  rarityById: Map<number, GameRarity>
  rosterIds: Set<number>
  onToggleFollow: (game: CatalogGame) => Promise<void>
  onToggleRoster: (game: CatalogGame) => Promise<void>
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

export default function LibraryPage({
  subscriptions,
  favoriteTags,
  hatedTags,
  rarityById,
  rosterIds,
  onToggleFollow,
  onToggleRoster,
  onOpen,
  onSessionExpired
}: LibraryPageProps): JSX.Element {
  const files = useLibraryFiles()
  const sessions = usePlaySessions()
  const prefixCatalog = useCatalogPrefixes()
  const pendingDownloads = usePendingDownloads()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LibrarySort>('played')
  const [descending, setDescending] = useState(true)
  const [hideCompleted, setHideCompleted] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [hatedActive, setHatedActive] = useState(false)
  const followedIds = useMemo(
    () => new Set(subscriptions.map((game) => game.threadId)),
    [subscriptions]
  )
  const libraryByThread = useMemo(() => summarizeLibrary(files), [files])
  const games = useMemo(
    () => mergeDownloadingLibraryGames(groupLibraryGames(files, subscriptions), pendingDownloads, subscriptions),
    [files, subscriptions, pendingDownloads]
  )
  const needle = query.trim().toLowerCase()
  const playingByThread = useMemo(() => {
    const ids = new Set<number>()
    for (const session of sessions) ids.add(session.threadId)
    return ids
  }, [sessions])
  const visible = useMemo(
    () =>
      games
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
    [games, needle, sort, descending, hideCompleted, favoritesOnly, favoriteTags, hatedActive, hatedTags, prefixCatalog]
  )

  async function playThread(game: LibraryGame): Promise<void> {
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
        <ToolbarSearch value={query} onChange={setQuery} placeholder="Filter library" />
        <SelectMenu
          value={sort}
          options={SORTS}
          ariaLabel="Sort library"
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
            : `${games.length} in library`}
        </span>
      </FooterPortal>

      {games.length === 0 ? (
        <div className="empty-state">
          Nothing in the library yet. Download or install a game from a thread and it will show up
          here, even if you are not following it.
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {favoritesOnly && !needle
            ? 'No library games match your favorite tags.'
            : hatedActive && !needle
              ? 'No library games remain after hiding hated tags.'
              : 'No library games match that filter.'}
        </div>
      ) : (
        <div className="catalog-grid">
          {visible.map((game, index) => {
            const subscribed = followedIds.has(game.threadId)
            return (
              <LazyMount key={game.threadId} eager={index < EAGER_CARDS}>
                <GameCard
                  game={{ ...game, rarity: rarityById.get(game.threadId) }}
                  subscribed={subscribed}
                  favoriteTags={favoriteTags}
                  hatedTags={hatedTags}
                  onToggle={() => void onToggleFollow(toCatalogGame(game))}
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
                  inRoster={rosterIds.has(game.threadId)}
                  onToggleRoster={() => onToggleRoster(toCatalogGame(game))}
                />
              </LazyMount>
            )
          })}
        </div>
      )}
    </div>
  )
}
