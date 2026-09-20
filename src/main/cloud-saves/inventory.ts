import type { CloudSaveGameDetail, CloudSaveGameSummary, CloudSaveRemoteFile } from '@shared/types'
import { mapLimit } from '../disk-usage'
import { listIdentifiedSaveFolders } from '../save-folders-store'
import {
  clearDriveCaches,
  deleteDriveFile,
  findGameFolderId,
  getDriveRootId,
  isDriveFolder,
  listAllAppDataFiles,
  listDriveChildren,
  listDriveFiles,
  listDriveFolders,
  type DriveFile
} from './drive'
import { hasCloudSaveSession } from './oauth'
import { classifySaveName, isCloudMetaName, isPersistentSaveName } from './select'
import { loadCloudManifest } from './remote-manifest'
import { localNameByHash, readGameManifest } from './local-manifest'
import { folderKey, localFolderHasFile, type SaveManifest } from './manifest'
import { gamesFromCloudTree } from './tree'
import { sendToRenderer } from '../windows'

let inventoryCache: { at: number; items: CloudSaveGameSummary[] } | null = null
const INVENTORY_TTL_MS = 8_000

export function invalidateCloudInventory(): void {
  inventoryCache = null
  sendToRenderer('cloud-saves:inventory-changed', true)
}

async function requireSession(): Promise<void> {
  if (!(await hasCloudSaveSession())) {
    throw new Error('Sign in to Google Drive first.')
  }
}

async function localTitles(): Promise<Map<number, string>> {
  const titles = new Map<number, string>()
  for (const rec of await listIdentifiedSaveFolders()) {
    if (rec.threadId && rec.title && !titles.has(rec.threadId)) titles.set(rec.threadId, rec.title)
  }
  try {
    const { listGameFiles } = await import('../game-files-store')
    for (const file of await listGameFiles()) {
      if (file.threadId && file.title && !titles.has(file.threadId)) titles.set(file.threadId, file.title)
    }
  } catch {
    // Library titles are optional.
  }
  return titles
}

function summaryFromTree(
  games: ReturnType<typeof gamesFromCloudTree>
): CloudSaveGameSummary[] {
  return games.map((game) => ({
    threadId: game.threadId,
    title: game.title,
    saveCount: game.saveCount,
    bytes: game.bytes,
    updatedAt: game.updatedAt
  }))
}

async function loadCloudTree(): Promise<ReturnType<typeof gamesFromCloudTree>> {
  const [rootId, items, titles] = await Promise.all([
    getDriveRootId(),
    listAllAppDataFiles(),
    localTitles()
  ])
  return gamesFromCloudTree(rootId, items, titles)
}

export async function listCloudSaveInventory(force = false): Promise<CloudSaveGameSummary[]> {
  if (!(await hasCloudSaveSession())) return []
  if (!force && inventoryCache && Date.now() - inventoryCache.at < INVENTORY_TTL_MS) {
    return inventoryCache.items
  }
  const items = summaryFromTree(await loadCloudTree())
  inventoryCache = { at: Date.now(), items }
  return items
}

function filesFromChildren(children: DriveFile[], folderKey: string): CloudSaveRemoteFile[] {
  const files: CloudSaveRemoteFile[] = []
  for (const child of children) {
    if (isDriveFolder(child) || isCloudMetaName(child.name)) continue
    // Raw Drive listings only understand legacy readable names; opaque blobs need the manifest.
    if (!classifySaveName(child.name)) continue
    files.push({
      name: child.name,
      size: child.size,
      modifiedAt: child.modifiedTime,
      folderKey,
      hash: '',
      presentLocally: false
    })
  }
  return files
}

function withLocalPresence(
  files: CloudSaveRemoteFile[],
  local: SaveManifest | null
): CloudSaveRemoteFile[] {
  return files.map((file) => ({
    ...file,
    presentLocally: localFolderHasFile(local, file.folderKey, file.name, file.hash)
  }))
}

export async function listCloudSavesForThread(threadId: number): Promise<CloudSaveGameDetail> {
  const id = Number(threadId)
  const empty: CloudSaveGameDetail = { threadId: id, title: '', files: [], syncedNames: [] }
  if (!id || !(await hasCloudSaveSession())) return empty
  const [local, titles] = await Promise.all([readGameManifest(id), localTitles()])
  const nameByHash = localNameByHash(local)
  const folderId = await findGameFolderId(id)
  if (!folderId) {
    return { ...empty, title: titles.get(id) || '' }
  }
  const cloud = await loadCloudManifest(folderId)
  let files: CloudSaveRemoteFile[] = []
  if (cloud?.folders.some((folder) => folder.files.length)) {
    files = cloud.folders.flatMap((folder) =>
      folder.files.map((file) => ({
        name: file.name,
        size: file.size,
        modifiedAt: file.modifiedAt,
        folderKey: folder.key,
        hash: file.hash,
        presentLocally: false
      }))
    )
  } else {
    const children = await listDriveChildren(folderId)
    const nested = children.filter(isDriveFolder)
    const nestedFiles = await mapLimit(nested, 4, async (folder) =>
      filesFromChildren(await listDriveFiles(folder.id), folder.name)
    )
    files = [...filesFromChildren(children, String(id)), ...nestedFiles.flat()]
  }
  files = withLocalPresence(files, local)
  files.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name))
  const identified = await listIdentifiedSaveFolders()
  const ownedKeys = new Set(
    identified
      .filter((item) => item.threadId === id)
      .map((item) => folderKey(item.folderName || ''))
  )
  const foreignKeys = new Set(
    identified
      .filter((item) => item.threadId && item.threadId !== id)
      .map((item) => folderKey(item.folderName || ''))
  )
  files = files.filter((file) => {
    if (isPersistentSaveName(file.name)) return false
    if (file.folderKey && foreignKeys.has(file.folderKey) && !ownedKeys.has(file.folderKey)) {
      return false
    }
    return true
  })
  const syncedNames = new Set<string>()
  if (local) {
    for (const folder of local.folders) {
      const cloudInFolder = files.filter((file) => file.folderKey === folder.key)
      const hashes = new Set(cloudInFolder.map((file) => file.hash).filter(Boolean))
      const names = new Set(cloudInFolder.map((file) => file.name))
      for (const file of folder.files) {
        if ((file.hash && hashes.has(file.hash)) || names.has(file.name)) {
          syncedNames.add(file.name)
        }
      }
    }
  }
  for (const file of files) {
    if (!file.presentLocally) continue
    if (file.hash) {
      const localName = nameByHash.get(file.hash)
      if (localName) syncedNames.add(localName)
    }
    syncedNames.add(file.name)
  }
  return {
    threadId: id,
    title: titles.get(id) || cloud?.title || `Thread ${id}`,
    files,
    syncedNames: [...syncedNames]
  }
}

export async function deleteCloudSavesForThread(threadId: number): Promise<void> {
  await requireSession()
  const id = Number(threadId)
  if (!id) return
  const folderId = await findGameFolderId(id)
  if (!folderId) return
  await deleteDriveFile(folderId)
  invalidateCloudInventory()
}

export async function deleteAllCloudSaves(): Promise<void> {
  await requireSession()
  const rootId = await getDriveRootId()
  const folders = await listDriveFolders(rootId)
  await mapLimit(folders, 4, async (folder) => {
    await deleteDriveFile(folder.id)
  })
  clearDriveCaches()
  invalidateCloudInventory()
}
