import { mkdir, rm, utimes, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { pathExists, toFsPath } from '../win-path'
import { getSettings } from '../settings-store'
import { mapLimit } from '../disk-usage'
import {
  deleteDriveFile,
  findChildFolderId,
  findGameFolderId,
  getChildFolderId,
  getDriveRootId,
  getGameFolderId,
  listDriveFiles,
  listDriveFolders,
  patchDriveMetadata,
  uploadDriveFile,
  downloadDriveFile
} from './drive'
import { hasCloudSaveSession } from './oauth'
import { invalidateCloudInventory } from './inventory'
import {
  beginCloudSync,
  endCloudSync,
  finishCloudSyncGame,
  getCloudSaveStatus,
  noteCloudSyncGame,
  requestCloudSyncCancel
} from './status'
import { planFolderSync, planHasWork } from './diff'
import {
  collectSyncFolders,
  emptyManifest,
  folderByKey,
  upsertFolder,
  type CloudSyncFolder,
  type SaveManifest
} from './manifest'
import {
  recheckLocalManifest,
  writeFolderManifest,
  writeGameManifest
} from './local-manifest'
import { loadCloudFolder, loadCloudManifest, saveCloudManifest } from './remote-manifest'
import { listLocalSaveSources, listRpgMakerBackupFolders, RPG_FOLDER } from './sources'
import { listIdentifiedSaveFolders } from '../save-folders-store'
import type { CloudSaveSyncStatus } from '@shared/types'

const FILE_CONCURRENCY = 4
const GAME_CONCURRENCY = 3

type GameSyncResult = {
  uploaded: number
  downloaded: number
}

let queue: Promise<unknown> = Promise.resolve()
let activeAbort: AbortController | null = null

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

function isAbortError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'name' in error &&
      (error as { name?: string }).name === 'AbortError'
  )
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('Stopped')
  error.name = 'AbortError'
  throw error
}

async function writeLocalFile(localPath: string, body: Buffer, modifiedAt: number): Promise<void> {
  await mkdir(toFsPath(dirname(localPath)), { recursive: true })
  await writeFile(toFsPath(localPath), body)
  if (modifiedAt > 0) {
    const when = new Date(modifiedAt)
    await utimes(toFsPath(localPath), when, when).catch(() => undefined)
  }
}

