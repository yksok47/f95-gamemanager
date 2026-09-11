import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  AuthSession,
  CatalogFilters,
  CatalogGame,
  CatalogPage,
  CatalogQuery,
  DownloadRecord,
  GameFileContext,
  GameLibraryFile,
  GameRarity,
  ImportResult,
  LoginPayload,
  PlaySessionStatus,
  RenpyInfo,
  RenpyStatus,
  RenpyToolId,
  RpgMakerInfo,
  Subscription,
  ThreadDetails,
  ThreadReviewsPage,
  FollowSyncStatus,
  UnRenAction
} from '@shared/types'
import type {
  PackageFlagKind,
  PackageMetadata,
  P2pDownloadOptionStub,
  P2pTransferProgress
} from '@shared/p2p'

const api = {
  auth: {
    getSession: (): Promise<AuthSession> => ipcRenderer.invoke('auth:session'),
    login: (payload: LoginPayload): Promise<AuthSession> =>
      ipcRenderer.invoke('auth:login', payload),
    logout: (): Promise<AuthSession> => ipcRenderer.invoke('auth:logout')
  },
  catalog: {
    list: (query: CatalogQuery = {}): Promise<CatalogPage> =>
      ipcRenderer.invoke('catalog:list', query),
    filters: (): Promise<CatalogFilters> => ipcRenderer.invoke('catalog:filters')
  },
  subscriptions: {
    list: (): Promise<Subscription[]> => ipcRenderer.invoke('subscriptions:list'),
    toggle: (game: CatalogGame): Promise<Subscription[]> =>
      ipcRenderer.invoke('subscriptions:toggle', game),
    remove: (threadId: number): Promise<Subscription[]> =>
      ipcRenderer.invoke('subscriptions:remove', threadId),
    importWatched: (): Promise<ImportResult> => ipcRenderer.invoke('subscriptions:importWatched'),
    importBookmarks: (): Promise<ImportResult> => ipcRenderer.invoke('subscriptions:importBookmarks'),
    refresh: (threadId: number): Promise<Subscription[]> =>
      ipcRenderer.invoke('subscriptions:refresh', threadId),
    setRarity: (threadId: number, rarity: GameRarity): Promise<Subscription[]> =>
      ipcRenderer.invoke('subscriptions:setRarity', threadId, rarity),
    sync: (): Promise<FollowSyncStatus> => ipcRenderer.invoke('subscriptions:sync'),
    startSync: (): Promise<FollowSyncStatus> => ipcRenderer.invoke('subscriptions:startSync'),
    syncStatus: (): Promise<FollowSyncStatus> => ipcRenderer.invoke('subscriptions:syncStatus'),
    onChange: (listener: (items: Subscription[]) => void): (() => void) => {
      const wrapped = (_event: unknown, items: Subscription[]): void => listener(items)
      ipcRenderer.on('subscriptions:changed', wrapped)
      return () => {
        ipcRenderer.removeListener('subscriptions:changed', wrapped)
      }
    },
    onSyncStatus: (listener: (status: FollowSyncStatus) => void): (() => void) => {
      const wrapped = (_event: unknown, next: FollowSyncStatus): void => listener(next)
      ipcRenderer.on('follow-sync:status', wrapped)
      return () => {
        ipcRenderer.removeListener('follow-sync:status', wrapped)
      }
    }
  },
  threads: {
    details: (threadId: number): Promise<ThreadDetails> => ipcRenderer.invoke('threads:details', threadId),
    reviews: (threadId: number, page = 1): Promise<ThreadReviewsPage> =>
      ipcRenderer.invoke('threads:reviews', threadId, page)
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    save: (settings: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:save', settings),
    pickFolder: (currentPath?: string): Promise<string | null> =>
      ipcRenderer.invoke('settings:pickFolder', currentPath)
  },
  downloads: {
    list: (): Promise<DownloadRecord[]> => ipcRenderer.invoke('downloads:list'),
    cancel: (id: string): Promise<DownloadRecord[]> => ipcRenderer.invoke('downloads:cancel', id),
    pause: (id: string): Promise<DownloadRecord[]> => ipcRenderer.invoke('downloads:pause', id),
    resume: (id: string): Promise<DownloadRecord[]> => ipcRenderer.invoke('downloads:resume', id),
    remove: (id: string): Promise<DownloadRecord[]> => ipcRenderer.invoke('downloads:remove', id),
    clearFinished: (): Promise<DownloadRecord[]> => ipcRenderer.invoke('downloads:clearFinished'),
    showInFolder: (id: string): Promise<void> => ipcRenderer.invoke('downloads:showInFolder', id),
    openFile: (id: string): Promise<void> => ipcRenderer.invoke('downloads:openFile', id),
    openFolder: (): Promise<void> => ipcRenderer.invoke('downloads:openFolder'),
    onChange: (listener: (items: DownloadRecord[]) => void): (() => void) => {
      const wrapped = (_event: unknown, items: DownloadRecord[]): void => listener(items)
      ipcRenderer.on('downloads:changed', wrapped)
      return () => {
        ipcRenderer.removeListener('downloads:changed', wrapped)
      }
    }
  },
  library: {
    list: (threadId?: number): Promise<GameLibraryFile[]> =>
      ipcRenderer.invoke('library:list', threadId),
    diskUsage: (threadId: number): Promise<{ archiveBytes: number; installBytes: number }> =>
      ipcRenderer.invoke('library:diskUsage', threadId),
    install: (id: string, engine?: string): Promise<GameLibraryFile> =>
      ipcRenderer.invoke('library:install', id, engine),
    showArchive: (id: string): Promise<void> => ipcRenderer.invoke('library:showArchive', id),
    showInstall: (id: string): Promise<void> => ipcRenderer.invoke('library:showInstall', id),
    play: (id: string, engine?: string): Promise<GameLibraryFile> =>
      ipcRenderer.invoke('library:play', id, engine),
    playLatest: (threadId: number, engine?: string): Promise<GameLibraryFile> =>
      ipcRenderer.invoke('library:playLatest', threadId, engine),
    stop: (id: string): Promise<PlaySessionStatus[]> => ipcRenderer.invoke('library:stop', id),
    sessions: (): Promise<PlaySessionStatus[]> => ipcRenderer.invoke('library:playSessions'),
    pickExecutable: (id: string): Promise<GameLibraryFile> =>
      ipcRenderer.invoke('library:pickExecutable', id),
    uninstall: (id: string): Promise<GameLibraryFile> => ipcRenderer.invoke('library:uninstall', id),
    removeArchive: (id: string): Promise<GameLibraryFile> =>
      ipcRenderer.invoke('library:removeArchive', id),
    removeVersion: (id: string): Promise<GameLibraryFile[]> =>
      ipcRenderer.invoke('library:removeVersion', id),
    onChange: (listener: (items: GameLibraryFile[]) => void): (() => void) => {
      const wrapped = (_event: unknown, items: GameLibraryFile[]): void => listener(items)
      ipcRenderer.on('library:changed', wrapped)
      return () => {
        ipcRenderer.removeListener('library:changed', wrapped)
      }
    },
    onSessions: (listener: (items: PlaySessionStatus[]) => void): (() => void) => {
      const wrapped = (_event: unknown, items: PlaySessionStatus[]): void => listener(items)
      ipcRenderer.on('play:sessions', wrapped)
      return () => {
        ipcRenderer.removeListener('play:sessions', wrapped)
      }
    }
  },
  renpy: {
    info: (fileId: string, prepare = false, title = ''): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:info', fileId, prepare, title),
    run: (fileId: string, action: UnRenAction): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:run', fileId, action),
    setTool: (fileId: string, tool: RenpyToolId, enabled: boolean): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:setTool', fileId, tool, enabled),
    setAllOptions: (fileId: string, enabled: boolean): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:setAllOptions', fileId, enabled),
    openSaves: (fileId: string, title = ''): Promise<void> =>
      ipcRenderer.invoke('renpy:openSaves', fileId, title),
    showSave: (fileId: string, savePath: string, title = ''): Promise<void> =>
      ipcRenderer.invoke('renpy:showSave', fileId, savePath, title),
    deleteSave: (fileId: string, savePath: string, title = ''): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:deleteSave', fileId, savePath, title),
    deleteSaves: (fileId: string, savePaths: string[], title = ''): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:deleteSaves', fileId, savePaths, title),
    moveSave: (fileId: string, savePath: string, page: string, slot: number, title = ''): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:moveSave', fileId, savePath, page, slot, title),
    renumberPage: (fileId: string, fromPage: string, toPage: string, title = ''): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:renumberPage', fileId, fromPage, toPage, title),
    onStatus: (listener: (status: RenpyStatus) => void): (() => void) => {
      const wrapped = (_event: unknown, status: RenpyStatus): void => listener(status)
      ipcRenderer.on('renpy:status', wrapped)
      return () => {
        ipcRenderer.removeListener('renpy:status', wrapped)
      }
    }
  },
  rpgmaker: {
    info: (fileId: string, threadId: number, title = ''): Promise<RpgMakerInfo> =>
      ipcRenderer.invoke('rpgmaker:info', fileId, threadId, title),
    openSaves: (fileId: string, threadId: number, title = '', which?: 'game' | 'backup'): Promise<void> =>
      ipcRenderer.invoke('rpgmaker:openSaves', fileId, threadId, title, which),
    showSave: (fileId: string, threadId: number, savePath: string, title = ''): Promise<void> =>
      ipcRenderer.invoke('rpgmaker:showSave', fileId, threadId, savePath, title),
    deleteSaves: (fileId: string, threadId: number, savePaths: string[], title = ''): Promise<RpgMakerInfo> =>
      ipcRenderer.invoke('rpgmaker:deleteSaves', fileId, threadId, savePaths, title)
  },
  shell: {
    open: (url: string, context?: GameFileContext): Promise<void> =>
      ipcRenderer.invoke('shell:open', url, context)
  },
  p2p: {
    status: (): Promise<unknown> => ipcRenderer.invoke('p2p:status'),
    add: (magnetOrPath: string, contentHash?: string): Promise<P2pTransferProgress> =>
      ipcRenderer.invoke('p2p:add', magnetOrPath, contentHash),
    seed: (
      filePath: string,
      meta?: {
        contentHash?: string
        gameName?: string
        f95ThreadId?: number | null
        f95ThreadUrl?: string | null
      }
    ): Promise<P2pTransferProgress> => ipcRenderer.invoke('p2p:seed', filePath, meta),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('p2p:remove', id),
    progress: (): Promise<P2pTransferProgress[]> => ipcRenderer.invoke('p2p:progress'),
    seedAll: (): Promise<{ started: number; errors: string[] }> => ipcRenderer.invoke('p2p:seedAll'),
    downloadOptions: (filename: string): Promise<P2pDownloadOptionStub[]> =>
      ipcRenderer.invoke('p2p:downloadOptions', filename),
    flag: (contentHash: string, kind: PackageFlagKind, note?: string): Promise<PackageMetadata> =>
      ipcRenderer.invoke('p2p:flag', contentHash, kind, note),
    onProgress: (listener: (items: P2pTransferProgress[]) => void): (() => void) => {
      const wrapped = (_event: unknown, items: P2pTransferProgress[]): void => listener(items)
      ipcRenderer.on('p2p:progress', wrapped)
      return () => {
        ipcRenderer.removeListener('p2p:progress', wrapped)
      }
    }
  }
}

export type GameManagerApi = typeof api

contextBridge.exposeInMainWorld('api', api)
