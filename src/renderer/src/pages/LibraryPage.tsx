import { useMemo, useState, type JSX } from 'react'
import type { CatalogGame, FavoriteTag, GameRarity, HatedTag, Subscription } from '@shared/types'
import { gameStatusFlags, isInactiveStatus } from '@shared/prefixes'
import GameCard from '../components/GameCard'
import LazyMount from '../components/LazyMount'
import FooterPortal from '../components/FooterPortal'
import SelectMenu from '../components/SelectMenu'
import {
  ArchiveIcon,
  FollowedIcon,
  HideCompletedIcon,
  InstallIcon,
  SavesOnlyIcon,
  ThumbDownIcon,
  ThumbUpIcon
} from '../components/ToolbarIcons'
import ToolbarPortal from '../components/ToolbarPortal'
import ToolbarSearch from '../components/ToolbarSearch'
import { notifyCaught } from '../components/ErrorNotifications'
import {
  completedToolbarTitle,
  favoriteToolbarTitle,
  hatedToolbarTitle,
  matchesTriState,
  onTriStateMouse,
  toolbarTriStateClass,
  type FilterChipState
} from '../components/FilterChip'
import { toCatalogGame } from '../lib/catalog-game'
import { gameHasFavoriteTag } from '../lib/favorites'
import { useCatalogPrefixes } from '../lib/catalog-prefixes'
import {
  groupLibraryGames,
  mergeDownloadingLibraryGames,
  saveOnlyLibraryGames,
  summarizeLibrary,
  useLibraryFiles,
  usePlaySessions,
  useIdentifiedSaveFolders,
  libraryExclusiveKind,
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
  onOpen: (game: LibraryGame, tab?: 'saves') => void
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

function exclusiveKindTitle(
  state: FilterChipState,
  copy: { include: string; exclude: string; off: string }
): string {
  if (state === 'include') return copy.include
  if (state === 'exclude') return copy.exclude
  return copy.off
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
  const [completedFilter, setCompletedFilter] = useState<FilterChipState>('off')
  const [favoritesFilter, setFavoritesFilter] = useState<FilterChipState>('off')
  const [hatedFilter, setHatedFilter] = useState<FilterChipState>('off')
  const [followedFilter, setFollowedFilter] = useState<FilterChipState>('off')
  const [savesFilter, setSavesFilter] = useState<FilterChipState>('exclude')
  const [archivesFilter, setArchivesFilter] = useState<FilterChipState>('off')
  const [installsFilter, setInstallsFilter] = useState<FilterChipState>('off')
  const saveOnlyItems = useIdentifiedSaveFolders()
  const followedIds = useMemo(
    () => new Set(subscriptions.map((game) => game.threadId)),
    [subscriptions]
  )
  const libraryByThread = useMemo(() => summarizeLibrary(files), [files])
  const installedGames = useMemo(
    () => mergeDownloadingLibraryGames(groupLibraryGames(files, subscriptions), pendingDownloads, subscriptions),
    [files, subscriptions, pendingDownloads]
  )
  const saveOnlyGames = useMemo(
    () =>
      saveOnlyLibraryGames(
        saveOnlyItems,
        subscriptions,
        new Set(installedGames.map((game) => game.threadId))
      ),
    [saveOnlyItems, subscriptions, installedGames]
  )
  const games = useMemo(
    () => [...installedGames, ...saveOnlyGames],
    [installedGames, saveOnlyGames]
  )
  const kindFiltersActive =
    savesFilter !== 'exclude' || archivesFilter !== 'off' || installsFilter !== 'off'
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
          if (
            !matchesTriState(
              isInactiveStatus(gameStatusFlags(game.prefixes, prefixCatalog)),
              completedFilter
            )
          ) {
            return false
          }
          if (!matchesTriState(gameHasFavoriteTag(game.tags, favoriteTags), favoritesFilter)) return false
          if (!matchesTriState(gameHasFavoriteTag(game.tags, hatedTags), hatedFilter)) return false
          if (!matchesTriState(followedIds.has(game.threadId), followedFilter)) return false
          const exclusiveKind = libraryExclusiveKind(game, libraryByThread.get(game.threadId))
          if (!matchesTriState(exclusiveKind === 'saves', savesFilter)) return false
          if (!matchesTriState(exclusiveKind === 'archive', archivesFilter)) return false
          if (!matchesTriState(exclusiveKind === 'install', installsFilter)) return false
          return true
        })
        .sort((a, b) => compareGames(a, b, sort, descending)),
    [
      games,
      needle,
      sort,
      descending,
      completedFilter,
      favoritesFilter,
      favoriteTags,
      hatedFilter,
      hatedTags,
      followedIds,
      followedFilter,
      prefixCatalog,
      libraryByThread,
      savesFilter,
      archivesFilter,
      installsFilter
    ]
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
          className={toolbarTriStateClass(completedFilter)}
          type="button"
          aria-pressed={completedFilter === 'include'}
          title={completedToolbarTitle(completedFilter)}
          aria-label="Filter completed, on hold, and abandoned titles"
          onClick={(event) => onTriStateMouse(event, setCompletedFilter, 'reverse')}
          onContextMenu={(event) => onTriStateMouse(event, setCompletedFilter, 'reverse')}
        >
          <HideCompletedIcon />
        </button>
        <button
          className={toolbarTriStateClass(favoritesFilter)}
          type="button"
          aria-pressed={favoritesFilter === 'include'}
          disabled={!favoriteTags.length}
          title={favoriteToolbarTitle(favoritesFilter, favoriteTags.length > 0)}
          aria-label="Filter by favorite tags"
          onClick={(event) => onTriStateMouse(event, setFavoritesFilter)}
          onContextMenu={(event) => onTriStateMouse(event, setFavoritesFilter)}
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
          onClick={(event) => onTriStateMouse(event, setHatedFilter, 'reverse')}
          onContextMenu={(event) => onTriStateMouse(event, setHatedFilter, 'reverse')}
        >
          <ThumbDownIcon />
        </button>
        <button
          className={toolbarTriStateClass(followedFilter)}
          type="button"
          aria-pressed={followedFilter === 'include'}
          title={exclusiveKindTitle(followedFilter, {
            include: 'Showing only followed games',
            exclude: 'Hiding followed games',
            off: 'Showing followed and unfollowed games'
          })}
          aria-label="Filter followed games"
          onClick={(event) => onTriStateMouse(event, setFollowedFilter)}
          onContextMenu={(event) => onTriStateMouse(event, setFollowedFilter)}
        >
          <FollowedIcon />
        </button>
        <button
          className={toolbarTriStateClass(savesFilter)}
          type="button"
          aria-pressed={savesFilter === 'include'}
          title={exclusiveKindTitle(savesFilter, {
            include: 'Showing only games that have nothing except identified saves',
            exclude: 'Hiding games that only have identified saves',
            off: 'Showing games that only have identified saves'
          })}
          aria-label="Filter games that only have saves"
          onClick={(event) => onTriStateMouse(event, setSavesFilter)}
          onContextMenu={(event) => onTriStateMouse(event, setSavesFilter)}
        >
          <SavesOnlyIcon />
        </button>
        <button
          className={toolbarTriStateClass(archivesFilter)}
          type="button"
          aria-pressed={archivesFilter === 'include'}
          title={exclusiveKindTitle(archivesFilter, {
            include: 'Showing only games that have nothing except archives',
            exclude: 'Hiding games that only have archives',
            off: 'Showing games that only have archives'
          })}
          aria-label="Filter games that only have archives"
          onClick={(event) => onTriStateMouse(event, setArchivesFilter)}
          onContextMenu={(event) => onTriStateMouse(event, setArchivesFilter)}
        >
          <ArchiveIcon />
        </button>
        <button
          className={toolbarTriStateClass(installsFilter)}
          type="button"
          aria-pressed={installsFilter === 'include'}
          title={exclusiveKindTitle(installsFilter, {
            include: 'Showing only games that have nothing except installs',
            exclude: 'Hiding games that only have installs',
            off: 'Showing games that only have installs'
          })}
          aria-label="Filter games that only have installs"
          onClick={(event) => onTriStateMouse(event, setInstallsFilter)}
          onContextMenu={(event) => onTriStateMouse(event, setInstallsFilter)}
        >
          <InstallIcon />
        </button>
      </ToolbarPortal>
      <FooterPortal>
        <span className="muted pager-label">
          {needle ||
          completedFilter !== 'off' ||
          favoritesFilter !== 'off' ||
          hatedFilter !== 'off' ||
          followedFilter !== 'off' ||
          kindFiltersActive
            ? `${visible.length}/${games.length}`
            : `${visible.length} in library`}
        </span>
      </FooterPortal>

      {games.length === 0 ? (
        <div className="empty-state">
          Nothing in the library yet. Download or install a game from a thread and it will show up
          here, even if you are not following it.
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          {savesFilter === 'include' && !needle
            ? 'No games have only identified saves. Identify save folders on the Storage page to list them here.'
            : archivesFilter === 'include' && !needle
              ? 'No games have only archives.'
              : installsFilter === 'include' && !needle
                ? 'No games have only installs.'
                : savesFilter === 'exclude' &&
                    archivesFilter === 'exclude' &&
                    installsFilter === 'exclude' &&
                    !needle &&
                    favoritesFilter === 'off' &&
                    hatedFilter === 'off' &&
                    followedFilter === 'off' &&
                    completedFilter === 'off'
                  ? 'Exclusive save, archive, and install games are hidden.'
                  : completedFilter === 'include' && !needle
                    ? 'No library games are completed, on hold, or abandoned.'
                    : completedFilter === 'exclude' && !needle
                      ? 'No library games remain after hiding completed, on hold, and abandoned titles.'
                      : followedFilter === 'include' && !needle
                    ? 'No followed games are in the library.'
                    : followedFilter === 'exclude' && !needle
                      ? 'No unfollowed games are in the library.'
                      : favoritesFilter === 'include' && !needle
                        ? 'No library games match your favorite tags.'
                        : favoritesFilter === 'exclude' && !needle
                          ? 'No library games remain after hiding favorite tags.'
                          : hatedFilter === 'include' && !needle
                            ? 'No library games match your hated tags.'
                            : hatedFilter === 'exclude' && !needle
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
                  onOpen={() => onOpen(game, game.savesOnly ? 'saves' : undefined)}
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