async function syncFolder(
  source: CloudSyncFolder,
  gameFolderId: string,
  keepCount: number,
  includeAutoQuick: boolean,
  localManifest: SaveManifest,
  cloudManifest: SaveManifest | null,
  signal: AbortSignal
): Promise<{ uploaded: number; downloaded: number; local: SaveManifest; cloud: SaveManifest }> {
  throwIfAborted(signal)
  const localFolder = folderByKey(localManifest, source.key)
  const cloudFolder = await loadCloudFolder(gameFolderId, source.key, cloudManifest)
  const plan = planFolderSync(
    localFolder,
    cloudFolder,
    keepCount,
    includeAutoQuick,
    Date.now(),
    source.localGone
  )
  const nextLocal = upsertFolder(localManifest, plan.nextLocal)
  let nextCloud = upsertFolder(cloudManifest ?? emptyManifest(localManifest.threadId, localManifest.title), plan.nextCloud)

  if (source.localGone) {
    const goneId = await findChildFolderId(gameFolderId, source.key)
    if (goneId) await deleteDriveFile(goneId)
    return { uploaded: 0, downloaded: 0, local: nextLocal, cloud: nextCloud }
  }

  if (!planHasWork(plan)) {
    return { uploaded: 0, downloaded: 0, local: nextLocal, cloud: nextCloud }
  }

  let folderId = await findChildFolderId(gameFolderId, source.key)
  if (!folderId) {
    if (!plan.uploads.length && !plan.downloads.length && !plan.remoteRenames.length) {
      return { uploaded: 0, downloaded: plan.remoteDeletes.length ? 0 : 0, local: nextLocal, cloud: nextCloud }
    }
    folderId = await getChildFolderId(gameFolderId, source.key)
  }

  const remoteFiles = await listDriveFiles(folderId)
  const remoteByName = new Map(remoteFiles.map((item) => [item.name, item]))
  let uploaded = 0
  let downloaded = 0

  await mapLimit(plan.remoteDeletes, FILE_CONCURRENCY, async (item) => {
    throwIfAborted(signal)
    const key = item.remoteName || item.name
    if (!key) return
    const remote = remoteByName.get(key)
    if (!remote) return
    await deleteDriveFile(remote.id)
    remoteByName.delete(key)
  })

  await mapLimit(plan.remoteRenames, FILE_CONCURRENCY, async (item) => {
    throwIfAborted(signal)
    const remote = remoteByName.get(item.from)
    if (!remote) return
    const dest = remoteByName.get(item.to)
    if (dest && dest.id !== remote.id) {
      await deleteDriveFile(dest.id)
      remoteByName.delete(item.to)
    }
    await patchDriveMetadata(remote.id, { name: item.to })
    remoteByName.delete(item.from)
    remoteByName.set(item.to, { ...remote, name: item.to })
  })

  await mapLimit(plan.uploads, FILE_CONCURRENCY, async (item) => {
    throwIfAborted(signal)
    const localPath = join(source.localDir, item.name)
    if (!pathExists(localPath)) return
    const remoteName = item.remoteName || item.name
    const existing = remoteByName.get(remoteName)
    await uploadDriveFile({
      parentId: folderId,
      name: remoteName,
      localPath,
      modifiedAt: item.modifiedAt,
      existingId: existing?.id
    })
    uploaded += 1
  })

  await mapLimit(plan.downloads, FILE_CONCURRENCY, async (item) => {
    throwIfAborted(signal)
    const remote =
      remoteByName.get(item.remoteName) || remoteByName.get(item.name)
    if (!remote) return
    const body = await downloadDriveFile(remote.id)
    await writeLocalFile(join(source.localDir, item.name), body, item.modifiedAt)
    downloaded += 1
  })

  await mapLimit(plan.localDeletes, FILE_CONCURRENCY, async (item) => {
    throwIfAborted(signal)
    const localPath = join(source.localDir, item.name)
    if (pathExists(localPath)) await rm(toFsPath(localPath), { force: true })
  })

  nextCloud = upsertFolder(nextCloud, plan.nextCloud)
  return { uploaded, downloaded, local: nextLocal, cloud: nextCloud }
}

async function copyRpgMakerFromBackup(threadId: number, title: string): Promise<void> {
  try {
    const { listGameFiles } = await import('../game-files-store')
    const files = await listGameFiles(threadId)
    const installed = files.find((file) => file.installPath && pathExists(file.installPath))
    if (installed?.installPath) {
      const { syncRpgMakerSaves } = await import('../rpgmaker/saves')
      await syncRpgMakerSaves({
        installPath: installed.installPath,
        threadId,
        title,
        mode: 'merge'
      })
    }
  } catch (error) {
    console.warn('Could not copy cloud RPG Maker saves into the game folder', error)
  }
}

async function syncThread(threadId: number, signal: AbortSignal): Promise<GameSyncResult> {
  const settings = await getSettings()
  const { title, sources } = await listLocalSaveSources(threadId)
  noteCloudSyncGame(title)
  throwIfAborted(signal)
  const localManifest = await recheckLocalManifest(threadId, title, sources)
  throwIfAborted(signal)
  const folders = collectSyncFolders(sources, localManifest, pathExists)
  if (!folders.length) return { uploaded: 0, downloaded: 0 }
  const hasLocalFiles = localManifest.folders.some((folder) => folder.files.length)
  let gameFolderId = await findGameFolderId(threadId)
  if (!gameFolderId) {
    if (!hasLocalFiles) return { uploaded: 0, downloaded: 0 }
    gameFolderId = await getGameFolderId(threadId, title)
  }
  const cloudManifest = await loadCloudManifest(gameFolderId)
  let local = localManifest
  let cloud = cloudManifest ?? emptyManifest(threadId, title)
  const totals: GameSyncResult = { uploaded: 0, downloaded: 0 }
  for (const source of folders) {
    throwIfAborted(signal)
    const next = await syncFolder(
      source,
      gameFolderId,
      settings.cloudSaveKeepCount,
      settings.cloudSaveIncludeAutoQuick,
      local,
      cloud,
      signal
    )
    totals.uploaded += next.uploaded
    totals.downloaded += next.downloaded
    local = next.local
    cloud = next.cloud
    cloud.threadId = threadId
    cloud.title = title
    cloud.updatedAt = Date.now()
    local.updatedAt = Date.now()
    await writeGameManifest(local)
    if (!source.localGone) await writeFolderManifest(source.localDir, local, source.key)
    await saveCloudManifest(gameFolderId, cloud)
  }
  if (folders.some((item) => item.key === RPG_FOLDER && !item.localGone)) {
    await copyRpgMakerFromBackup(threadId, title)
  }
  return totals
}

