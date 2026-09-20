import { useEffect, useMemo, useState } from 'react'
import type {
  GameLibraryFile,
  IdentifiedSaveFolder,
  PlaySessionStatus,
  Subscription,
  VersionPlayStat
} from '@shared/types'
import {
  gameHasInstalledPatch,
  isInstallableLibraryPackage,
  isRenpyUncensorPackage
} from '@shared/types'
import { maxLikeCount, maxViewCount } from '@shared/counts'
import { compareGameVersions, engineKind } from '@shared/engines'
import { mergeVersionPlayStats, versionPlayStatsFromFiles } from '@shared/updates'
import type { ThreadDownloadProgress } from './downloads'

export type GameLibraryStatus = {
  hasArchive: boolean
  isInstalled: boolean
  installedVersion: string | null
  engine: string | null
  installPercent: number | null
  hasSaves: boolean
}

export type LibraryGame = {
  threadId: number
  title: string
  creator: string
  version: string
  coverUrl: string | null
  rating: number
  likes: number
  views: number
  engine: string
  prefixes: number[]
  tags: number[]
  timestamp: number
  updatedAt?: string
  threadUrl: string
  screens: string[]
  lastPlayedVersion: string
  lastPlayedAt: number
  playtimeMs: number
  playedVersions: VersionPlayStat[]
  downloadedAt: number
  /** Identified save folder with no installed copy or archive. */
  savesOnly?: boolean
}

export type LibraryExclusiveKind = 'saves' | 'archive' | 'install'

/** Exclusive storage kind, or null when the game has a mix / is still downloading. */
export function libraryExclusiveKind(
  game: Pick<LibraryGame, 'savesOnly'>,
  status?: Pick<GameLibraryStatus, 'hasArchive' | 'isInstalled'> | null
): LibraryExclusiveKind | null {
  if (game.savesOnly) return 'saves'
  const hasArchive = Boolean(status?.hasArchive)
  const isInstalled = Boolean(status?.isInstalled)
  if (hasArchive && !isInstalled) return 'archive'
  if (isInstalled && !hasArchive) return 'install'
  return null
}

export function summarizeLibrary(files: GameLibraryFile[]): Map<number, GameLibraryStatus> {
  const byThread = new Map<number, GameLibraryFile[]>()
  for (const file of files) {
    const list = byThread.get(file.threadId)
    if (list) list.push(file)
    else byThread.set(file.threadId, [file])
  }

  const result = new Map<number, GameLibraryStatus>()
  for (const [threadId, items] of byThread) {
    const installed = items.filter(
      (file) => file.isInstalled && isInstallableLibraryPackage(file.packageTags)
    )
    const latest = [...installed].sort((a, b) => {
      const versions = compareGameVersions(a.version, b.version)
      if (versions) return versions
      return (a.installedAt || 0) - (b.installedAt || 0)
    }).at(-1)
    const status: GameLibraryStatus = {
      hasArchive: items.some(
        (file) => file.hasArchive && isInstallableLibraryPackage(file.packageTags)
      ),
      isInstalled: installed.length > 0,
      installedVersion: latest?.version || null,
      engine: items.find((file) => file.engine)?.engine || null,
      installPercent: items.find((file) => file.installPercent != null)?.installPercent ?? null,
      hasSaves: false
    }
    if (
      status.hasArchive ||
      status.isInstalled ||
      status.installPercent != null ||
      items.some((file) => file.hasArchive || file.isInstalled)
    ) {
      result.set(threadId, status)
    }
  }
  return result
}

/** Installed Ren'Py game versions that can receive this uncensor patch. */
export function listUncensorPatchTargets(
  files: GameLibraryFile[],
  patch: GameLibraryFile
): GameLibraryFile[] {
  if (!isRenpyUncensorPackage(patch.packageTags)) return []
  return files
    .filter((file) => {
      if (file.threadId !== patch.threadId) return false
      if (!file.isInstalled || !isInstallableLibraryPackage(file.packageTags)) return false
      const kind = engineKind(file.engine)
      if (kind && kind !== 'renpy') return false
      return !gameHasInstalledPatch(file, patch)
    })
    .sort((a, b) => {
      const versions = compareGameVersions(a.version, b.version)
      if (versions) return versions
      return (a.installedAt || 0) - (b.installedAt || 0)
    })
}

