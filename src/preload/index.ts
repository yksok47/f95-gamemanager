import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  AuthSession,
  CatalogFilters,
  CatalogGame,
  CatalogLookupQuery,
  CatalogPage,
  CatalogQuery,
  CloudSaveAccount,
  CloudSaveGameDetail,
  CloudSaveGameSummary,
  CloudSaveSyncStatus,
  CloudUserDataSyncStatus,
  DownloadRecord,
  GameFileContext,
  GameLibraryFile,
  GameRarity,
  IdentifiedSaveFolder,
  RenpySaveEditPatch,
  RenpySaveEditorData,
  RpgMakerInfo,
  RpgMakerSaveEditPatch,
  RpgMakerSaveEditorData,
  LibraryStorageScan,
  LibraryStorageStats,
  LibraryImportCandidate,
  LibraryImportScanResult,
  SaveFolderPeekShot,
  ImportResult,
  LoginPayload,
  PlaySessionStatus,
  RenpyInfo,
  RenpyInfoScope,
  RenpyStatus,
  RenpyToolId,
  RosterGame,
  Subscription,
  ThreadDetails,
  ThreadReviewsPage,
  IgnoredThread,
  FollowSyncStatus,
  UnRenAction,
  VersionPlayStatus
} from '@shared/types'
import type {
  PackageFlagKind,
  PackageInstallTags,
  PackageListQuery,
  PackageListResponse,
  PackageMetadata,
  P2pTransferProgress,
  TorrentMapEntry
} from '@shared/p2p'
import type { AppUpdateStatus } from '@shared/app-update'

