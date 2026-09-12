import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type { FavoriteTag, FollowSyncStatus, ImportResult, Subscription } from '@shared/types'
import { RARITY_RANK } from '@shared/types'
import { gameStatusFlags, isInactiveStatus } from '@shared/prefixes'
import { formatRelativeTime, gameUpdateState } from '@shared/updates'
import GameCard from '../components/GameCard'
import { MenuPopover } from '../components/MenuPopover'
import SelectMenu from '../components/SelectMenu'
import FooterPortal from '../components/FooterPortal'
import { HideCompletedIcon, ImportIcon, RefreshIcon, StarIcon } from '../components/ToolbarIcons'
import ToolbarPortal from '../components/ToolbarPortal'
import { gameHasFavoriteTag } from '../lib/favorites'
import { useCatalogPrefixes } from '../lib/catalog-prefixes'
import { useLibraryByThread, usePlaySessions } from '../lib/library'

type FollowedSort = 'title' | 'date' | 'rating' | 'rarity' | 'likes' | 'views'

const SORTS: Array<{ value: FollowedSort; label: string }> = [
  { value: 'title', label: 'Name' },
  { value: 'date', label: 'Updated' },
  { value: 'rating', label: 'Rating' },
  { value: 'likes', label: 'Likes' },
  { value: 'views', label: 'Views' },
  { value: 'rarity', label: 'Rarity' }
]

function updateTime(game: Subscription): number {
  return game.timestamp || game.addedAt || 0
}

function matchesQuery(game: Subscription, query: string): boolean {
  if (!query) return true
  const haystack = `${game.title} ${game.creator} ${game.version}`.toLowerCase()
  return haystack.includes(query)
}

function compareGames(
  a: Subscription,
  b: Subscription,
  sort: FollowedSort,
  descending: boolean
): number {
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
  } else if (sort === 'rarity') {
    result = RARITY_RANK[a.rarity] - RARITY_RANK[b.rarity]
  } else {
    result = updateTime(a) - updateTime(b)
  }
  if (!result) result = b.addedAt - a.addedAt
  return descending ? -result : result
}

type FollowedPageProps = {
  games: Subscription[]
  favoriteTags: FavoriteTag[]
  onRemove: (threadId: number) => Promise<void>
  onOpen: (game: Subscription) => void
  onImported: () => Promise<void>
  onSessionExpired: () => Promise<void>
}

function syncProgress(sync: FollowSyncStatus): number {
  const total = sync.checked + sync.pending
  return total ? sync.checked / total : 0
}

function formatImport(result: ImportResult): string {
  const label = result.source === 'watched' ? 'watched threads' : 'bookmarks'
  return `Imported ${result.added} ${label} (${result.alreadyFollowed} already followed, ${result.found} found).`
}

