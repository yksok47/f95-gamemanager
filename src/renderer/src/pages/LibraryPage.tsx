import { useMemo, useState, type JSX } from 'react'
import type { CatalogGame, FavoriteTag, GameRarity, HatedTag, Subscription } from '@shared/types'
import { FilterToolbarSplit, LocalAdvancedFilters } from '../components/AdvancedFilterUi'
import GameCard from '../components/GameCard'
import LazyMount from '../components/LazyMount'
import FooterPortal from '../components/FooterPortal'
import SelectMenu from '../components/SelectMenu'
import {
  ArchiveIcon,
  FilingCabinetIcon,
  FollowedIcon,
  InstallIcon,
  SavesOnlyIcon,
  ThumbDownIcon,
  ThumbUpIcon
} from '../components/ToolbarIcons'
import ToolbarPortal from '../components/ToolbarPortal'
import ToolbarSearch from '../components/ToolbarSearch'
import { notifyCaught } from '../components/ErrorNotifications'
import {
  archivedToolbarTitle,
  favoriteToolbarTitle,
  hatedToolbarTitle,
  matchesTriState,
  onTriStateMouse,
  toolbarTriStateClass,
  triStateMouseProps,
  type FilterChipState
} from '../components/FilterChip'
import { toCatalogGame } from '../lib/catalog-game'
import { useAdvancedFilters } from '../lib/use-advanced-filters'
import {
  groupLibraryGames,
  mergeDownloadingLibraryGames,
  saveOnlyLibraryGames,
  summarizeLibrary,
  useLibraryFiles,
  usePlaySessions,
  useIdentifiedSaveFolders,
  useIdentifiedSaveThreadIds,
  withSavePresence,
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

const EAGER_CARDS = 12

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

/** Filters only change the shown count. The total stays the full list. */
function formatShownTotal(shown: number, total: number, singular: string, plural = singular): string {
  const label = total === 1 ? singular : plural
  return shown === total ? `${total} ${label}` : `${shown}/${total} ${label}`
}

function countMatching(games: LibraryGame[], match: (game: LibraryGame) => boolean): number {
  let count = 0
  for (const game of games) {
    if (match(game)) count += 1
  }
  return count
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
  const advanced = useAdvancedFilters(favoriteTags, hatedTags)
  const prefixCatalog = advanced.filters.prefixes
  const pendingDownloads = usePendingDownloads()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<LibrarySort>('played')
  const [descending, setDescending] = useState(true)
  const [followedFilter, setFollowedFilter] = useState<FilterChipState>('off')
  const [archivedFilter, setArchivedFilter] = useState<FilterChipState>('exclude')
  const [savesFilter, setSavesFilter] = useState<FilterChipState>('exclude')
  const [archivesFilter, setArchivesFilter] = useState<FilterChipState>('off')
  const [installsFilter, setInstallsFilter] = useState<FilterChipState>('off')
  const saveOnlyItems = useIdentifiedSaveFolders()
  const saveIds = useIdentifiedSaveThreadIds()
  const followedIds = useMemo(
    () => new Set(subscriptions.map((game) => game.threadId)),
    [subscriptions]
  )
  const archivedIds = useMemo(
    () => new Set(subscriptions.filter((game) => game.archived).map((game) => game.threadId)),
    [subscriptions]
  )
  const libraryByThread = useMemo(
    () => withSavePresence(summarizeLibrary(files, subscriptions), saveIds),
    [files, saveIds]
  )
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
        .filter((game) => advanced.matches(game))
        .filter((game) => {
          if (!matchesTriState(followedIds.has(game.threadId), followedFilter)) return false
          if (!matchesTriState(archivedIds.has(game.threadId), archivedFilter)) return false
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
      advanced.matches,
      followedIds,
      followedFilter,
      archivedIds,
      archivedFilter,
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
        <ToolbarSearch
          value={query}
          onChange={setQuery}
          placeholder="Filter library"
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
          {...triStateMouseProps((event) => onTriStateMouse(event, setFollowedFilter))}
        >
          <FollowedIcon />
        </button>
        <button
          className={toolbarTriStateClass(archivedFilter)}
          type="button"
          aria-pressed={archivedFilter === 'include'}
          title={archivedToolbarTitle(archivedFilter)}
          aria-label="Filter archived games"
          {...triStateMouseProps((event) => onTriStateMouse(event, setArchivedFilter))}
        >
          <FilingCabinetIcon />
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
          {...triStateMouseProps((event) => onTriStateMouse(event, setSavesFilter))}
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
          {...triStateMouseProps((event) => onTriStateMouse(event, setArchivesFilter))}
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
          {...triStateMouseProps((event) => onTriStateMouse(event, setInstallsFilter))}
        >
          <InstallIcon />
        </button>
      </ToolbarPortal>
      <FooterPortal>
        <div className="footer-cluster">
          <span className="muted pager-label">
            {formatShownTotal(visible.length, games.length, 'in library')}
          </span>
          <span className="muted pager-label">
            {formatShownTotal(
              countMatching(visible, (game) => Boolean(libraryByThread.get(game.threadId)?.isInstalled)),
              countMatching(games, (game) => Boolean(libraryByThread.get(game.threadId)?.isInstalled)),
              'installed'
            )}
          </span>
          <span className="muted pager-label">
            {formatShownTotal(
              countMatching(visible, (game) => Boolean(libraryByThread.get(game.threadId)?.hasArchive)),
              countMatching(games, (game) => Boolean(libraryByThread.get(game.threadId)?.hasArchive)),
              'archive',
              'archives'
            )}
          </span>
        </div>
      </FooterPortal>

      <LocalAdvancedFilters
        advanced={advanced}
        favoriteTags={favoriteTags}
        hatedTags={hatedTags}
      />

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
                    advanced.activeFilterCount === 0 &&
                    followedFilter === 'off' &&
                    archivedFilter === 'exclude'
                  ? 'Exclusive save, archive, and install games are hidden.'
                  : followedFilter === 'include' && !needle
                    ? 'No followed games are in the library.'
                    : followedFilter === 'exclude' && !needle
                      ? 'No unfollowed games are in the library.'
                      : archivedFilter === 'exclude' &&
                          !needle &&
                          advanced.activeFilterCount === 0 &&
                          followedFilter === 'off' &&
                          !kindFiltersActive &&
                          archivedIds.size
                        ? 'Archived followed games are hidden.'
                        : archivedFilter === 'include' && !needle
                          ? 'No archived games are in the library.'
                          : advanced.favoritesFilter === 'include' && !needle
                        ? 'No library games match your favorite tags.'
                        : advanced.favoritesFilter === 'exclude' && !needle
                          ? 'No library games remain after hiding favorite tags.'
                          : advanced.hatedFilter === 'include' && !needle
                            ? 'No library games match your hated tags.'
                            : advanced.hatedFilter === 'exclude' && !needle
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
                  archived={archivedIds.has(game.threadId)}
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
