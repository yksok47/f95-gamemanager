import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type {
  AppSettings,
  CatalogGame,
  CatalogLookupQuery,
  CatalogQuery,
  GameFileContext,
  GameRarity,
  LoginPayload,
  RenpyInfoScope,
  RenpyToolId,
  UnRenAction,
  VersionPlayStatus
} from '@shared/types'
import {
  applyConfiguredDownloadPath,
  approveDownload,
  cancelDownload,
  clearFinishedDownloads,
  flagDownload,
  listDownloads,
  openDownload,
  openDownloadsFolder,
  pauseDownload,
  rejectDownload,
  removeDownload,
  resumeDownload,
  showDownloadInFolder
} from './downloads'
import { F95Error } from './f95/http'
import { getAuthSession, login, logout } from './f95/auth'
import { fetchCatalog, fetchCatalogFilters } from './f95/catalog'
import { importBookmarks, importWatchedThreads } from './f95/import'
import { lookupCatalogGame } from './f95/lookup'
import { fetchThreadDetails, fetchThreadReviews, invalidateThreadDetailsCache } from './f95/thread'
import { listIgnoredThreads, setThreadIgnored } from './f95/ignore'
import {
  applyThreadMetadata,
  applyCatalogScreens as applyLibraryCatalogScreens,
  chooseGameExecutable,
  installGameFile,
  installUncensorPatch,
  uninstallUncensorPatch,
  listGameFiles,
  gameDiskUsage,
  metadataFromSubscription,
  playGameFile,
  playLatestGameFile,
  relocateGameInstall,
  removeGameArchive,
  removeGameVersion,
  showGameArchive,
  showGameInstall,
  uninstallGameFile,
  updateGameFileTags
} from './game-files-store'
import { getGameNote, setGameNote } from './game-notes-store'
import {
  applyCatalogGamesToRoster,
  listRoster,
  removeFromRoster,
  reorderRoster,
  toggleRoster
} from './roster-store'
import { listPlaySessions, stopPlaySession } from './play-sessions'
import {
  applyRpgMakerSaveEditor,
  deleteRpgMakerSaves,
  getRpgMakerInfo,
  openRpgMakerSaves,
  readRpgMakerSaveEditor,
  showRpgMakerSave
} from './rpgmaker/saves'
import {
  applyRenpySaveEditor,
  chooseRenpySaveDirectory,
  clearRenpySaveDirectory,
  deleteRenpySave,
  deleteRenpySaves,
  getRenpyInfo,
  moveRenpySave,
  openRenpySaves,
  readRenpySaveEditor,
  renumberRenpyPage,
  runRenpyAction,
  setAllRenpyToolsForFile,
  setRenpyOptionsGlobalForFile,
  setRenpySaveLocation,
  setRenpyToolForFile,
  showRenpySave,
  unlinkRenpySaveLocation
} from './renpy/saves'
import { getAppPaths } from './paths'
import {
  applySaveFolderIdentityToScan,
  clearGameSaves,
  getLibraryStorageScan,
  requestLibraryStorageStats
} from './storage-stats'
import {
  assignSaveFolder,
  identifySaveFolder,
  unmapSaveFolder,
  listSaveFolderPeek,
  listPresentIdentifiedSaveFolders,
  listSaveOnlyItems,
  openManagedSaveFolder,
  removeGameLocalData
} from './save-folders'
import {
  approvePendingImport,
  dismissPendingImport,
  getPendingImport,
  identifyPendingImport,
  revealImportPath,
  scanExternalLibraries
} from './library-import'
import { getSettings, saveSettings } from './settings-store'
import { portableSettingKeysChanged } from './cloud-user-data/snapshot'
import { bumpSettingTimes } from './cloud-user-data/state'
import {
  getCloudUserDataStatus,
  notifyUserDataChanged,
  notifyUserDataEnabled,
  notifyUserDataSession,
  syncCloudUserData
} from './cloud-user-data/sync'
import {
  getCloudSaveAccount,
  signInCloudSaves,
  signOutCloudSaves
} from './cloud-saves/oauth'
import { getCloudSaveStatus, syncAllCloudSaves, syncCloudSavesForThread, cancelCloudSync } from './cloud-saves/sync'
import {
  deleteAllCloudSaves,
  deleteCloudSavesForThread,
  listCloudSaveInventory,
  listCloudSavesForThread
} from './cloud-saves/inventory'
import { clearDriveCaches } from './cloud-saves/drive'
import { checkForAppUpdate, downloadAndInstallAppUpdate, getAppUpdateStatus } from './app-update'
import {
  applyCatalogGames,
  isSubscribed,
  listSubscriptions,
  refreshSubscription,
  removeSubscription,
  setSubscriptionArchived,
  setSubscriptionRarity,
  setSubscriptionVersionStatus,
  setSubscriptionVersionReleasedAt,
  addSubscriptionVersionAlias,
  removeSubscriptionVersionAlias,
  mergeSubscriptionVersions,
  subscriptionFromCatalog,
  upsertSubscription
} from './subscriptions-store'
import { getFollowSyncStatus, startFollowSync, stopFollowSync, checkStaleFollowed, cancelFollowSyncRun } from './follow-sync'
import { openInAppWindow } from './open-url'
import type { PackageFlagKind, PackageInstallTags, PackageListQuery } from '@shared/p2p'
import {
  flagPackageAs,
  listPackagesForDiscovery,
  lookupPackageMeta,
  p2pAdd,
  p2pDownloadByContentHash,
  flagQuarantinedDownload,
  revealQuarantinedDownload,
  rejectQuarantinedDownload,
  approveQuarantinedDownload,
  p2pListProgress,
  p2pListShared,
  p2pRemoveTransfer,
  p2pPauseTransfer,
  p2pResumeTransfer,
  p2pSeed,
  p2pStatus,
  seedAllLocalPackages,
  subscribeP2pProgress,
  applyP2pUploadLimit,
  onP2pEnabledChanged,
  onTorrentMapChanged
} from './p2p'


