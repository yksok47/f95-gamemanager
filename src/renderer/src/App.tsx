import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import type {
  AppSettings,
  AuthSession,
  CatalogGame,
  DownloadRecord,
  GameRarity,
  GameSummary,
  RosterGame,
  Subscription
} from '@shared/types'
import { DEFAULT_CATALOG_PAGE_SIZE, DEFAULT_CLOUD_SAVE_KEEP_COUNT } from '@shared/types'
import AppNav, { type AppView } from './components/AppNav'
import { ConfirmHost } from './components/ConfirmDialog'
import { ErrorNotificationHost, errorMessage, notifyError } from './components/ErrorNotifications'
import DownloadsDock from './components/DownloadsDock'
import { FooterDockSlot, FooterSlot } from './components/FooterPortal'
import GameTaskbar, { type GameTaskbarItem } from './components/GameTaskbar'
import CatalogPage from './pages/CatalogPage'
import DownloadsPage from './pages/DownloadsPage'
import UploadsPage from './pages/UploadsPage'
import {
  P2P_ENV_DEFAULTS,
  type PackageInstallTags,
  type P2pTransferProgress,
  type TorrentMapEntry
} from '@shared/p2p'
import FollowedPage from './pages/FollowedPage'
import UpdatesPage from './pages/UpdatesPage'
import RosterPage from './pages/RosterPage'
import LibraryPage from './pages/LibraryPage'
import StoragePage, { type StorageOpenTab } from './pages/StoragePage'
import GameDetailsPage from './pages/GameDetailsPage'
import LoginPage from './pages/LoginPage'
import SettingsPage from './pages/SettingsPage'
import { isActiveDownload, isActiveP2pDownload, collectThreadDownloads } from './lib/downloads'
import { DownloadProgressProvider } from './lib/download-progress'
import { hasLibraryCopy, useLibraryByThread, type LibraryGame } from './lib/library'
import { toCatalogGame } from './lib/catalog-game'
import { shouldListOnUpdatesPage, mergeVersionPlayStats } from '@shared/updates'
import { useAppUpdate } from './lib/app-update'
import { useStorageScan } from './lib/storage-scan'
import { focusPageSearchOnHotkey } from './lib/page-search'

function toSummary(
  game: CatalogGame | Subscription | LibraryGame | RosterGame,
  rarity?: GameRarity
): GameSummary {
  return {
    threadId: game.threadId,
    title: game.title,
    creator: game.creator,
    version: game.version,
    coverUrl: game.coverUrl,
    rating: game.rating,
    likes: game.likes,
    views: game.views,
    threadUrl: game.threadUrl,
    updatedAt: game.updatedAt,
    timestamp: game.timestamp,
    prefixes: game.prefixes,
    tags: game.tags,
    engine: 'engine' in game ? game.engine : undefined,
    screens: 'screens' in game ? game.screens : undefined,
    rarity: rarity ?? ('rarity' in game ? game.rarity : undefined),
    lastPlayedVersion: 'lastPlayedVersion' in game ? game.lastPlayedVersion : undefined,
    lastPlayedAt: 'lastPlayedAt' in game ? game.lastPlayedAt : undefined,
    playtimeMs: 'playtimeMs' in game ? game.playtimeMs : undefined,
    playedVersions: 'playedVersions' in game ? game.playedVersions : undefined,
    checkedAt: 'checkedAt' in game ? game.checkedAt : undefined,
    archived: 'archived' in game ? game.archived : undefined
  }
}

function summaryFromThread(
  threadId: number,
  title: string,
  subscriptions: Subscription[]
): GameSummary {
  const known = subscriptions.find((game) => game.threadId === threadId)
  if (known) return toSummary(known)
  return {
    threadId,
    title: title || `Thread ${threadId}`,
    creator: '',
    version: '',
    coverUrl: null,
    rating: 0,
    likes: 0,
    views: 0,
    threadUrl: `https://f95zone.to/threads/${threadId}/`
  }
}