const api = {
  window: {
    isFullScreen: (): Promise<boolean> => ipcRenderer.invoke('window:isFullScreen'),
    toggleFullScreen: (): Promise<boolean> => ipcRenderer.invoke('window:toggleFullScreen'),
    onFullScreenChange: (listener: (fullscreen: boolean) => void): (() => void) => {
      const wrapped = (_event: unknown, fullscreen: boolean): void => listener(fullscreen)
      ipcRenderer.on('window:fullscreen-changed', wrapped)
      return () => {
        ipcRenderer.removeListener('window:fullscreen-changed', wrapped)
      }
    }
  },
  auth: {
    getSession: (): Promise<AuthSession> => ipcRenderer.invoke('auth:session'),
    login: (payload: LoginPayload): Promise<AuthSession> =>
      ipcRenderer.invoke('auth:login', payload),
    logout: (): Promise<AuthSession> => ipcRenderer.invoke('auth:logout')
  },
  catalog: {
    list: (query: CatalogQuery = {}): Promise<CatalogPage> =>
      ipcRenderer.invoke('catalog:list', query),
    filters: (): Promise<CatalogFilters> => ipcRenderer.invoke('catalog:filters'),
    lookup: (query: CatalogLookupQuery): Promise<CatalogGame | null> =>
      ipcRenderer.invoke('catalog:lookup', query)
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
    setArchived: (threadId: number, archived: boolean): Promise<Subscription[]> =>
      ipcRenderer.invoke('subscriptions:setArchived', threadId, archived),
    setRarity: (threadId: number, rarity: GameRarity): Promise<Subscription[]> =>
      ipcRenderer.invoke('subscriptions:setRarity', threadId, rarity),
    setVersionStatus: (
      threadId: number,
      version: string,
      status: VersionPlayStatus
    ): Promise<Subscription[]> =>
      ipcRenderer.invoke('subscriptions:setVersionStatus', threadId, version, status),
    sync: (): Promise<FollowSyncStatus> => ipcRenderer.invoke('subscriptions:sync'),
    cancelSync: (): Promise<FollowSyncStatus> => ipcRenderer.invoke('subscriptions:cancelSync'),
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
      ipcRenderer.invoke('threads:reviews', threadId, page),
    setIgnored: (threadId: number, ignored: boolean, href?: string | null): Promise<boolean> =>
      ipcRenderer.invoke('threads:setIgnored', threadId, ignored, href),
    listIgnored: (): Promise<IgnoredThread[]> => ipcRenderer.invoke('threads:listIgnored')
  },
  roster: {
    list: (): Promise<RosterGame[]> => ipcRenderer.invoke('roster:list'),
    toggle: (game: CatalogGame): Promise<RosterGame[]> => ipcRenderer.invoke('roster:toggle', game),
    remove: (threadId: number): Promise<RosterGame[]> => ipcRenderer.invoke('roster:remove', threadId),
    onChange: (listener: (items: RosterGame[]) => void): (() => void) => {
      const wrapped = (_event: unknown, items: RosterGame[]): void => listener(items)
      ipcRenderer.on('roster:changed', wrapped)
      return () => {
        ipcRenderer.removeListener('roster:changed', wrapped)
      }
    }
  },
  gameNotes: {
    get: (threadId: number): Promise<string> => ipcRenderer.invoke('gameNotes:get', threadId),
    set: (threadId: number, text: string): Promise<string> =>
      ipcRenderer.invoke('gameNotes:set', threadId, text),
    onChange: (listener: (notes: Record<string, string>) => void): (() => void) => {
      const wrapped = (_event: unknown, notes: Record<string, string>): void => listener(notes)
      ipcRenderer.on('game-notes:changed', wrapped)
      return () => {
        ipcRenderer.removeListener('game-notes:changed', wrapped)
      }
    }
  },
  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
    save: (settings: Partial<AppSettings>): Promise<AppSettings> =>
      ipcRenderer.invoke('settings:save', settings),
    pickFolder: (currentPath?: string): Promise<string | null> =>
      ipcRenderer.invoke('settings:pickFolder', currentPath),
    userDataPath: (): Promise<string> => ipcRenderer.invoke('settings:userDataPath'),
    openUserData: (): Promise<void> => ipcRenderer.invoke('settings:openUserData'),
    onChange: (listener: (settings: AppSettings) => void): (() => void) => {
      const wrapped = (_event: unknown, next: AppSettings): void => listener(next)
      ipcRenderer.on('settings:changed', wrapped)
      return () => {
        ipcRenderer.removeListener('settings:changed', wrapped)
      }
    }
  },
  cloudSaves: {
    account: (): Promise<CloudSaveAccount> => ipcRenderer.invoke('cloudSaves:account'),
    status: (): Promise<CloudSaveSyncStatus> => ipcRenderer.invoke('cloudSaves:status'),
    signIn: (openBrowser = true): Promise<CloudSaveAccount> =>
      ipcRenderer.invoke('cloudSaves:signIn', openBrowser),
    signOut: (): Promise<CloudSaveAccount> => ipcRenderer.invoke('cloudSaves:signOut'),
    syncAll: (): Promise<CloudSaveSyncStatus> => ipcRenderer.invoke('cloudSaves:syncAll'),
    syncThread: (threadId: number): Promise<CloudSaveSyncStatus> =>
      ipcRenderer.invoke('cloudSaves:syncThread', threadId),
    cancel: (): Promise<CloudSaveSyncStatus> => ipcRenderer.invoke('cloudSaves:cancel'),
    inventory: (): Promise<CloudSaveGameSummary[]> => ipcRenderer.invoke('cloudSaves:inventory'),
    listForThread: (threadId: number): Promise<CloudSaveGameDetail> =>
      ipcRenderer.invoke('cloudSaves:listForThread', threadId),
    deleteGame: (threadId: number): Promise<void> =>
      ipcRenderer.invoke('cloudSaves:deleteGame', threadId),
    deleteAll: (): Promise<void> => ipcRenderer.invoke('cloudSaves:deleteAll'),
    onAccount: (listener: (account: CloudSaveAccount) => void): (() => void) => {
      const wrapped = (_event: unknown, account: CloudSaveAccount): void => listener(account)
      ipcRenderer.on('cloud-saves:account', wrapped)
      return () => {
        ipcRenderer.removeListener('cloud-saves:account', wrapped)
      }
    },
    onStatus: (listener: (status: CloudSaveSyncStatus) => void): (() => void) => {
      const wrapped = (_event: unknown, next: CloudSaveSyncStatus): void => listener(next)
      ipcRenderer.on('cloud-saves:status', wrapped)
      return () => {
        ipcRenderer.removeListener('cloud-saves:status', wrapped)
      }
    },
    onInventory: (listener: () => void): (() => void) => {
      const wrapped = (): void => listener()
      ipcRenderer.on('cloud-saves:inventory-changed', wrapped)
      return () => {
        ipcRenderer.removeListener('cloud-saves:inventory-changed', wrapped)
      }
    }
  },
  cloudUserData: {
    status: (): Promise<CloudUserDataSyncStatus> => ipcRenderer.invoke('cloudUserData:status'),
    sync: (): Promise<CloudUserDataSyncStatus> => ipcRenderer.invoke('cloudUserData:sync'),
    onStatus: (listener: (status: CloudUserDataSyncStatus) => void): (() => void) => {
      const wrapped = (_event: unknown, next: CloudUserDataSyncStatus): void => listener(next)
      ipcRenderer.on('cloud-user-data:status', wrapped)
      return () => {
        ipcRenderer.removeListener('cloud-user-data:status', wrapped)
      }
    }
  },
  appUpdate: {
    get: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('appUpdate:get'),
    check: (): Promise<AppUpdateStatus> => ipcRenderer.invoke('appUpdate:check'),
    downloadAndInstall: (): Promise<AppUpdateStatus> =>
      ipcRenderer.invoke('appUpdate:downloadAndInstall'),
    onChange: (listener: (next: AppUpdateStatus) => void): (() => void) => {
      const wrapped = (_event: unknown, next: AppUpdateStatus): void => listener(next)
      ipcRenderer.on('app-update:status', wrapped)
      return () => {
        ipcRenderer.removeListener('app-update:status', wrapped)
      }
    }
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
    approve: (id: string, tags: PackageInstallTags): Promise<DownloadRecord[]> =>
      ipcRenderer.invoke('downloads:approve', id, tags),
    reject: (id: string): Promise<DownloadRecord[]> => ipcRenderer.invoke('downloads:reject', id),
    flag: (id: string, note?: string): Promise<DownloadRecord[]> =>
      ipcRenderer.invoke('downloads:flag', id, note),
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
    storageStats: (force?: boolean): Promise<LibraryStorageStats> =>
      ipcRenderer.invoke('library:storageStats', Boolean(force)),
    storageScan: (): Promise<LibraryStorageScan> => ipcRenderer.invoke('library:storageScan'),
    saveOnlyItems: (): Promise<IdentifiedSaveFolder[]> => ipcRenderer.invoke('library:saveOnlyItems'),
    identifiedSaveFolders: (): Promise<IdentifiedSaveFolder[]> =>
      ipcRenderer.invoke('library:identifiedSaveFolders'),
    onSaveFoldersChange: (listener: (items: IdentifiedSaveFolder[]) => void): (() => void) => {
      const wrapped = (_event: unknown, items: IdentifiedSaveFolder[]): void => listener(items)
      ipcRenderer.on('library:save-folders-changed', wrapped)
      return () => {
        ipcRenderer.removeListener('library:save-folders-changed', wrapped)
      }
    },
    onStorageScan: (listener: (scan: LibraryStorageScan) => void): (() => void) => {
      const wrapped = (_event: unknown, next: LibraryStorageScan): void => listener(next)
      ipcRenderer.on('library:storage-scan', wrapped)
      return () => {
        ipcRenderer.removeListener('library:storage-scan', wrapped)
      }
    },
    clearSaves: (threadId: number, savePath?: string): Promise<void> =>
      ipcRenderer.invoke('library:clearSaves', threadId, savePath),
    removeLocalData: (threadId: number): Promise<void> =>
      ipcRenderer.invoke('library:removeLocalData', threadId),
    openSaveFolder: (savePath: string): Promise<void> =>
      ipcRenderer.invoke('library:openSaveFolder', savePath),
    peekSaveFolder: (savePath: string): Promise<SaveFolderPeekShot[]> =>
      ipcRenderer.invoke('library:peekSaveFolder', savePath),
    identifySaveFolder: (savePath: string): Promise<LibraryStorageStats> =>
      ipcRenderer.invoke('library:identifySaveFolder', savePath),
    assignSaveFolder: (
      savePath: string,
      game: {
        threadId: number
        title: string
        coverUrl?: string | null
        creator?: string
        engine?: string
        version?: string
        rating?: number
        likes?: number
        views?: number
        threadUrl?: string
        prefixes?: number[]
        tags?: number[]
        timestamp?: number
        updatedAt?: string
        screens?: string[]
      }
    ): Promise<LibraryStorageStats> =>
      ipcRenderer.invoke('library:assignSaveFolder', savePath, game),
    unmapSaveFolder: (savePath: string): Promise<LibraryStorageStats> =>
      ipcRenderer.invoke('library:unmapSaveFolder', savePath),
    importExternal: (): Promise<LibraryImportScanResult> =>
      ipcRenderer.invoke('library:importExternal'),
    getImport: (filePath: string): Promise<LibraryImportCandidate | null> =>
      ipcRenderer.invoke('library:getImport', filePath),
    identifyImport: (filePath: string): Promise<LibraryImportCandidate | null> =>
      ipcRenderer.invoke('library:identifyImport', filePath),
    approveImport: (
      filePath: string,
      game: {
        threadId: number
        title: string
        coverUrl?: string | null
        creator?: string
        engine?: string
        version?: string
        rating?: number
        likes?: number
        views?: number
        threadUrl?: string
        prefixes?: number[]
        tags?: number[]
        timestamp?: number
        updatedAt?: string
        screens?: string[]
      },
      tags: PackageInstallTags
    ): Promise<LibraryStorageStats> =>
      ipcRenderer.invoke('library:approveImport', filePath, game, tags),
    dismissImport: (filePath: string): Promise<LibraryStorageStats> =>
      ipcRenderer.invoke('library:dismissImport', filePath),
    revealImport: (filePath: string): Promise<void> =>
      ipcRenderer.invoke('library:revealImport', filePath),
    install: (id: string, engine?: string): Promise<GameLibraryFile> =>
      ipcRenderer.invoke('library:install', id, engine),
    installUncensorPatch: (patchId: string, targetFileId: string): Promise<GameLibraryFile> =>
      ipcRenderer.invoke('library:installUncensorPatch', patchId, targetFileId),
    uninstallUncensorPatch: (
      gameFileId: string,
      patchRef: { patchId?: string; hash?: string; uninstallSlot?: string }
    ): Promise<GameLibraryFile> =>
      ipcRenderer.invoke('library:uninstallUncensorPatch', gameFileId, patchRef),
    showArchive: (id: string): Promise<void> => ipcRenderer.invoke('library:showArchive', id),
    showInstall: (id: string): Promise<void> => ipcRenderer.invoke('library:showInstall', id),
    relocateInstall: (id: string): Promise<GameLibraryFile> =>
      ipcRenderer.invoke('library:relocateInstall', id),
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
    info: (
      fileId: string,
      prepare = false,
      title = '',
      threadId = 0,
      scope: RenpyInfoScope = 'full'
    ): Promise<RenpyInfo> => ipcRenderer.invoke('renpy:info', fileId, prepare, title, threadId, scope),
    run: (fileId: string, action: UnRenAction): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:run', fileId, action),
    setTool: (fileId: string, tool: RenpyToolId, enabled: boolean): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:setTool', fileId, tool, enabled),
    setAllOptions: (fileId: string, enabled: boolean): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:setAllOptions', fileId, enabled),
    setOptionsGlobal: (fileId: string, enabled: boolean): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:setOptionsGlobal', fileId, enabled),
    openSaves: (fileId: string, title = '', threadId = 0): Promise<void> =>
      ipcRenderer.invoke('renpy:openSaves', fileId, title, threadId),
    chooseSaveDirectory: (fileId: string, title = '', threadId = 0): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:chooseSaveDirectory', fileId, title, threadId),
    setSaveDirectory: (fileId: string, savePath: string, title = '', threadId = 0): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:setSaveDirectory', fileId, savePath, title, threadId),
    unlinkSaveDirectory: (
      fileId: string,
      savePath: string,
      title = '',
      threadId = 0
    ): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:unlinkSaveDirectory', fileId, savePath, title, threadId),
    clearSaveDirectory: (fileId: string, title = '', threadId = 0): Promise<RenpyInfo> =>
      ipcRenderer.invoke('renpy:clearSaveDirectory', fileId, title, threadId),
    showSave: (fileId: string, savePath: string, title = ''): Promise<void> =>
      ipcRenderer.invoke('renpy:showSave', fileId, savePath, title),
    readSaveEditor: (fileId: string, savePath: string, title = ''): Promise<RenpySaveEditorData> =>
      ipcRenderer.invoke('renpy:readSaveEditor', fileId, savePath, title),
    applySaveEditor: (
      fileId: string,
      savePath: string,
      patches: RenpySaveEditPatch[],
      title = ''
    ): Promise<RenpyInfo> => ipcRenderer.invoke('renpy:applySaveEditor', fileId, savePath, patches, title),
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
    info: (
      fileId: string,
      threadId: number,
      title = '',
      which?: 'game' | 'backup'
    ): Promise<RpgMakerInfo> => ipcRenderer.invoke('rpgmaker:info', fileId, threadId, title, which),
    openSaves: (fileId: string, threadId: number, title = '', which?: 'game' | 'backup'): Promise<void> =>
      ipcRenderer.invoke('rpgmaker:openSaves', fileId, threadId, title, which),
    showSave: (fileId: string, threadId: number, savePath: string, title = ''): Promise<void> =>
      ipcRenderer.invoke('rpgmaker:showSave', fileId, threadId, savePath, title),
    readSaveEditor: (
      fileId: string,
      threadId: number,
      savePath: string,
      title = ''
    ): Promise<RpgMakerSaveEditorData> =>
      ipcRenderer.invoke('rpgmaker:readSaveEditor', fileId, threadId, savePath, title),
    applySaveEditor: (
      fileId: string,
      threadId: number,
      savePath: string,
      patches: RpgMakerSaveEditPatch[],
      title = ''
    ): Promise<RpgMakerInfo> =>
      ipcRenderer.invoke('rpgmaker:applySaveEditor', fileId, threadId, savePath, patches, title),
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
        gameVersion?: string | null
        f95ThreadId?: number | null
        f95ThreadUrl?: string | null
      }
    ): Promise<P2pTransferProgress> => ipcRenderer.invoke('p2p:seed', filePath, meta),
    remove: (id: string, deleteFiles?: boolean): Promise<void> =>
      ipcRenderer.invoke('p2p:remove', id, Boolean(deleteFiles)),
    pause: (id: string): Promise<P2pTransferProgress | null> => ipcRenderer.invoke('p2p:pause', id),
    resume: (id: string): Promise<P2pTransferProgress | null> => ipcRenderer.invoke('p2p:resume', id),
    progress: (): Promise<P2pTransferProgress[]> => ipcRenderer.invoke('p2p:progress'),
    listShared: (): Promise<TorrentMapEntry[]> => ipcRenderer.invoke('p2p:listShared'),
    seedAll: (): Promise<{ started: number; errors: string[] }> => ipcRenderer.invoke('p2p:seedAll'),
    listPackages: (query: PackageListQuery): Promise<PackageListResponse> =>
      ipcRenderer.invoke('p2p:listPackages', query),
    getPackage: (contentHash: string): Promise<PackageMetadata | null> =>
      ipcRenderer.invoke('p2p:getPackage', contentHash),
    downloadByHash: (contentHash: string): Promise<P2pTransferProgress> =>
      ipcRenderer.invoke('p2p:downloadByHash', contentHash),
    flag: (contentHash: string, kind: PackageFlagKind, note?: string): Promise<PackageMetadata> =>
      ipcRenderer.invoke('p2p:flag', contentHash, kind, note),
    approveQuarantine: (id: string, tags: PackageInstallTags): Promise<void> =>
      ipcRenderer.invoke('p2p:approveQuarantine', id, tags),
    rejectQuarantine: (id: string): Promise<void> =>
      ipcRenderer.invoke('p2p:rejectQuarantine', id),
    revealQuarantine: (id: string): Promise<string> =>
      ipcRenderer.invoke('p2p:revealQuarantine', id),
    flagQuarantine: (id: string, note?: string): Promise<void> =>
      ipcRenderer.invoke('p2p:flagQuarantine', id, note),
    onProgress: (listener: (items: P2pTransferProgress[]) => void): (() => void) => {
      const wrapped = (_event: unknown, items: P2pTransferProgress[]): void => listener(items)
      ipcRenderer.on('p2p:progress', wrapped)
      return () => {
        ipcRenderer.removeListener('p2p:progress', wrapped)
      }
    },
    onSharedChanged: (listener: (items: TorrentMapEntry[]) => void): (() => void) => {
      const wrapped = (_event: unknown, items: TorrentMapEntry[]): void => listener(items)
      ipcRenderer.on('p2p:shared-changed', wrapped)
      return () => {
        ipcRenderer.removeListener('p2p:shared-changed', wrapped)
      }
    }
  }
}

export type GameManagerApi = typeof api

contextBridge.exposeInMainWorld('api', api)