export default function FollowedPage({
  games,
  favoriteTags,
  onRemove,
  onOpen,
  onImported,
  onSessionExpired
}: FollowedPageProps): JSX.Element {
  const libraryByThread = useLibraryByThread()
  const sessions = usePlaySessions()
  const prefixCatalog = useCatalogPrefixes()
  const [busy, setBusy] = useState<'watched' | 'bookmarks' | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<FollowedSort>('date')
  const [descending, setDescending] = useState(true)
  const [updatesOnly, setUpdatesOnly] = useState(false)
  const [hideCompleted, setHideCompleted] = useState(false)
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [sync, setSync] = useState<FollowSyncStatus | null>(null)
  const importBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.subscriptions.syncStatus().then((next) => {
      if (!cancelled) setSync(next)
    })
    const stop = window.api.subscriptions.onSyncStatus(setSync)
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  async function runImport(kind: 'watched' | 'bookmarks'): Promise<void> {
    setImportOpen(false)
    setBusy(kind)
    setError(null)
    setMessage(null)
    try {
      const result =
        kind === 'watched'
          ? await window.api.subscriptions.importWatched()
          : await window.api.subscriptions.importBookmarks()
      await onImported()
      setMessage(formatImport(result))
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Import failed.'
      if (text.includes('Not logged in')) {
        await onSessionExpired()
        return
      }
      setError(text)
    } finally {
      setBusy(null)
    }
  }

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
          if (!updatesOnly) return true
          const lib = libraryByThread.get(game.threadId)
          const flags = gameUpdateState({
            latestVersion: game.version,
            installedVersion: lib?.installedVersion,
            lastPlayedVersion: game.lastPlayedVersion
          })
          return flags.updateAvailable || flags.unplayedUpdate
        })
        .sort((a, b) => compareGames(a, b, sort, descending)),
    [
      games,
      needle,
      sort,
      descending,
      updatesOnly,
      hideCompleted,
      favoritesOnly,
      favoriteTags,
      libraryByThread,
      prefixCatalog
    ]
  )

  function sessionForThread(threadId: number) {
    return sessions.find((session) => session.threadId === threadId) ?? null
  }

  async function playThread(game: Subscription): Promise<void> {
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

  async function checkUpdates(): Promise<void> {
    setError(null)
    try {
      const next = await window.api.subscriptions.sync()
      setSync(next)
      setMessage(
        next.updated
          ? `Refreshed metadata for ${next.updated} followed game${next.updated === 1 ? '' : 's'}.`
          : 'Every followed game was already refreshed within the last day.'
      )
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Could not check for updates.'
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
          placeholder="Filter followed"
        />
        <SelectMenu
          value={sort}
          options={SORTS}
          ariaLabel="Sort followed"
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
              : sort === 'rating' || sort === 'rarity' || sort === 'likes' || sort === 'views'
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
          className={updatesOnly ? 'ghost-btn nav-btn-active' : 'ghost-btn'}
          type="button"
          aria-pressed={updatesOnly}
          title="Show only games with a newer thread version than the install or last play"
          onClick={() => setUpdatesOnly((value) => !value)}
        >
          Updates
        </button>
        <div className="toolbar-actions">
          <button
            className={sync?.running ? 'ghost-btn icon-btn sync-btn is-running' : 'ghost-btn icon-btn sync-btn'}
            type="button"
            disabled={sync?.running}
            aria-label={
              sync?.running
                ? sync.pending
                  ? `Checking updates, ${sync.pending} remaining`
                  : 'Checking updates'
                : 'Check updates'
            }
            title={
              sync?.running
                ? sync.pending
                  ? `Checking… ${sync.pending} remaining`
                  : 'Checking…'
                : sync?.lastRunAt
                  ? `Last check ${formatRelativeTime(sync.lastRunAt)}`
                  : 'Refresh metadata for followed games not checked in the last day'
            }
            onClick={() => void checkUpdates()}
          >
            {sync?.running ? (
              <span
                className="sync-progress"
                style={{
                  ['--p' as string]: syncProgress(sync)
                }}
              />
            ) : null}
            <RefreshIcon spinning={Boolean(sync?.running)} />
          </button>
          <div className="import-menu">
            <button
              ref={importBtnRef}
              className="ghost-btn icon-btn"
              type="button"
              aria-haspopup="menu"
              aria-expanded={importOpen}
              aria-label={busy ? 'Importing' : 'Import'}
              title={busy ? 'Importing…' : 'Import watched threads or bookmarks'}
              disabled={busy !== null}
              onClick={() => setImportOpen((open) => !open)}
            >
              <ImportIcon />
            </button>
            {importOpen && importBtnRef.current ? (
              <MenuPopover
                anchor={importBtnRef.current}
                items={[
                  {
                    id: 'watched',
                    label: 'Watched threads',
                    onClick: () => void runImport('watched')
                  },
                  {
                    id: 'bookmarks',
                    label: 'Bookmarks',
                    onClick: () => void runImport('bookmarks')
                  }
                ]}
                onClose={() => setImportOpen(false)}
              />
            ) : null}
          </div>
        </div>
      </ToolbarPortal>
      <FooterPortal>
        <span className="muted pager-label">
          {needle || updatesOnly || hideCompleted || favoritesOnly
            ? `${visible.length}/${games.length}`
            : `${games.length} followed`}
        </span>
        {sync?.running ? (
          <span className="muted pager-label">
            {sync.pending
              ? `Checking ${sync.checked}/${sync.checked + sync.pending}`
              : 'Checking…'}
          </span>
        ) : null}
      </FooterPortal>

      {message ? <p className="catalog-status muted">{message}</p> : null}
      {error ? <p className="catalog-status error-text">{error}</p> : null}

      {sync?.lastError ? <p className="catalog-status error-text">{sync.lastError}</p> : null}
      {games.length === 0 ? (
        <div className="empty-state">
          Nothing followed yet. Use Follow on a catalog card, or import watched threads and bookmarks
          from your F95zone account.
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {updatesOnly && !needle && !favoritesOnly && !hideCompleted
            ? 'No followed games have a newer version than the install or last play.'
            : favoritesOnly && !needle
              ? 'No followed games match your favorite tags.'
              : 'No followed games match that filter.'}
        </div>
      ) : (
        <div className="catalog-grid">
          {visible.map((game) => (
            <GameCard
              key={game.threadId}
              game={game}
              subscribed
              favoriteTags={favoriteTags}
              onToggle={() => void onRemove(game.threadId)}
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
          ))}
        </div>
      )}
    </div>
  )
}