/** Re-opening from downloads/uploads only has threadId+title — keep catalog fields already fetched. */
function mergeOpenSummary(existing: GameSummary, incoming: GameSummary): GameSummary {
  const incomingTitle =
    incoming.title && !/^Thread \d+$/i.test(incoming.title) ? incoming.title : ''
  return {
    ...existing,
    ...incoming,
    title: incomingTitle || existing.title,
    creator: incoming.creator || existing.creator,
    version: incoming.version || existing.version,
    coverUrl: incoming.coverUrl || existing.coverUrl,
    rating: incoming.rating || existing.rating,
    likes: incoming.likes || existing.likes,
    views: incoming.views || existing.views,
    threadUrl: incoming.threadUrl || existing.threadUrl,
    updatedAt: incoming.updatedAt || existing.updatedAt,
    timestamp: incoming.timestamp || existing.timestamp,
    prefixes: incoming.prefixes?.length ? incoming.prefixes : existing.prefixes,
    tags: incoming.tags?.length ? incoming.tags : existing.tags,
    engine: incoming.engine || existing.engine,
    screens: incoming.screens?.length ? incoming.screens : existing.screens,
    rarity: incoming.rarity ?? existing.rarity,
    lastPlayedVersion: incoming.lastPlayedVersion || existing.lastPlayedVersion,
    lastPlayedAt: incoming.lastPlayedAt || existing.lastPlayedAt,
    playtimeMs: incoming.playtimeMs || existing.playtimeMs,
    playedVersions: mergeVersionPlayStats(incoming.playedVersions, existing.playedVersions),
    checkedAt: incoming.checkedAt || existing.checkedAt
  }
}

function mergeCatalogSummary(existing: GameSummary, game: CatalogGame): GameSummary {
  return {
    ...existing,
    title: game.title || existing.title,
    creator: game.creator || existing.creator,
    version: game.version || existing.version,
    coverUrl: game.coverUrl || existing.coverUrl,
    rating: game.rating || existing.rating,
    likes: game.likes || existing.likes,
    views: game.views || existing.views,
    threadUrl: game.threadUrl || existing.threadUrl,
    updatedAt: game.updatedAt || existing.updatedAt,
    timestamp: game.timestamp || existing.timestamp,
    prefixes: game.prefixes?.length ? game.prefixes : existing.prefixes,
    tags: game.tags?.length ? game.tags : existing.tags,
    engine: game.engine || existing.engine,
    screens: game.screens?.length ? game.screens : existing.screens,
    checkedAt: Date.now()
  }
}