function toIpcError(error: unknown): Error {
  if (error instanceof F95Error) {
    return new Error(error.message)
  }
  if (error instanceof Error) {
    return error
  }
  return new Error('Unexpected error')
}

function windowFromEvent(event: Electron.IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

export function registerIpc(): void {
  app.on('browser-window-created', (_event, win) => {
    const send = (): void => {
      if (!win.isDestroyed()) {
        win.webContents.send('window:fullscreen-changed', win.isFullScreen())
      }
    }
    win.on('enter-full-screen', send)
    win.on('leave-full-screen', send)
  })

  ipcMain.handle('window:isFullScreen', (event) => {
    return windowFromEvent(event)?.isFullScreen() ?? false
  })

  ipcMain.handle('window:toggleFullScreen', (event) => {
    const win = windowFromEvent(event)
    if (!win) return false
    const next = !win.isFullScreen()
    win.setFullScreen(next)
    return next
  })

  ipcMain.handle('auth:session', async () => {
    try {
      return await getAuthSession()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('auth:login', async (_event, payload: LoginPayload) => {
    try {
      return await login(payload.username, payload.password)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('auth:logout', async () => {
    try {
      stopFollowSync()
      return await logout()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('catalog:list', async (_event, query: CatalogQuery = {}) => {
    try {
      const page = await fetchCatalog(query)
      const unfilteredDateBrowse =
        (query.sort ?? 'date') === 'date' &&
        !query.search &&
        !query.creator &&
        !(query.prefixes?.length) &&
        !(query.excludePrefixes?.length) &&
        !(query.tags?.length) &&
        !(query.excludeTags?.length)
      const advanceLastSeen = unfilteredDateBrowse && (query.page ?? 1) === 1

      // Apply followed/library updates in the background so catalog UI is not delayed.
      void applyCatalogGames(page.games, { advanceLastSeen }).catch((error) =>
        console.warn('Could not refresh followed games from catalog page', error)
      )
      void applyCatalogGamesToRoster(page.games).catch((error) =>
        console.warn('Could not refresh roster games from catalog page', error)
      )
      void applyLibraryCatalogScreens(page.games).catch((error) =>
        console.warn('Could not store library preview screens', error)
      )
      return page
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('catalog:filters', async () => {
    try {
      return await fetchCatalogFilters()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('catalog:lookup', async (_event, query: CatalogLookupQuery) => {
    try {
      const threadId = Number(query?.threadId)
      const title = String(query?.title || '')
      const creator = typeof query?.creator === 'string' ? query.creator : undefined
      if (!Number.isFinite(threadId) || threadId <= 0) return null
      const game = await lookupCatalogGame(threadId, title, creator)
      if (game) {
        void applyCatalogGames([game]).catch((error) =>
          console.warn('Could not refresh followed game from catalog lookup', error)
        )
        void applyCatalogGamesToRoster([game]).catch((error) =>
          console.warn('Could not refresh roster game from catalog lookup', error)
        )
        void applyLibraryCatalogScreens([game]).catch((error) =>
          console.warn('Could not store library preview screens from catalog lookup', error)
        )
      }
      return game
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('subscriptions:list', async () => {
    try {
      return await listSubscriptions()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('subscriptions:toggle', async (_event, game: CatalogGame) => {
    try {
      if (await isSubscribed(game.threadId)) {
        const current = (await listSubscriptions()).find((item) => item.threadId === game.threadId)
        if (current) await applyThreadMetadata(metadataFromSubscription(current))
        return await removeSubscription(game.threadId)
      }
      const next = await upsertSubscription(subscriptionFromCatalog(game, 'manual'))
      await applyThreadMetadata(metadataFromSubscription(game))
      return next
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('subscriptions:remove', async (_event, threadId: number) => {
    try {
      const current = (await listSubscriptions()).find((item) => item.threadId === threadId)
      if (current) await applyThreadMetadata(metadataFromSubscription(current))
      return await removeSubscription(threadId)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('subscriptions:importWatched', async () => {
    try {
      return await importWatchedThreads()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('subscriptions:importBookmarks', async () => {
    try {
      return await importBookmarks()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('subscriptions:refresh', async (_event, threadId: number) => {
    try {
      const next = await refreshSubscription(threadId)
      const current = next.find((item) => item.threadId === threadId)
      if (current) await applyThreadMetadata(metadataFromSubscription(current))
      return next
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('subscriptions:setArchived', async (_event, threadId: number, archived: boolean) => {
    try {
      return await setSubscriptionArchived(threadId, Boolean(archived))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('subscriptions:setRarity', async (_event, threadId: number, rarity: GameRarity) => {
    try {
      return await setSubscriptionRarity(threadId, rarity)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle(
    'subscriptions:setVersionStatus',
    async (_event, threadId: number, version: string, status: VersionPlayStatus) => {
      try {
        return await setSubscriptionVersionStatus(threadId, version, status)
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle(
    'subscriptions:setVersionReleasedAt',
    async (_event, threadId: number, version: string, releasedAt: number) => {
      try {
        return await setSubscriptionVersionReleasedAt(threadId, version, Number(releasedAt) || 0)
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle(
    'subscriptions:addVersionAlias',
    async (_event, threadId: number, version: string, alias: string) => {
      try {
        return await addSubscriptionVersionAlias(threadId, version, alias)
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle(
    'subscriptions:removeVersionAlias',
    async (_event, threadId: number, version: string, alias: string) => {
      try {
        return await removeSubscriptionVersionAlias(threadId, version, alias)
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle(
    'subscriptions:mergeVersions',
    async (_event, threadId: number, canonical: string, sources: string[]) => {
      try {
        return await mergeSubscriptionVersions(threadId, canonical, sources)
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle('subscriptions:sync', async () => {
    try {
      return await checkStaleFollowed()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('subscriptions:cancelSync', () => cancelFollowSyncRun())

  ipcMain.handle('subscriptions:startSync', async () => {
    try {
      return await startFollowSync()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('subscriptions:syncStatus', () => getFollowSyncStatus())

  ipcMain.handle('threads:details', async (_event, threadId: number) => {
    try {
      return await fetchThreadDetails(Number(threadId))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('threads:reviews', async (_event, threadId: number, page: number) => {
    try {
      return await fetchThreadReviews(Number(threadId), Number(page) || 1)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle(
    'threads:setIgnored',
    async (_event, threadId: number, ignored: boolean, href?: string | null) => {
      try {
        const next = await setThreadIgnored(Number(threadId), Boolean(ignored), href)
        invalidateThreadDetailsCache(Number(threadId))
        return next
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle('threads:listIgnored', async () => {
    try {
      return await listIgnoredThreads()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('roster:list', async () => {
    try {
      return await listRoster()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('roster:toggle', async (_event, game: CatalogGame) => {
    try {
      return await toggleRoster(game)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('roster:remove', async (_event, threadId: number) => {
    try {
      return await removeFromRoster(Number(threadId))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('roster:reorder', async (_event, threadIds: unknown) => {
    try {
      const ids = Array.isArray(threadIds) ? threadIds.map((id) => Number(id)) : []
      return await reorderRoster(ids)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('gameNotes:get', async (_event, threadId: number) => {
    try {
      return await getGameNote(Number(threadId))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('gameNotes:set', async (_event, threadId: number, text: string) => {
    try {
      return await setGameNote(Number(threadId), typeof text === 'string' ? text : '')
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('settings:get', async () => {
    try {
      return await getSettings()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('settings:save', async (_event, next: Partial<AppSettings>) => {
    try {
      const before = await getSettings()
      const settings = await saveSettings(next)
      applyConfiguredDownloadPath()
      if (before.p2pEnabled !== settings.p2pEnabled) {
        void onP2pEnabledChanged(settings.p2pEnabled).catch((error) =>
          console.warn('[p2p] onP2pEnabledChanged failed', error)
        )
      } else if (before.p2pUploadLimitKBps !== settings.p2pUploadLimitKBps) {
        applyP2pUploadLimit()
      }
      const changedKeys = portableSettingKeysChanged(before, settings)
      if (changedKeys.length) await bumpSettingTimes(changedKeys)
      if (before.cloudUserDataEnabled !== settings.cloudUserDataEnabled) {
        notifyUserDataEnabled(settings.cloudUserDataEnabled)
      } else if (changedKeys.length) {
        notifyUserDataChanged('settings')
      }
      return settings
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('settings:userDataPath', async () => {
    try {
      return getAppPaths().userData
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('settings:openUserData', async () => {
    try {
      const dir = getAppPaths().userData
      const error = await shell.openPath(dir)
      if (error) throw new Error(error)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('cloudSaves:account', async () => {
    try {
      return await getCloudSaveAccount()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('cloudSaves:status', () => getCloudSaveStatus())

  ipcMain.handle('cloudSaves:signIn', async (_event, openBrowser?: boolean) => {
    try {
      const account = await signInCloudSaves(openBrowser !== false)
      notifyUserDataSession()
      return account
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('cloudSaves:signOut', async () => {
    try {
      const account = await signOutCloudSaves()
      clearDriveCaches()
      notifyUserDataSession()
      return account
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('cloudSaves:syncAll', async () => {
    try {
      return await syncAllCloudSaves()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('cloudSaves:syncThread', async (_event, threadId: number) => {
    try {
      return await syncCloudSavesForThread(threadId)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('cloudSaves:cancel', () => cancelCloudSync())

  ipcMain.handle('cloudSaves:inventory', async () => {
    try {
      return await listCloudSaveInventory(true)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('cloudSaves:listForThread', async (_event, threadId: number) => {
    try {
      return await listCloudSavesForThread(threadId)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('cloudSaves:deleteGame', async (_event, threadId: number) => {
    try {
      await deleteCloudSavesForThread(threadId)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('cloudSaves:deleteAll', async () => {
    try {
      await deleteAllCloudSaves()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('cloudUserData:status', () => getCloudUserDataStatus())

  ipcMain.handle('cloudUserData:sync', async () => {
    try {
      return await syncCloudUserData()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('appUpdate:get', () => getAppUpdateStatus())

  ipcMain.handle('appUpdate:check', async () => {
    try {
      return await checkForAppUpdate()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('appUpdate:downloadAndInstall', async () => {
    try {
      return await downloadAndInstallAppUpdate()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('settings:pickFolder', async (event, currentPath?: string) => {
    try {
      const parent = BrowserWindow.fromWebContents(event.sender)
      const options: Electron.OpenDialogOptions = {
        title: 'Choose folder',
        defaultPath: typeof currentPath === 'string' && currentPath ? currentPath : undefined,
        properties: ['openDirectory', 'createDirectory']
      }
      const result = parent
        ? await dialog.showOpenDialog(parent, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled) return null
      return result.filePaths[0] ?? null
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('downloads:list', async () => {
    try {
      return listDownloads()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('downloads:cancel', async (_event, id: string) => {
    try {
      return cancelDownload(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('downloads:pause', async (_event, id: string) => {
    try {
      return pauseDownload(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('downloads:resume', async (_event, id: string) => {
    try {
      return resumeDownload(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('downloads:remove', async (_event, id: string) => {
    try {
      return removeDownload(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('downloads:clearFinished', async () => {
    try {
      return clearFinishedDownloads()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('downloads:showInFolder', async (_event, id: string) => {
    try {
      await showDownloadInFolder(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('downloads:openFile', async (_event, id: string) => {
    try {
      await openDownload(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('downloads:openFolder', async () => {
    try {
      await openDownloadsFolder()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('downloads:approve', async (_event, id: string, tags: unknown) => {
    try {
      return await approveDownload(String(id || ''), tags as PackageInstallTags)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('downloads:reject', async (_event, id: string) => {
    try {
      return await rejectDownload(String(id || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('downloads:flag', async (_event, id: string, note?: string) => {
    try {
      return await flagDownload(String(id || ''), note ? String(note) : undefined)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:list', async (_event, threadId?: number) => {
    try {
      return await listGameFiles(typeof threadId === 'number' ? threadId : undefined)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:diskUsage', async (_event, threadId: number) => {
    try {
      return await gameDiskUsage(Number(threadId))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:storageStats', async (_event, force?: boolean) => {
    try {
      return await requestLibraryStorageStats({ force: Boolean(force) })
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:storageScan', () => getLibraryStorageScan())

  ipcMain.handle('library:saveOnlyItems', async () => {
    try {
      return await listSaveOnlyItems()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:identifiedSaveFolders', async () => {
    try {
      return await listPresentIdentifiedSaveFolders()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:clearSaves', async (_event, threadId: number, savePath?: string) => {
    try {
      await clearGameSaves(Number(threadId) || 0, savePath ? String(savePath) : undefined)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:removeLocalData', async (_event, threadId: number) => {
    try {
      await removeGameLocalData(Number(threadId) || 0)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:openSaveFolder', async (_event, savePath: string) => {
    try {
      await openManagedSaveFolder(String(savePath || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:peekSaveFolder', async (_event, savePath: string) => {
    try {
      return await listSaveFolderPeek(String(savePath || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:identifySaveFolder', async (_event, savePath: string) => {
    try {
      const patch = await identifySaveFolder(String(savePath || ''))
      return await applySaveFolderIdentityToScan(patch)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle(
    'library:assignSaveFolder',
    async (
      _event,
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
    ) => {
      try {
        const patch = await assignSaveFolder(String(savePath || ''), game || { threadId: 0, title: '' })
        return await applySaveFolderIdentityToScan(patch)
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle('library:unmapSaveFolder', async (_event, savePath: string) => {
    try {
      const patch = await unmapSaveFolder(String(savePath || ''))
      return await applySaveFolderIdentityToScan(patch)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:importExternal', async () => {
    try {
      const result = await scanExternalLibraries()
      await requestLibraryStorageStats({ force: true })
      return result
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:getImport', async (_event, filePath: string) => {
    try {
      return await getPendingImport(String(filePath || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:identifyImport', async (_event, filePath: string) => {
    try {
      return await identifyPendingImport(String(filePath || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle(
    'library:approveImport',
    async (_event, filePath: string, game: unknown, tags: unknown) => {
      try {
        await approvePendingImport(
          String(filePath || ''),
          game as {
            threadId: number
            title: string
            coverUrl: string | null
          },
          tags as PackageInstallTags
        )
        return await requestLibraryStorageStats({ force: true })
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle('library:dismissImport', async (_event, filePath: string) => {
    try {
      await dismissPendingImport(String(filePath || ''))
      return await requestLibraryStorageStats({ force: true })
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:revealImport', async (_event, filePath: string) => {
    try {
      await revealImportPath(String(filePath || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:install', async (_event, id: string, engine?: string) => {
    try {
      return await installGameFile(String(id), engine)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:installUncensorPatch', async (_event, patchId: string, targetFileId: string) => {
    try {
      return await installUncensorPatch(String(patchId), String(targetFileId))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle(
    'library:uninstallUncensorPatch',
    async (
      _event,
      gameFileId: string,
      patchRef: { patchId?: string; hash?: string; uninstallSlot?: string }
    ) => {
      try {
        return await uninstallUncensorPatch(String(gameFileId), patchRef || {})
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle('library:showArchive', async (_event, id: string) => {
    try {
      await showGameArchive(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:play', async (event, id: string, engine?: string) => {
    try {
      return await playGameFile(String(id), BrowserWindow.fromWebContents(event.sender), engine)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:playLatest', async (event, threadId: number, engine?: string) => {
    try {
      return await playLatestGameFile(
        Number(threadId),
        BrowserWindow.fromWebContents(event.sender),
        engine
      )
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:playSessions', async () => {
    return listPlaySessions()
  })

  ipcMain.handle('library:stop', async (_event, id: string) => {
    try {
      await stopPlaySession(String(id))
      return listPlaySessions()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:pickExecutable', async (event, id: string) => {
    try {
      return await chooseGameExecutable(String(id), BrowserWindow.fromWebContents(event.sender))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:uninstall', async (_event, id: string) => {
    try {
      return await uninstallGameFile(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:removeArchive', async (_event, id: string) => {
    try {
      return await removeGameArchive(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:removeVersion', async (_event, id: string) => {
    try {
      return await removeGameVersion(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:updateTags', async (_event, id: string, tags: unknown) => {
    try {
      return await updateGameFileTags(String(id), tags as PackageInstallTags)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:showInstall', async (_event, id: string) => {
    try {
      await showGameInstall(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('library:relocateInstall', async (_event, id: string) => {
    try {
      return await relocateGameInstall(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('renpy:info', async (_event, id: string, prepare?: boolean, title?: string, threadId?: number, scope?: RenpyInfoScope) => {
    try {
      return await getRenpyInfo(
        String(id || ''),
        Boolean(prepare),
        String(title || ''),
        Number(threadId) || 0,
        scope === 'saves' ? 'saves' : 'full'
      )
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('renpy:run', async (_event, id: string, action: UnRenAction) => {
    try {
      return await runRenpyAction(String(id), action)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('renpy:setTool', async (_event, id: string, tool: RenpyToolId, enabled: boolean) => {
    try {
      return await setRenpyToolForFile(String(id), tool, Boolean(enabled))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('renpy:setAllOptions', async (_event, id: string, enabled: boolean) => {
    try {
      return await setAllRenpyToolsForFile(String(id), Boolean(enabled))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('renpy:setOptionsGlobal', async (_event, id: string, enabled: boolean) => {
    try {
      return await setRenpyOptionsGlobalForFile(String(id), Boolean(enabled))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('renpy:openSaves', async (_event, id: string, title?: string, threadId?: number) => {
    try {
      await openRenpySaves(String(id || ''), String(title || ''), Number(threadId) || 0)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle(
    'renpy:chooseSaveDirectory',
    async (event, id: string, title?: string, threadId?: number) => {
      try {
        return await chooseRenpySaveDirectory(
          String(id || ''),
          String(title || ''),
          BrowserWindow.fromWebContents(event.sender),
          Number(threadId) || 0
        )
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle(
    'renpy:setSaveDirectory',
    async (_event, id: string, savePath: string, title?: string, threadId?: number) => {
      try {
        return await setRenpySaveLocation(
          String(id || ''),
          String(savePath || ''),
          String(title || ''),
          Number(threadId) || 0
        )
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle(
    'renpy:unlinkSaveDirectory',
    async (_event, id: string, savePath: string, title?: string, threadId?: number) => {
      try {
        return await unlinkRenpySaveLocation(
          String(id || ''),
          String(savePath || ''),
          String(title || ''),
          Number(threadId) || 0
        )
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle(
    'renpy:clearSaveDirectory',
    async (_event, id: string, title?: string, threadId?: number) => {
      try {
        return await clearRenpySaveDirectory(
          String(id || ''),
          String(title || ''),
          Number(threadId) || 0
        )
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle('renpy:showSave', async (_event, id: string, savePath: string, title?: string) => {
    try {
      await showRenpySave(String(id || ''), String(savePath), String(title || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('renpy:readSaveEditor', async (_event, id: string, savePath: string, title?: string) => {
    try {
      return await readRenpySaveEditor(String(id || ''), String(savePath), String(title || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle(
    'renpy:applySaveEditor',
    async (_event, id: string, savePath: string, patches: unknown, title?: string) => {
      try {
        return await applyRenpySaveEditor(
          String(id || ''),
          String(savePath),
          Array.isArray(patches) ? patches : [],
          String(title || '')
        )
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle('renpy:deleteSave', async (_event, id: string, savePath: string, title?: string) => {
    try {
      return await deleteRenpySave(String(id || ''), String(savePath), String(title || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('renpy:deleteSaves', async (_event, id: string, savePaths: string[], title?: string) => {
    try {
      const paths = Array.isArray(savePaths) ? savePaths.map((item) => String(item)) : []
      return await deleteRenpySaves(String(id || ''), paths, String(title || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle(
    'renpy:moveSave',
    async (_event, id: string, savePath: string, page: string, slot: number, title?: string) => {
      try {
        return await moveRenpySave(
          String(id || ''),
          String(savePath),
          String(page),
          Number(slot),
          String(title || '')
        )
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle('renpy:renumberPage', async (_event, id: string, fromPage: string, toPage: string, title?: string) => {
    try {
      return await renumberRenpyPage(String(id || ''), String(fromPage), String(toPage), String(title || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle(
    'rpgmaker:info',
    async (_event, fileId: string, threadId: number, title?: string, which?: 'game' | 'backup') => {
      try {
        return await getRpgMakerInfo({
          fileId: String(fileId || ''),
          threadId: Number(threadId),
          title: String(title || ''),
          which: which === 'backup' || which === 'game' ? which : undefined
        })
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle(
    'rpgmaker:openSaves',
    async (_event, fileId: string, threadId: number, title?: string, which?: 'game' | 'backup') => {
      try {
        await openRpgMakerSaves({
          fileId: String(fileId || ''),
          threadId: Number(threadId),
          title: String(title || ''),
          which
        })
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle('rpgmaker:showSave', async (_event, fileId: string, threadId: number, savePath: string, title?: string) => {
    try {
      await showRpgMakerSave(
        { fileId: String(fileId || ''), threadId: Number(threadId), title: String(title || '') },
        String(savePath)
      )
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle(
    'rpgmaker:readSaveEditor',
    async (_event, fileId: string, threadId: number, savePath: string, title?: string) => {
      try {
        return await readRpgMakerSaveEditor(
          { fileId: String(fileId || ''), threadId: Number(threadId), title: String(title || '') },
          String(savePath)
        )
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle(
    'rpgmaker:applySaveEditor',
    async (_event, fileId: string, threadId: number, savePath: string, patches: unknown, title?: string) => {
      try {
        return await applyRpgMakerSaveEditor(
          { fileId: String(fileId || ''), threadId: Number(threadId), title: String(title || '') },
          String(savePath),
          Array.isArray(patches) ? patches : []
        )
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle(
    'rpgmaker:deleteSaves',
    async (_event, fileId: string, threadId: number, savePaths: string[], title?: string) => {
      try {
        const paths = Array.isArray(savePaths) ? savePaths.map((item) => String(item)) : []
        return await deleteRpgMakerSaves(
          { fileId: String(fileId || ''), threadId: Number(threadId), title: String(title || '') },
          paths
        )
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  ipcMain.handle('shell:open', async (_event, url: string, context?: GameFileContext) => {
    try {
      await openInAppWindow(String(url), { context })
    } catch (error) {
      throw toIpcError(error)
    }
  })

  // --- P2P (WebTorrent main-process stubs) ---
  ipcMain.handle('p2p:status', async () => {
    try {
      return await p2pStatus()
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle('p2p:add', async (_event, magnetOrPath: string, contentHash?: string) => {
    try {
      return await p2pAdd(String(magnetOrPath), contentHash ? String(contentHash) : undefined)
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle(
    'p2p:seed',
    async (
      _event,
      filePath: string,
      meta?: {
        contentHash?: string
        gameName?: string
        gameVersion?: string | null
        f95ThreadId?: number | null
        f95ThreadUrl?: string | null
      }
    ) => {
      try {
        return await p2pSeed(String(filePath), meta)
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )
  ipcMain.handle('p2p:remove', async (_event, id: string, deleteFiles?: boolean) => {
    try {
      await p2pRemoveTransfer(String(id), Boolean(deleteFiles))
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle('p2p:pause', async (_event, id: string) => {
    try {
      return await p2pPauseTransfer(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle('p2p:resume', async (_event, id: string) => {
    try {
      return await p2pResumeTransfer(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle('p2p:progress', async () => {
    try {
      return await p2pListProgress()
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle('p2p:listShared', async () => {
    try {
      return await p2pListShared()
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle('p2p:seedAll', async () => {
    try {
      return await seedAllLocalPackages()
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle('p2p:listPackages', async (_event, query?: PackageListQuery) => {
    try {
      return await listPackagesForDiscovery(query && typeof query === 'object' ? (query as PackageListQuery) : ({ f95ThreadId: '' } as PackageListQuery))
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle('p2p:getPackage', async (_event, contentHash: string) => {
    try {
      return await lookupPackageMeta(String(contentHash || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle('p2p:downloadByHash', async (_event, contentHash: string) => {
    try {
      return await p2pDownloadByContentHash(String(contentHash || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle(
    'p2p:flag',
    async (_event, contentHash: string, kind: PackageFlagKind, note?: string) => {
      try {
        return await flagPackageAs(String(contentHash), kind, note ? String(note) : undefined)
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )


  ipcMain.handle('p2p:approveQuarantine', async (_event, id: string, tags: unknown) => {
    try {
      await approveQuarantinedDownload(String(id || ''), tags as PackageInstallTags)
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle('p2p:rejectQuarantine', async (_event, id: string) => {
    try {
      await rejectQuarantinedDownload(String(id || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle('p2p:revealQuarantine', async (_event, id: string) => {
    try {
      return await revealQuarantinedDownload(String(id || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })
  ipcMain.handle(
    'p2p:flagQuarantine',
    async (_event, id: string, note?: string) => {
      try {
        await flagQuarantinedDownload(String(id || ''), note ? String(note) : undefined)
      } catch (error) {
        throw toIpcError(error)
      }
    }
  )

  subscribeP2pProgress((items) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('p2p:progress', items)
    }
  })

  let sharedNotifyTimer: ReturnType<typeof setTimeout> | null = null
  onTorrentMapChanged(() => {
    if (sharedNotifyTimer) clearTimeout(sharedNotifyTimer)
    sharedNotifyTimer = setTimeout(() => {
      void p2pListShared()
        .then((rows) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send('p2p:shared-changed', rows)
          }
        })
        .catch((error) => {
          console.warn('[p2p] shared-changed notify failed', error)
        })
    }, 50)
  })
}