export function gamesWithPatchInstalled(
  files: GameLibraryFile[],
  patch: GameLibraryFile
): GameLibraryFile[] {
  return files.filter(
    (file) =>
      file.threadId === patch.threadId &&
      file.isInstalled &&
      isInstallableLibraryPackage(file.packageTags) &&
      gameHasInstalledPatch(file, patch)
  )
}

const EMPTY_SAVE_STATUS: GameLibraryStatus = {
  hasArchive: false,
  isInstalled: false,
  installedVersion: null,
  engine: null,
  installPercent: null,
  hasSaves: true
}

export function saveThreadIds(folders: IdentifiedSaveFolder[]): Set<number> {
  const ids = new Set<number>()
  for (const item of folders) {
    if (item.threadId > 0) ids.add(item.threadId)
  }
  return ids
}

/** Mark identified save folders on library rows, and add save-only stubs so tiles can show the icon. */
export function withSavePresence(
  library: Map<number, GameLibraryStatus>,
  saveIds: Set<number>
): Map<number, GameLibraryStatus> {
  if (!saveIds.size) return library
  const next = new Map<number, GameLibraryStatus>()
  for (const [threadId, status] of library) {
    const hasSaves = saveIds.has(threadId)
    next.set(threadId, hasSaves === status.hasSaves ? status : { ...status, hasSaves })
  }
  for (const threadId of saveIds) {
    if (next.has(threadId)) continue
    next.set(threadId, { ...EMPTY_SAVE_STATUS })
  }
  return next
}

/** True when the game has an archive, install, or in-progress extract — not saves-only. */
export function hasLibraryCopy(status?: GameLibraryStatus | null): boolean {
  return Boolean(status && (status.hasArchive || status.isInstalled || status.installPercent != null))
}

export function useIdentifiedSaveThreadIds(): Set<number> {
  const [ids, setIds] = useState<Set<number>>(() => new Set())

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null

    function load(): void {
      void window.api.library.identifiedSaveFolders().then((items) => {
        if (!cancelled) setIds(saveThreadIds(items))
      })
    }

    function schedule(): void {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(load, 200)
    }

    load()
    const stopFolders = window.api.library.onSaveFoldersChange(() => {
      schedule()
    })
    const stopLibrary = window.api.library.onChange(() => {
      schedule()
    })
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      stopFolders()
      stopLibrary()
    }
  }, [])

  return ids
}

