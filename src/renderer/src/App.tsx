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
import DownloadsDock from './components/DownloadsDock'
import CatalogPage from './pages/CatalogPage'
import DownloadsPage from './pages/DownloadsPage'
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
    downloadsDir: '',
    libraryDir: '',
    p2pEnabled: false
  })
  const [detailsStack, setDetailsStack] = useState<GameSummary[]>([])
  const [downloads, setDownloads] = useState<DownloadRecord[]>([])
  const details = detailsStack.at(-1) ?? null
  const favoriteTags = settings.favoriteTags
  const activeDownloadCount = downloads.filter(isActiveDownload).length
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
      {view === 'catalog' ? (
        <CatalogPage
          followedIds={followedIds}
          rarityById={rarityById}
          favoriteTags={favoriteTags}
          onToggleFollow={handleToggleFollow}
          onOpen={(game) => setDetailsStack([toSummary(game, rarityById.get(game.threadId))])}
          onSessionExpired={handleSessionExpired}
        />
      ) : view === 'downloads' ? (
        <DownloadsPage
          items={downloads}
          onCancel={(id) => void handleCancelDownload(id)}
          onPause={(id) => void handlePauseDownload(id)}
          onResume={(id) => void handleResumeDownload(id)}
          onRemove={(id) => void handleRemoveDownload(id)}
          onShowInFolder={(id) => void window.api.downloads.showInFolder(id)}
          onOpenFile={(id) => void window.api.downloads.openFile(id)}
          onClearFinished={() => void handleClearFinishedDownloads()}
          onOpenFolder={() => void window.api.downloads.openFolder()}
        />
      ) : view === 'followed' ? (
        <FollowedPage
          games={subscriptions}
          favoriteTags={favoriteTags}
          onRemove={handleRemove}
          onOpen={(game) => setDetailsStack([toSummary(game)])}
          onImported={loadSubscriptions}
          onSessionExpired={handleSessionExpired}
        />
      ) : view === 'library' ? (
        <LibraryPage
          subscriptions={subscriptions}
          favoriteTags={favoriteTags}
          rarityById={rarityById}
          onToggleFollow={handleToggleFollow}
          onOpen={(game) => setDetailsStack([toSummary(game, rarityById.get(game.threadId))])}
          onSessionExpired={handleSessionExpired}
        />
      ) : (
        <SettingsPage settings={settings} onSaveSettings={handleSaveSettings} />
      )}
      {details ? (
        <GameDetailsPage
              p2pEnabled={settings.p2pEnabled}
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
          onClose={() => setDetailsStack((stack) => stack.slice(0, -1))}
          onOpenThread={(threadId, title) => {
            if (threadId === details.threadId) return
            setDetailsStack((stack) => [...stack, summaryFromThread(threadId, title, subscriptions)])
          }}
          onToggleFollow={handleToggleFollow}
          onRefresh={handleRefresh}
          onSetRarity={handleSetRarity}
          onSessionExpired={handleSessionExpired}
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
