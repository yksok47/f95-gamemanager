import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { pickLikeCount, pickViewCount } from '@shared/counts'
import type {
  AppSettings,
  AuthSession,
  CatalogGame,
  DownloadRecord,
  GameRarity,
  GameSummary,
  Subscription
} from '@shared/types'
import AppNav, { type AppView } from './components/AppNav'
import { ConfirmHost } from './components/ConfirmDialog'
import DownloadsDock from './components/DownloadsDock'
import { FooterSlot } from './components/FooterPortal'
import CatalogPage from './pages/CatalogPage'
import DownloadsPage from './pages/DownloadsPage'
import { P2P_ENV_DEFAULTS, type P2pTransferProgress, type TorrentMapEntry } from '@shared/p2p'
import FollowedPage from './pages/FollowedPage'
import LibraryPage from './pages/LibraryPage'
import GameDetailsPage from './pages/GameDetailsPage'
import LoginPage from './pages/LoginPage'
import SettingsPage from './pages/SettingsPage'
import { isActiveDownload } from './lib/downloads'
import { useLibraryByThread, type LibraryGame } from './lib/library'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.'
}

function toSummary(
  game: CatalogGame | Subscription | LibraryGame,
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
    checkedAt: 'checkedAt' in game ? game.checkedAt : undefined
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

export default function App(): JSX.Element {
  const [session, setSession] = useState<AuthSession | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<AppView>('catalog')
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [settings, setSettings] = useState<AppSettings>({
    favoriteTags: [],
    hatedTags: [],
    downloadsDir: '',
    libraryDir: '',
    p2pEnabled: false,
    metadataBaseUrl: P2P_ENV_DEFAULTS.METADATA_BASE_URL,
    trackerWebRtcUrl: P2P_ENV_DEFAULTS.TRACKER_WEBRTC_URL,
    p2pUploadLimitKBps: 0
  })
  const [detailsStack, setDetailsStack] = useState<GameSummary[]>([])
  const [downloads, setDownloads] = useState<DownloadRecord[]>([])
  const [p2pTransfers, setP2pTransfers] = useState<P2pTransferProgress[]>([])
  const [p2pShared, setP2pShared] = useState<TorrentMapEntry[]>([])
  const details = detailsStack.at(-1) ?? null
  const favoriteTags = settings.favoriteTags
  const hatedTags = settings.hatedTags ?? []
// Nav badge = in-progress downloads only (not background seeding/uploads)
  const activeP2pCount = settings.p2pEnabled
    ? p2pTransfers.filter(
        (t) =>
          t.state === 'connecting' ||
          t.state === 'downloading' ||
          t.state === 'checking' ||
          t.state === 'paused' ||
          t.state === 'quarantined'
      ).length
    : 0
  const activeDownloadCount = downloads.filter(isActiveDownload).length + activeP2pCount
  const libraryByThread = useLibraryByThread()
  const libraryCount = libraryByThread.size

  const followedIds = useMemo(
    () => new Set(subscriptions.map((game) => game.threadId)),
    [subscriptions]
  )

  const loadSubscriptions = useCallback(async (): Promise<void> => {
    setSubscriptions(await window.api.subscriptions.list())
  }, [])

  const loadSettings = useCallback(async (): Promise<void> => {
    setSettings(await window.api.settings.get())
  }, [])

  const handleSaveSettings = useCallback(async (next: Partial<AppSettings>): Promise<void> => {
    setSettings(await window.api.settings.save(next))
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.downloads.list().then((items) => {
      if (!cancelled) setDownloads(items)
    })
    const stop = window.api.downloads.onChange((items) => {
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

  useEffect(() => {
    let cancelled = false
    void window.api.p2p.progress().then((items) => {
      if (!cancelled) setP2pTransfers(items)
    })
    const stop = window.api.p2p.onProgress((items) => {
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

  const handleApproveQuarantine = useCallback(async (id: string): Promise<void> => {
    await window.api.p2p.approveQuarantine(id)
    setDownloads(await window.api.downloads.list())
  }, [])

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
          const [games, nextSettings] = await Promise.all([
            window.api.subscriptions.list(),
            window.api.settings.get()
          ])
          if (!cancelled) {
            setSubscriptions(games)
            setSettings(nextSettings)
            setSession(next)
            void window.api.subscriptions.startSync().catch(() => undefined)
          }
        } else if (!cancelled) {
          setSession(next)
        }
      } catch (err) {
        if (!cancelled) {
          setSession({ loggedIn: false, userId: null, username: null })
          setError(errorMessage(err))
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
    setError(null)
    try {
      const next = await window.api.auth.login({ username, password })
      setSession(next)
      await Promise.all([loadSubscriptions(), loadSettings()])
      void window.api.subscriptions.startSync().catch(() => undefined)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleLogout = useCallback(async (): Promise<void> => {
    setError(null)
    const next = await window.api.auth.logout()
    setSession(next)
    setSubscriptions([])
    setView('catalog')
    setDetailsStack([])
  }, [])

  const handleSessionExpired = useCallback(async (): Promise<void> => {
    setSubscriptions([])
    setView('catalog')
    setDetailsStack([])
    setSession({ loggedIn: false, userId: null, username: null })
    setError('The saved F95zone session could not be used. Please log in again.')
  }, [])

  const handleToggleFollow = useCallback(async (game: CatalogGame): Promise<void> => {
    setSubscriptions(await window.api.subscriptions.toggle(game))
  }, [])

  const handleRemove = useCallback(async (threadId: number): Promise<void> => {
    setSubscriptions(await window.api.subscriptions.remove(threadId))
  }, [])

  const handleRefresh = useCallback(async (threadId: number): Promise<void> => {
    setSubscriptions(await window.api.subscriptions.refresh(threadId))
  }, [])

  const handleSetRarity = useCallback(async (threadId: number, rarity: GameRarity): Promise<void> => {
    setSubscriptions(await window.api.subscriptions.setRarity(threadId, rarity))
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

  if (!session) {
    return (
      <div className="center-screen">
        <p className="muted">Checking saved session…</p>
      </div>
    )
  }

  if (!session.loggedIn) {
    return <LoginPage busy={busy} error={error} onSubmit={handleLogin} />
  }

  return (
    <div className={view !== 'downloads' && activeDownloadCount ? 'app-shell app-shell-dock' : 'app-shell'}>
      <ConfirmHost />
      <AppNav
        view={view}
        username={session.username}
        userId={session.userId}
        followedCount={subscriptions.length}
        libraryCount={libraryCount}
        downloadCount={activeDownloadCount}
        onViewChange={(next) => {
          setDetailsStack([])
          setView(next)
        }}
        onLogout={() => void handleLogout()}
      />
      <footer className="app-footer">
        <FooterSlot />
      </footer>
      <main className="app-main">
      {view === 'catalog' ? (
        <CatalogPage
          followedIds={followedIds}
          rarityById={rarityById}
          favoriteTags={favoriteTags}
          hatedTags={hatedTags}
          onToggleFollow={handleToggleFollow}
          onOpen={(game) => setDetailsStack([toSummary(game, rarityById.get(game.threadId))])}
          onSessionExpired={handleSessionExpired}
        />
      ) : view === 'downloads' ? (
        <DownloadsPage
          items={downloads}
          p2pEnabled={Boolean(settings.p2pEnabled)}
          p2pTransfers={p2pTransfers}
          p2pShared={p2pShared}
          onCancel={(id) => void handleCancelDownload(id)}
          onPause={(id) => void handlePauseDownload(id)}
          onResume={(id) => void handleResumeDownload(id)}
          onRemove={(id) => void handleRemoveDownload(id)}
          onShowInFolder={(id) => void window.api.downloads.showInFolder(id)}
          onOpenFile={(id) => void window.api.downloads.openFile(id)}
          onClearFinished={() => void handleClearFinishedDownloads()}
          onOpenFolder={() => void window.api.downloads.openFolder()}
          onPauseP2p={(id) => void handlePauseP2p(id)}
          onResumeP2p={(id) => void handleResumeP2p(id)}
          onStopP2p={(id) => void handleStopP2p(id)}
          onRevealQuarantine={(id) => void handleRevealQuarantine(id)}
          onApproveQuarantine={(id) => void handleApproveQuarantine(id)}
          onRejectQuarantine={(id) => void handleRejectQuarantine(id)}
          onFlagQuarantine={(id) => void handleFlagQuarantine(id)}
          onOpenGame={(threadId, title) => {
            setDetailsStack([summaryFromThread(threadId, title, subscriptions)])
          }}
        />
      ) : view === 'followed' ? (
        <FollowedPage
          games={subscriptions}
          favoriteTags={favoriteTags}
          hatedTags={hatedTags}
          onRemove={handleRemove}
          onOpen={(game) => setDetailsStack([toSummary(game)])}
          onImported={loadSubscriptions}
          onSessionExpired={handleSessionExpired}
        />
      ) : view === 'library' ? (
        <LibraryPage
          subscriptions={subscriptions}
          favoriteTags={favoriteTags}
          hatedTags={hatedTags}
          rarityById={rarityById}
          onToggleFollow={handleToggleFollow}
          onOpen={(game) => setDetailsStack([toSummary(game, rarityById.get(game.threadId))])}
          onSessionExpired={handleSessionExpired}
        />
      ) : (
        <SettingsPage settings={settings} onSaveSettings={handleSaveSettings} />
      )}
      </main>
      {details ? (
        <GameDetailsPage
          summary={{
            ...details,
            rarity: rarityById.get(details.threadId) ?? details.rarity,
            version: detailsFollowed?.version || details.version,
            timestamp: detailsFollowed?.timestamp ?? details.timestamp,
            likes: pickLikeCount(details.likes, detailsFollowed?.likes),
            views: pickViewCount(details.views, detailsFollowed?.views),
            lastPlayedVersion: detailsFollowed?.lastPlayedVersion ?? details.lastPlayedVersion,
            lastPlayedAt: detailsFollowed?.lastPlayedAt ?? details.lastPlayedAt,
            playtimeMs: detailsFollowed?.playtimeMs ?? details.playtimeMs,
            checkedAt: detailsFollowed?.checkedAt ?? details.checkedAt,
            screens: detailsFollowed?.screens?.length ? detailsFollowed.screens : details.screens
          }}
          subscribed={followedIds.has(details.threadId)}
          rarity={rarityById.get(details.threadId) ?? details.rarity}
          favoriteTags={favoriteTags}
          hatedTags={hatedTags}
          onClose={() => setDetailsStack((stack) => stack.slice(0, -1))}
          onOpenThread={(threadId, title) => {
            if (threadId === details.threadId) return
            setDetailsStack((stack) => [...stack, summaryFromThread(threadId, title, subscriptions)])
          }}
          onToggleFollow={handleToggleFollow}
          onRefresh={handleRefresh}
          onSetRarity={handleSetRarity}
          onSessionExpired={handleSessionExpired}
          p2pEnabled={Boolean(settings.p2pEnabled)}
        />
      ) : null}
      {view === 'downloads' ? null : (
        <DownloadsDock
          items={downloads}
          onOpenPage={() => {
            setDetailsStack([])
            setView('downloads')
          }}
          onCancel={(id) => void handleCancelDownload(id)}
          onPause={(id) => void handlePauseDownload(id)}
          onResume={(id) => void handleResumeDownload(id)}
          onRemove={(id) => void handleRemoveDownload(id)}
          onShowInFolder={(id) => void window.api.downloads.showInFolder(id)}
          onOpenFile={(id) => void window.api.downloads.openFile(id)}
        />
      )}
    </div>
  )
}