export function useLibraryByThread(): Map<number, GameLibraryStatus> {
  const [files, setFiles] = useState<GameLibraryFile[]>([])
  const saveIds = useIdentifiedSaveThreadIds()

  useEffect(() => {
    let cancelled = false
    void window.api.library.list().then((items) => {
      if (!cancelled) setFiles(items)
    })
    const stop = window.api.library.onChange(setFiles)
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  return useMemo(() => withSavePresence(summarizeLibrary(files), saveIds), [files, saveIds])
}

export function useLibraryFiles(): GameLibraryFile[] {
  const [files, setFiles] = useState<GameLibraryFile[]>([])

  useEffect(() => {
    let cancelled = false
    void window.api.library.list().then((items) => {
      if (!cancelled) setFiles(items)
    })
    const stop = window.api.library.onChange(setFiles)
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  return files
}

export function groupLibraryGames(
  files: GameLibraryFile[],
  subscriptions: Subscription[]
): LibraryGame[] {
  const followed = new Map(subscriptions.map((game) => [game.threadId, game]))
  const byThread = new Map<number, GameLibraryFile[]>()
  for (const file of files) {
    if (!file.hasArchive && !file.isInstalled) continue
    const list = byThread.get(file.threadId)
    if (list) list.push(file)
    else byThread.set(file.threadId, [file])
  }

  const games: LibraryGame[] = []
  for (const [threadId, items] of byThread) {
    const sub = followed.get(threadId)
    const installed = [
      ...items.filter((file) => file.isInstalled && isInstallableLibraryPackage(file.packageTags))
    ].sort((a, b) => {
      const versions = compareGameVersions(a.version, b.version)
      if (versions) return versions
      return (a.installedAt || 0) - (b.installedAt || 0)
    })
    const latestInstalled = installed.at(-1)
    const newest = [...items].sort((a, b) => b.downloadedAt - a.downloadedAt)[0]
    const lastPlayed = [...items].sort((a, b) => (a.lastPlayedAt || 0) - (b.lastPlayedAt || 0)).at(-1)
    const coverUrl =
      items.map((file) => file.coverUrl).find(Boolean) || sub?.coverUrl || null
    const prefixes =
      items.map((file) => file.prefixes).find((list) => list?.length) ||
      sub?.prefixes ||
      []
    const tags = items.map((file) => file.tags).find((list) => list?.length) || sub?.tags || []
    const screens =
      items.map((file) => file.screens).find((list) => list?.length) || sub?.screens || []
    games.push({
      threadId,
      title: items.map((file) => file.title).find((value) => value?.trim()) || sub?.title || newest.title,
      creator: items.map((file) => file.creator).find((value) => value?.trim()) || sub?.creator || '',
      version: latestInstalled?.version || newest.version,
      coverUrl,
      rating: Math.max(0, ...items.map((file) => file.rating || 0), sub?.rating || 0),
      likes: maxLikeCount(...items.map((file) => file.likes), sub?.likes),
      views: maxViewCount(...items.map((file) => file.views), sub?.views),
      engine: items.map((file) => file.engine).find(Boolean) || sub?.engine || '',
      prefixes,
      tags,
      screens,
      timestamp: Math.max(
        0,
        ...items.map((file) => file.timestamp || 0),
        sub?.timestamp || 0,
        newest.downloadedAt
      ),
      updatedAt: items.map((file) => file.updatedAt).find(Boolean) || sub?.updatedAt || '',
      threadUrl:
        items.map((file) => file.threadUrl).find(Boolean) ||
        sub?.threadUrl ||
        `https://f95zone.to/threads/${threadId}/`,
      lastPlayedVersion: lastPlayed?.lastPlayedAt
        ? lastPlayed.version
        : sub?.lastPlayedVersion || '',
      lastPlayedAt: Math.max(
        0,
        ...items.map((file) => file.lastPlayedAt || 0),
        sub?.lastPlayedAt || 0
      ),
      playtimeMs: Math.max(
        sub?.playtimeMs || 0,
        items.reduce((sum, file) => sum + (file.playtimeMs || 0), 0)
      ),
      playedVersions: mergeVersionPlayStats(
        versionPlayStatsFromFiles(items),
        sub?.playedVersions
      ),
      downloadedAt: Math.max(...items.map((file) => file.downloadedAt || 0))
    })
  }
  return games
}

/** Append in-progress downloads that do not have a library file yet. Cancelled transfers are omitted by the caller. */
export function mergeDownloadingLibraryGames(
  games: LibraryGame[],
  pending: Map<number, ThreadDownloadProgress>,
  subscriptions: Subscription[]
): LibraryGame[] {
  if (!pending.size) return games
  const existing = new Set(games.map((game) => game.threadId))
  const followed = new Map(subscriptions.map((game) => [game.threadId, game]))
  const extra: LibraryGame[] = []
  for (const [threadId, download] of pending) {
    if (existing.has(threadId)) continue
    const sub = followed.get(threadId)
    extra.push({
      threadId,
      title: (sub?.title || download.title).trim() || `Thread ${threadId}`,
      creator: sub?.creator || download.creator || '',
      version: download.version || sub?.version || '',
      coverUrl: sub?.coverUrl || download.coverUrl,
      rating: sub?.rating || 0,
      likes: sub?.likes || 0,
      views: sub?.views || 0,
      engine: sub?.engine || download.engine || '',
      prefixes: sub?.prefixes || [],
      tags: sub?.tags || [],
      screens: sub?.screens || [],
      timestamp: sub?.timestamp || 0,
      updatedAt: sub?.updatedAt || '',
      threadUrl: sub?.threadUrl || `https://f95zone.to/threads/${threadId}/`,
      lastPlayedVersion: sub?.lastPlayedVersion || '',
      lastPlayedAt: sub?.lastPlayedAt || 0,
      playtimeMs: sub?.playtimeMs || 0,
      playedVersions: sub?.playedVersions || [],
      downloadedAt: download.startedAt || 0
    })
  }
  return extra.length ? [...games, ...extra] : games
}

function emptyLibraryGame(
  threadId: number,
  partial: Partial<LibraryGame> & Pick<LibraryGame, 'title'>
): LibraryGame {
  return {
    threadId,
    creator: '',
    version: '',
    coverUrl: null,
    rating: 0,
    likes: 0,
    views: 0,
    engine: '',
    prefixes: [],
    tags: [],
    timestamp: 0,
    threadUrl: `https://f95zone.to/threads/${threadId}/`,
    screens: [],
    lastPlayedVersion: '',
    lastPlayedAt: 0,
    playtimeMs: 0,
    playedVersions: [],
    downloadedAt: 0,
    ...partial
  }
}

/** Games with identified save folders and no library archive or install. */
export function saveOnlyLibraryGames(
  items: IdentifiedSaveFolder[],
  subscriptions: Subscription[],
  excludeThreadIds: Set<number>
): LibraryGame[] {
  const followed = new Map(subscriptions.map((game) => [game.threadId, game]))
  const byThread = new Map<number, LibraryGame>()
  for (const item of items) {
    if (!item.threadId || excludeThreadIds.has(item.threadId)) continue
    const sub = followed.get(item.threadId)
    const prev = byThread.get(item.threadId)
    byThread.set(
      item.threadId,
      emptyLibraryGame(item.threadId, {
        title: sub?.title || prev?.title || item.title || item.folderName || `Thread ${item.threadId}`,
        creator: sub?.creator || prev?.creator || item.creator || '',
        coverUrl: sub?.coverUrl || prev?.coverUrl || item.coverUrl || null,
        version: sub?.version || prev?.version || item.version || '',
        rating: Math.max(prev?.rating || 0, item.rating || 0, sub?.rating || 0),
        likes: maxLikeCount(prev?.likes, item.likes, sub?.likes),
        views: maxViewCount(prev?.views, item.views, sub?.views),
        engine: sub?.engine || prev?.engine || item.engine || '',
        prefixes: sub?.prefixes?.length
          ? sub.prefixes
          : item.prefixes?.length
            ? item.prefixes
            : prev?.prefixes || [],
        tags: sub?.tags?.length ? sub.tags : item.tags?.length ? item.tags : prev?.tags || [],
        screens: sub?.screens?.length
          ? sub.screens
          : item.screens?.length
            ? item.screens
            : prev?.screens || [],
        timestamp: Math.max(prev?.timestamp || 0, item.timestamp || 0, sub?.timestamp || 0),
        updatedAt: sub?.updatedAt || prev?.updatedAt || item.updatedAt || '',
        threadUrl:
          sub?.threadUrl ||
          prev?.threadUrl ||
          item.threadUrl ||
          `https://f95zone.to/threads/${item.threadId}/`,
        lastPlayedVersion: sub?.lastPlayedVersion || prev?.lastPlayedVersion || '',
        lastPlayedAt: Math.max(prev?.lastPlayedAt || 0, sub?.lastPlayedAt || 0),
        playtimeMs: Math.max(prev?.playtimeMs || 0, sub?.playtimeMs || 0),
        playedVersions: sub?.playedVersions?.length ? sub.playedVersions : prev?.playedVersions || [],
        downloadedAt: Math.max(prev?.downloadedAt || 0, item.identifiedAt || 0),
        savesOnly: true
      })
    )
  }
  return [...byThread.values()]
}

export function useIdentifiedSaveFolders(): IdentifiedSaveFolder[] {
  const [items, setItems] = useState<IdentifiedSaveFolder[]>([])

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null

    function load(): void {
      void window.api.library.saveOnlyItems().then((next) => {
        if (!cancelled) setItems(next)
      })
    }

    function schedule(): void {
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(load, 200)
    }

    load()
    const stopFolders = window.api.library.onSaveFoldersChange(() => {
      schedule()
    })
    const stopLibrary = window.api.library.onChange(() => {
      schedule()
    })
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
      stopFolders()
      stopLibrary()
    }
  }, [])

  return items
}

export function usePlaySessions(): PlaySessionStatus[] {
  const [sessions, setSessions] = useState<PlaySessionStatus[]>([])

  useEffect(() => {
    let cancelled = false
    void window.api.library.sessions().then((items) => {
      if (!cancelled) setSessions(items)
    })
    const stop = window.api.library.onSessions(setSessions)
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  return sessions
}