export default function App(): JSX.Element {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<AppView>('catalog')
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [roster, setRoster] = useState<RosterGame[]>([])
  const [settings, setSettings] = useState<AppSettings>({
    favoriteTags: [],
    hatedTags: [],
    downloadsDir: '',
    libraryDir: '',
    extraArchiveDirs: [],
    extraLibraryDirs: [],
    p2pEnabled: false,
    metadataApiEnabled: true,
    metadataBaseUrl: P2P_ENV_DEFAULTS.METADATA_BASE_URL,
    trackerWebRtcUrl: P2P_ENV_DEFAULTS.TRACKER_WEBRTC_URL,
    p2pUploadLimitKBps: 0,
    catalogPageSize: DEFAULT_CATALOG_PAGE_SIZE,
    cloudSavesEnabled: false,
    cloudSaveKeepCount: DEFAULT_CLOUD_SAVE_KEEP_COUNT,
    cloudSaveIncludeAutoQuick: true,
    cloudUserDataEnabled: false
  })
  const [detailsWindows, setDetailsWindows] = useState<GameSummary[]>([])
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null)
  const [detailsOpenTab, setDetailsOpenTab] = useState<{
    threadId: number
    tab: StorageOpenTab
    key: number
  } | null>(null)
  const [ignoredThreadIds, setIgnoredThreadIds] = useState<Set<number>>(() => new Set())
  const [downloads, setDownloads] = useState<DownloadRecord[]>([])
  const [p2pTransfers, setP2pTransfers] = useState<P2pTransferProgress[]>([])
  const [p2pShared, setP2pShared] = useState<TorrentMapEntry[]>([])
  const appUpdate = useAppUpdate()
  const storageScan = useStorageScan()
  const details = detailsWindows.find((game) => game.threadId === activeThreadId) ?? null
  const favoriteTags = settings.favoriteTags
  const hatedTags = settings.hatedTags ?? []
  const p2pEnabled = Boolean(settings.p2pEnabled)
  const p2pSharedHashes = useMemo(
    () => new Set(p2pShared.map((entry) => entry.contentHash.toLowerCase())),
    [p2pShared]
  )
  // Nav badge = in-progress downloads only (not background seeding/uploads)
  const activeP2pCount = p2pEnabled
    ? p2pTransfers.filter((t) => isActiveP2pDownload(t, p2pSharedHashes)).length
    : 0
  const activeDownloadCount = downloads.filter(isActiveDownload).length + activeP2pCount
  const uploadCount = p2pEnabled ? p2pShared.length : 0
  const libraryByThread = useLibraryByThread()
  const pendingDownloads = useMemo(
    () => collectThreadDownloads(downloads, p2pEnabled ? p2pTransfers : [], p2pSharedHashes),
    [downloads, p2pEnabled, p2pTransfers, p2pSharedHashes]
  )
  const libraryCount = useMemo(() => {
    let count = 0
    for (const status of libraryByThread.values()) {
      if (hasLibraryCopy(status)) count += 1
    }
    for (const threadId of pendingDownloads.keys()) {
      if (!hasLibraryCopy(libraryByThread.get(threadId))) count += 1
    }
    return count
  }, [libraryByThread, pendingDownloads])
  const rosterIds = useMemo(() => new Set(roster.map((game) => game.threadId)), [roster])
  const updatesCount = useMemo(
    () =>
      subscriptions.filter(
        (game) =>
          !ignoredThreadIds.has(game.threadId) &&
          !game.archived &&
          shouldListOnUpdatesPage(
            {
              latestVersion: game.version,
              installedVersion: libraryByThread.get(game.threadId)?.installedVersion,
              lastPlayedVersion: game.lastPlayedVersion,
              playedVersions: game.playedVersions
            },
            rosterIds.has(game.threadId)
          )
      ).length,
    [subscriptions, libraryByThread, rosterIds, ignoredThreadIds]
  )

  const followedIds = useMemo(
    () => new Set(subscriptions.map((game) => game.threadId)),
    [subscriptions]
  )
  const archivedIds = useMemo(
    () => new Set(subscriptions.filter((game) => game.archived).map((game) => game.threadId)),
    [subscriptions]
  )
  const followedPlayById = useMemo(() => {
    const map = new Map<
      number,
      { lastPlayedVersion: string; playedVersions: NonNullable<Subscription['playedVersions']> }
    >()
    for (const game of subscriptions) {
      map.set(game.threadId, {
        lastPlayedVersion: game.lastPlayedVersion,
        playedVersions: game.playedVersions
      })
    }
    return map
  }, [subscriptions])

  const loadSubscriptions = useCallback(async (): Promise<void> => {
    setSubscriptions(await window.api.subscriptions.list())
  }, [])

  const loadRoster = useCallback(async (): Promise<void> => {
    setRoster(await window.api.roster.list())
  }, [])

  const loadSettings = useCallback(async (): Promise<void> => {
    setSettings(await window.api.settings.get())
  }, [])

  const handleSaveSettings = useCallback(async (next: Partial<AppSettings>): Promise<void> => {
    setSettings(await window.api.settings.save(next))
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      focusPageSearchOnHotkey(event)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.downloads.list().then((items) => {
      if (!cancelled) setDownloads(items)
    })
    const stop = window.api.downloads.onChange((items) => {
      if (document.body.classList.contains('is-details-modal-dragging')) return
      setDownloads(items)
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  useEffect(() => {
    return window.api.subscriptions.onChange(setSubscriptions)
  }, [])

  useEffect(() => {
    return window.api.roster.onChange(setRoster)
  }, [])

  useEffect(() => {
    return window.api.settings.onChange(setSettings)
  }, [])

  const handleCancelDownload = useCallback(async (id: string): Promise<void> => {
    setDownloads(await window.api.downloads.cancel(id))
  }, [])

  const handlePauseDownload = useCallback(async (id: string): Promise<void> => {
    setDownloads(await window.api.downloads.pause(id))
  }, [])

  const handleResumeDownload = useCallback(async (id: string): Promise<void> => {
    setDownloads(await window.api.downloads.resume(id))
  }, [])

  const handleRemoveDownload = useCallback(async (id: string): Promise<void> => {
    setDownloads(await window.api.downloads.remove(id))
  }, [])

  const handleApproveDownload = useCallback(
    async (id: string, tags: PackageInstallTags): Promise<void> => {
      setDownloads(await window.api.downloads.approve(id, tags))
    },
    []
  )

  const handleRejectDownload = useCallback(async (id: string): Promise<void> => {
    setDownloads(await window.api.downloads.reject(id))
  }, [])

  const handleFlagDownload = useCallback(async (id: string): Promise<void> => {
    setDownloads(await window.api.downloads.flag(id))
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.p2p.progress().then((items) => {
      if (!cancelled) setP2pTransfers(items)
    })
    const stop = window.api.p2p.onProgress((items) => {
      if (document.body.classList.contains('is-details-modal-dragging')) return
      setP2pTransfers(items)
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadShared(): Promise<void> {
      if (!settings.p2pEnabled) {
        if (!cancelled) setP2pShared([])
        return
      }
      try {
        const rows = await window.api.p2p.listShared()
        if (!cancelled) setP2pShared(rows)
      } catch {
        if (!cancelled) setP2pShared([])
      }
    }
    void loadShared()
    const stop = window.api.p2p.onSharedChanged((rows) => {
      if (!settings.p2pEnabled) return
      setP2pShared(rows)
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [settings.p2pEnabled, p2pTransfers])

  const handlePauseP2p = useCallback(async (id: string): Promise<void> => {
    await window.api.p2p.pause(id)
  }, [])

  const handleResumeP2p = useCallback(async (id: string): Promise<void> => {
    await window.api.p2p.resume(id)
  }, [])

  const handleStopP2p = useCallback(async (id: string): Promise<void> => {
    await window.api.p2p.remove(id, true)
  }, [])

  const handleRevealQuarantine = useCallback(async (id: string): Promise<void> => {
    await window.api.p2p.revealQuarantine(id)
  }, [])

  const handleApproveQuarantine = useCallback(
    async (id: string, tags: PackageInstallTags): Promise<void> => {
      await window.api.p2p.approveQuarantine(id, tags)
      setDownloads(await window.api.downloads.list())
    },
    []
  )

  const handleRejectQuarantine = useCallback(async (id: string): Promise<void> => {
    await window.api.p2p.rejectQuarantine(id)
  }, [])

  const handleFlagQuarantine = useCallback(async (id: string): Promise<void> => {
    await window.api.p2p.flagQuarantine(id)
  }, [])


    const handleClearFinishedDownloads = useCallback(async (): Promise<void> => {
    setDownloads(await window.api.downloads.clearFinished())
  }, [])

  useEffect(() => {
    let cancelled = false

    async function restore(): Promise<void> {
      try {
        const next = await window.api.auth.getSession()
        if (next.loggedIn) {
          const [games, nextSettings, nextRoster] = await Promise.all([
            window.api.subscriptions.list(),
            window.api.settings.get(),
            window.api.roster.list()
          ])
          if (!cancelled) {
            setSubscriptions(games)
            setSettings(nextSettings)
            setRoster(nextRoster)
            setSession(next)
            void window.api.subscriptions.startSync().catch(() => undefined)
          }
        } else if (!cancelled) {
          setSession(next)
        }
      } catch (err) {
        if (!cancelled) {
          setSession({ loggedIn: false, userId: null, username: null })
          notifyError(errorMessage(err))
        }
      }
    }

    void restore()
    return () => {
      cancelled = true
    }
  }, [])

  async function handleLogin(username: string, password: string): Promise<void> {
    setBusy(true)
    try {
      const next = await window.api.auth.login({ username, password })
      setSession(next)
      await Promise.all([loadSubscriptions(), loadSettings(), loadRoster()])
      void window.api.subscriptions.startSync().catch(() => undefined)
    } catch (err) {
      notifyError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    if (view === 'uploads' && !p2pEnabled) {
      setView('downloads')
    }
  }, [view, p2pEnabled])

  const handleLogout = useCallback(async (): Promise<void> => {
    const next = await window.api.auth.logout()
    setSession(next)
    setSubscriptions([])
    setRoster([])
    setView('catalog')
    setDetailsWindows([])
    setActiveThreadId(null)
  }, [])

  const handleSessionExpired = useCallback(async (): Promise<void> => {
    setSubscriptions([])
    setRoster([])
    setView('catalog')
    setDetailsWindows([])
    setActiveThreadId(null)
    setSession({ loggedIn: false, userId: null, username: null })
    notifyError('The saved F95zone session could not be used. Please log in again.')
  }, [])

  const handleToggleFollow = useCallback(async (game: CatalogGame): Promise<void> => {
    setSubscriptions(await window.api.subscriptions.toggle(game))
  }, [])

  const handleToggleRoster = useCallback(async (game: CatalogGame): Promise<void> => {
    setRoster(await window.api.roster.toggle(game))
  }, [])

  const handleRemove = useCallback(async (threadId: number): Promise<void> => {
    setSubscriptions(await window.api.subscriptions.remove(threadId))
  }, [])

  const handleSetRarity = useCallback(async (threadId: number, rarity: GameRarity): Promise<void> => {
    setSubscriptions(await window.api.subscriptions.setRarity(threadId, rarity))
  }, [])

  const handleIgnoredChange = useCallback((threadId: number, ignored: boolean): void => {
    setIgnoredThreadIds((current) => {
      const has = current.has(threadId)
      if (ignored === has) return current
      const next = new Set(current)
      if (ignored) next.add(threadId)
      else next.delete(threadId)
      return next
    })
  }, [])

  const openDetailsWindow = useCallback((game: GameSummary, tab?: StorageOpenTab) => {
    setDetailsWindows((windows) => {
      const index = windows.findIndex((item) => item.threadId === game.threadId)
      if (index === -1) return [...windows, game]
      const next = windows.slice()
      next[index] = mergeOpenSummary(next[index], game)
      return next
    })
    setActiveThreadId(game.threadId)
    if (tab) setDetailsOpenTab({ threadId: game.threadId, tab, key: Date.now() })
  }, [])

  const applyCatalogToDetails = useCallback((game: CatalogGame) => {
    setDetailsWindows((windows) => {
      const index = windows.findIndex((item) => item.threadId === game.threadId)
      if (index === -1) return windows
      const next = windows.slice()
      next[index] = mergeCatalogSummary(next[index], game)
      return next
    })
  }, [])

  const closeDetailsWindow = useCallback((threadId: number) => {
    setDetailsWindows((windows) => windows.filter((item) => item.threadId !== threadId))
    setActiveThreadId((current) => (current === threadId ? null : current))
  }, [])

  const toggleDetailsWindow = useCallback((threadId: number) => {
    setActiveThreadId((current) => (current === threadId ? null : threadId))
  }, [])

  const minimizeDetailsWindow = useCallback(() => {
    setActiveThreadId(null)
  }, [])

  const rarityById = useMemo(() => {
    const map = new Map<number, GameRarity>()
    for (const game of subscriptions) {
      map.set(game.threadId, game.rarity)
    }
    return map
  }, [subscriptions])

  const detailsFollowed = details
    ? subscriptions.find((game) => game.threadId === details.threadId)
    : undefined

  const taskbarItems = useMemo<GameTaskbarItem[]>(
    () =>
      detailsWindows.map((game) => {
        const followed = subscriptions.find((item) => item.threadId === game.threadId)
        return {
          threadId: game.threadId,
          title: followed?.title || game.title,
          coverUrl: followed?.coverUrl || game.coverUrl
        }
      }),
    [detailsWindows, subscriptions]
  )

  const body = !session ? (
    <div className="center-screen">
      <p className="muted">Checking saved session…</p>
    </div>
  ) : !session.loggedIn ? (
    <LoginPage
      busy={busy}
      onSubmit={handleLogin}
      currentVersion={appUpdate.currentVersion}
      latestVersion={appUpdate.latestVersion}
    />
  ) : (
    <div className={view !== 'downloads' && activeDownloadCount ? 'app-shell app-shell-dock' : 'app-shell'}>
      <DownloadProgressProvider value={pendingDownloads}>
      <ConfirmHost />
      <AppNav
        view={view}
        username={session.username}
        userId={session.userId}
        followedCount={subscriptions.length}
        updatesCount={updatesCount}
        rosterCount={roster.length}
        libraryCount={libraryCount}
        downloadCount={activeDownloadCount}
        uploadCount={uploadCount}
        showUploads={p2pEnabled}
        appUpdateAvailable={appUpdate.available}
        appUpdateVersion={appUpdate.latestVersion}
        storageScanning={storageScan.scanning}
        onViewChange={(next) => {
          setView(next)
        }}
        onLogout={() => void handleLogout()}
      />
      <footer className="app-footer">
        <FooterSlot />
        <GameTaskbar
          items={taskbarItems}
          activeThreadId={activeThreadId}
          onToggle={toggleDetailsWindow}
          onClose={closeDetailsWindow}
        />
        <FooterDockSlot />
      </footer>
      <main className="app-main">
      {view === 'catalog' ? (
        <CatalogPage
          followedIds={followedIds}
          archivedIds={archivedIds}
          followedPlayById={followedPlayById}
          rarityById={rarityById}
          favoriteTags={favoriteTags}
          hatedTags={hatedTags}
          catalogPageSize={settings.catalogPageSize}
          rosterIds={rosterIds}
          onToggleFollow={handleToggleFollow}
          onToggleRoster={handleToggleRoster}
          onOpen={(game) => openDetailsWindow(toSummary(game, rarityById.get(game.threadId)))}
          onSessionExpired={handleSessionExpired}
          hiddenThreadIds={ignoredThreadIds}
        />
      ) : view === 'downloads' ? (
        <DownloadsPage
          items={downloads}
          p2pEnabled={p2pEnabled}
          p2pTransfers={p2pTransfers}
          p2pSharedHashes={p2pSharedHashes}
          onCancel={(id) => void handleCancelDownload(id)}
          onPause={(id) => void handlePauseDownload(id)}
          onResume={(id) => void handleResumeDownload(id)}
          onRemove={(id) => void handleRemoveDownload(id)}
          onShowInFolder={(id) => void window.api.downloads.showInFolder(id)}
          onOpenFile={(id) => void window.api.downloads.openFile(id)}
          onClearFinished={() => void handleClearFinishedDownloads()}
          onOpenFolder={() => void window.api.downloads.openFolder()}
          onApproveDownload={(id, tags) => void handleApproveDownload(id, tags)}
          onRejectDownload={(id) => void handleRejectDownload(id)}
          onFlagDownload={(id) => void handleFlagDownload(id)}
          onPauseP2p={(id) => void handlePauseP2p(id)}
          onResumeP2p={(id) => void handleResumeP2p(id)}
          onStopP2p={(id) => void handleStopP2p(id)}
          onRevealQuarantine={(id) => void handleRevealQuarantine(id)}
          onApproveQuarantine={(id, tags) => void handleApproveQuarantine(id, tags)}
          onRejectQuarantine={(id) => void handleRejectQuarantine(id)}
          onFlagQuarantine={(id) => void handleFlagQuarantine(id)}
          onOpenGame={(threadId, title) => {
            openDetailsWindow(summaryFromThread(threadId, title, subscriptions))
          }}
        />
      ) : view === 'uploads' ? (
        <UploadsPage
          shared={p2pShared}
          liveTransfers={p2pTransfers}
          onOpenGame={(threadId, title) => {
            openDetailsWindow(summaryFromThread(threadId, title, subscriptions))
          }}
        />
      ) : view === 'followed' ? (
        <FollowedPage
          games={subscriptions}
          favoriteTags={favoriteTags}
          hatedTags={hatedTags}
          rosterIds={rosterIds}
          onRemove={handleRemove}
          onToggleRoster={(game) => handleToggleRoster(toCatalogGame(game))}
          onOpen={(game) => openDetailsWindow(toSummary(game))}
          onImported={loadSubscriptions}
          onSessionExpired={handleSessionExpired}
          hiddenThreadIds={ignoredThreadIds}
        />
      ) : view === 'updates' ? (
        <UpdatesPage
          games={subscriptions}
          favoriteTags={favoriteTags}
          hatedTags={hatedTags}
          rosterIds={rosterIds}
          onRemove={handleRemove}
          onToggleRoster={(game) => handleToggleRoster(toCatalogGame(game))}
          onOpen={(game) => openDetailsWindow(toSummary(game))}
          onImported={loadSubscriptions}
          onSessionExpired={handleSessionExpired}
          hiddenThreadIds={ignoredThreadIds}
        />
      ) : view === 'roster' ? (
        <RosterPage
          games={roster}
          subscriptions={subscriptions}
          favoriteTags={favoriteTags}
          hatedTags={hatedTags}
          rarityById={rarityById}
          onToggleFollow={handleToggleFollow}
          onToggleRoster={handleToggleRoster}
          onOpen={(game) => openDetailsWindow(toSummary(game, rarityById.get(game.threadId)))}
          onSessionExpired={handleSessionExpired}
        />
      ) : view === 'library' ? (
        <LibraryPage
          subscriptions={subscriptions}
          favoriteTags={favoriteTags}
          hatedTags={hatedTags}
          rarityById={rarityById}
          rosterIds={rosterIds}
          onToggleFollow={handleToggleFollow}
          onToggleRoster={handleToggleRoster}
          onOpen={(game, tab) =>
            openDetailsWindow(toSummary(game, rarityById.get(game.threadId)), tab)
          }
          onSessionExpired={handleSessionExpired}
        />
      ) : view === 'storage' ? (
        <StoragePage
          onOpen={(game, tab) => {
            const known = summaryFromThread(game.threadId, game.title, subscriptions)
            openDetailsWindow(
              {
                ...known,
                title: game.title || known.title,
                creator: game.creator || known.creator,
                coverUrl: game.coverUrl || known.coverUrl,
                engine: game.engine || known.engine,
                version: game.version || known.version
              },
              tab
            )
          }}
        />
      ) : (
        <SettingsPage
          settings={settings}
          onSaveSettings={handleSaveSettings}
          onOpenThread={(threadId, title) => {
            openDetailsWindow(summaryFromThread(threadId, title, subscriptions))
          }}
          onIgnoredChange={handleIgnoredChange}
        />
      )}
      </main>
      {details ? (
        <GameDetailsPage
          key={details.threadId}
          summary={{
            ...details,
            rarity: rarityById.get(details.threadId) ?? details.rarity,
            title: detailsFollowed?.title || details.title,
            creator: detailsFollowed?.creator || details.creator,
            version: detailsFollowed?.version || details.version,
            rating: detailsFollowed?.rating ?? details.rating,
            timestamp: detailsFollowed?.timestamp ?? details.timestamp,
            likes: detailsFollowed?.likes ?? details.likes,
            views: detailsFollowed?.views ?? details.views,
            tags: detailsFollowed?.tags?.length ? detailsFollowed.tags : details.tags,
            prefixes: detailsFollowed?.prefixes?.length ? detailsFollowed.prefixes : details.prefixes,
            engine: detailsFollowed?.engine || details.engine,
            coverUrl: detailsFollowed?.coverUrl || details.coverUrl,
            lastPlayedVersion: detailsFollowed?.lastPlayedVersion ?? details.lastPlayedVersion,
            lastPlayedAt: detailsFollowed?.lastPlayedAt ?? details.lastPlayedAt,
            playtimeMs: detailsFollowed?.playtimeMs ?? details.playtimeMs,
            playedVersions: mergeVersionPlayStats(
              detailsFollowed?.playedVersions,
              details.playedVersions
            ),
            checkedAt:
              Math.max(detailsFollowed?.checkedAt || 0, details.checkedAt || 0) || undefined,
            screens: detailsFollowed?.screens?.length ? detailsFollowed.screens : details.screens,
            archived: detailsFollowed?.archived
          }}
          subscribed={followedIds.has(details.threadId)}
          rarity={rarityById.get(details.threadId) ?? details.rarity}
          favoriteTags={favoriteTags}
          hatedTags={hatedTags}
          onClose={() => closeDetailsWindow(details.threadId)}
          onMinimize={minimizeDetailsWindow}
          onOpenThread={(threadId, title) => {
            if (threadId === details.threadId) return
            openDetailsWindow(summaryFromThread(threadId, title, subscriptions))
          }}
          onApplyCatalogGame={applyCatalogToDetails}
          onToggleFollow={handleToggleFollow}
          onSetRarity={handleSetRarity}
          onIgnoredChange={handleIgnoredChange}
          onSessionExpired={handleSessionExpired}
          p2pEnabled={p2pEnabled}
          p2pSharedHashes={p2pSharedHashes}
          initialTab={
            detailsOpenTab?.threadId === details.threadId ? detailsOpenTab.tab : undefined
          }
          initialTabKey={
            detailsOpenTab?.threadId === details.threadId ? detailsOpenTab.key : 0
          }
          elevated={detailsOpenTab?.threadId === details.threadId && detailsOpenTab.tab === 'gallery'}
        />
      ) : null}
      {view === 'downloads' ? null : (
        <DownloadsDock
          items={downloads}
          p2pTransfers={p2pEnabled ? p2pTransfers : []}
          p2pSharedHashes={p2pSharedHashes}
          onOpenPage={() => {
            setActiveThreadId(null)
            setView('downloads')
          }}
          onCancel={(id) => void handleCancelDownload(id)}
          onPause={(id) => void handlePauseDownload(id)}
          onResume={(id) => void handleResumeDownload(id)}
          onRemove={(id) => void handleRemoveDownload(id)}
          onShowInFolder={(id) => void window.api.downloads.showInFolder(id)}
          onOpenFile={(id) => void window.api.downloads.openFile(id)}
          onPauseP2p={(id) => void handlePauseP2p(id)}
          onResumeP2p={(id) => void handleResumeP2p(id)}
          onStopP2p={(id) => void handleStopP2p(id)}
        />
      )}
      </DownloadProgressProvider>
    </div>
  )

  return (
    <>
      <ErrorNotificationHost />
      {body}
    </>
  )
}
