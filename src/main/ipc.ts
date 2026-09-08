import { BrowserWindow, dialog, ipcMain } from 'electron'
import type {
  AppSettings,
  CatalogGame,
  CatalogQuery,
  GameFileContext,
  GameRarity,
  LoginPayload,
  RenpyToolId,
  UnRenAction
} from '@shared/types'
import {
  applyConfiguredDownloadPath,
  cancelDownload,
  clearFinishedDownloads,
  listDownloads,
  openDownload,
  openDownloadsFolder,
  pauseDownload,
  removeDownload,
  resumeDownload,
  showDownloadInFolder
} from './downloads'
import { F95Error } from './f95/http'
import { getAuthSession, login, logout } from './f95/auth'
import { fetchCatalog, fetchCatalogFilters } from './f95/catalog'
import { importBookmarks, importWatchedThreads } from './f95/import'
import { fetchThreadDetails, fetchThreadReviews } from './f95/thread'
import {
  applyThreadMetadata,
  applyCatalogScreens as applyLibraryCatalogScreens,
  chooseGameExecutable,
  installGameFile,
  listGameFiles,
  gameDiskUsage,
  metadataFromSubscription,
  playGameFile,
  playLatestGameFile,
  removeGameArchive,
  removeGameVersion,
  showGameArchive,
  showGameInstall,
  uninstallGameFile
} from './game-files-store'
import { listPlaySessions, stopPlaySession } from './play-sessions'
import {
  deleteRpgMakerSaves,
  getRpgMakerInfo,
  openRpgMakerSaves,
  showRpgMakerSave
} from './rpgmaker/saves'
import {
  deleteRenpySave,
  deleteRenpySaves,
  getRenpyInfo,
  moveRenpySave,
  openRenpySaves,
  renumberRenpyPage,
  runRenpyAction,
  setRenpyToolForFile,
  showRenpySave
} from './renpy/saves'
import { getSettings, saveSettings } from './settings-store'
import {
  applyCatalogScreens,
  isSubscribed,
  listSubscriptions,
  refreshSubscription,
  removeSubscription,
  setSubscriptionRarity,
  subscriptionFromCatalog,
  upsertSubscription
} from './subscriptions-store'
import { getFollowSyncStatus, startFollowSync, stopFollowSync, checkStaleFollowed } from './follow-sync'
import { openInAppWindow } from './open-url'

function toIpcError(error: unknown): Error {
  if (error instanceof F95Error) {
    return new Error(error.message)
  }
  if (error instanceof Error) {
    return error
  }
  return new Error('Unexpected error')
}

export function registerIpc(): void {
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
      await Promise.all([
        applyCatalogScreens(page.games).catch((error) =>
          console.warn('Could not store catalog preview screens', error)
        ),
        applyLibraryCatalogScreens(page.games).catch((error) =>
          console.warn('Could not store library preview screens', error)
        )
      ])
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

  ipcMain.handle('subscriptions:setRarity', async (_event, threadId: number, rarity: GameRarity) => {
    try {
      return await setSubscriptionRarity(threadId, rarity)
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('subscriptions:sync', async () => {
    try {
      return await checkStaleFollowed()
    } catch (error) {
      throw toIpcError(error)
    }
  })

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

  ipcMain.handle('settings:get', async () => {
    try {
      return await getSettings()
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('settings:save', async (_event, next: Partial<AppSettings>) => {
    try {
      const settings = await saveSettings(next)
      applyConfiguredDownloadPath()
      return settings
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

  ipcMain.handle('library:install', async (_event, id: string, engine?: string) => {
    try {
      return await installGameFile(String(id), engine)
    } catch (error) {
      throw toIpcError(error)
    }
  })

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

  ipcMain.handle('library:showInstall', async (_event, id: string) => {
    try {
      await showGameInstall(String(id))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('renpy:info', async (_event, id: string, prepare?: boolean, title?: string) => {
    try {
      return await getRenpyInfo(String(id || ''), Boolean(prepare), String(title || ''))
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

  ipcMain.handle('renpy:openSaves', async (_event, id: string, title?: string) => {
    try {
      await openRenpySaves(String(id || ''), String(title || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

  ipcMain.handle('renpy:showSave', async (_event, id: string, savePath: string, title?: string) => {
    try {
      await showRenpySave(String(id || ''), String(savePath), String(title || ''))
    } catch (error) {
      throw toIpcError(error)
    }
  })

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

  ipcMain.handle('rpgmaker:info', async (_event, fileId: string, threadId: number, title?: string) => {
    try {
      return await getRpgMakerInfo({
        fileId: String(fileId || ''),
        threadId: Number(threadId),
        title: String(title || '')
      })
    } catch (error) {
      throw toIpcError(error)
    }
  })

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
}