async function collectThreadIds(): Promise<number[]> {
  const ids = new Set<number>()
  for (const rec of await listIdentifiedSaveFolders()) {
    if (rec.threadId) ids.add(rec.threadId)
  }
  for (const folder of await listRpgMakerBackupFolders()) {
    if (folder.threadId) ids.add(folder.threadId)
  }
  try {
    const rootId = await getDriveRootId()
    for (const folder of await listDriveFolders(rootId)) {
      const id = Number(folder.name)
      if (Number.isFinite(id) && id > 0) ids.add(id)
    }
  } catch {
    // Offline Drive listing is optional; local games still sync.
  }
  return [...ids].sort((a, b) => a - b)
}

export async function cloudSavesReady(): Promise<boolean> {
  const settings = await getSettings()
  if (!settings.cloudSavesEnabled) return false
  return hasCloudSaveSession()
}

async function runSync(threadIds: number[]): Promise<CloudSaveSyncStatus> {
  if (getCloudSaveStatus().running && getCloudSaveStatus().phase === 'syncing') {
    return getCloudSaveStatus()
  }
  const ready = await cloudSavesReady()
  if (!ready) return getCloudSaveStatus()
  const abort = new AbortController()
  activeAbort = abort
  beginCloudSync(threadIds.length)
  let error: string | null = null
  let cancelled = false
  try {
    await mapLimit(threadIds, GAME_CONCURRENCY, async (threadId) => {
      try {
        throwIfAborted(abort.signal)
        const result = await syncThread(threadId, abort.signal)
        finishCloudSyncGame(result.uploaded, result.downloaded)
      } catch (err) {
        if (isAbortError(err) || abort.signal.aborted) {
          cancelled = true
          return
        }
        const message = err instanceof Error ? err.message : String(err)
        error = error || message
        console.warn('Cloud save sync failed for', threadId, err)
        finishCloudSyncGame(0, 0)
      }
    })
    if (abort.signal.aborted) cancelled = true
  } catch (err) {
    if (isAbortError(err) || abort.signal.aborted) cancelled = true
    else error = err instanceof Error ? err.message : String(err)
  } finally {
    if (activeAbort === abort) activeAbort = null
  }
  invalidateCloudInventory()
  endCloudSync(cancelled ? null : error, cancelled)
  return getCloudSaveStatus()
}

export function cancelCloudSync(): CloudSaveSyncStatus {
  activeAbort?.abort()
  requestCloudSyncCancel()
  return getCloudSaveStatus()
}

export async function syncCloudSavesForThread(threadId: number): Promise<CloudSaveSyncStatus> {
  const id = Number(threadId)
  if (!id) return getCloudSaveStatus()
  if (!(await cloudSavesReady())) return getCloudSaveStatus()
  return enqueue(() => runSync([id]))
}

export function scheduleCloudSyncForThread(threadId: number): void {
  const id = Number(threadId)
  if (!id) return
  void syncCloudSavesForThread(id).catch((error) => {
    console.warn('Could not sync cloud saves', error)
  })
}

export async function syncAllCloudSaves(): Promise<CloudSaveSyncStatus> {
  if (!(await cloudSavesReady())) {
    throw new Error('Turn on cloud saves and sign in to Google Drive first.')
  }
  return enqueue(async () => {
    const ids = await collectThreadIds()
    return runSync(ids)
  })
}

export { getCloudSaveStatus }
