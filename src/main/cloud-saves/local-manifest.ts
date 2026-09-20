import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises'
import { join } from 'path'
import { hashFile } from '../hash'
import { getAppPaths } from '../paths'
import { getIdentifiedSaveFolder } from '../save-folders-store'
import { mapLimit } from '../disk-usage'
import { pathExists, toFsPath } from '../win-path'
import { classifySaveName } from './select'
import {
  abandonUnsourcedFolders,
  applyFolderDelete,
  applyFolderEdit,
  applyFolderRename,
  emptyManifest,
  folderByKey,
  folderKeyForDir,
  LOCAL_FOLDER_MANIFEST_NAME,
  parseManifestJson,
  recheckFolder,
  serializeManifest,
  upsertFolder,
  type DiskSaveFile,
  type SaveManifest,
  type SaveManifestFolder
} from './manifest'

const UNSTABLE_MS = 2000
const HASH_CONCURRENCY = 8

function manifestPath(threadId: number): string {
  return join(getAppPaths().cloudSaveManifestsDir, `${threadId}.json`)
}

export async function readGameManifest(threadId: number): Promise<SaveManifest | null> {
  const id = Number(threadId)
  if (!id) return null
  const file = manifestPath(id)
  if (!pathExists(file)) return null
  const text = await readFile(toFsPath(file), 'utf8').catch(() => '')
  const parsed = parseManifestJson(text)
  return parsed?.threadId === id ? parsed : null
}

export async function writeGameManifest(manifest: SaveManifest): Promise<void> {
  if (!manifest.threadId) return
  const dir = getAppPaths().cloudSaveManifestsDir
  await mkdir(toFsPath(dir), { recursive: true })
  await writeFile(toFsPath(manifestPath(manifest.threadId)), serializeManifest(manifest), 'utf8')
}

export async function readFolderManifest(saveDir: string): Promise<SaveManifest | null> {
  if (!saveDir || !pathExists(saveDir)) return null
  const file = join(saveDir, LOCAL_FOLDER_MANIFEST_NAME)
  if (!pathExists(file)) return null
  const text = await readFile(toFsPath(file), 'utf8').catch(() => '')
  return parseManifestJson(text)
}

export async function writeFolderManifest(
  saveDir: string,
  manifest: SaveManifest,
  folderKey: string
): Promise<void> {
  if (!saveDir || !pathExists(saveDir)) return
  const folder = folderByKey(manifest, folderKey)
  const copy: SaveManifest = {
    ...manifest,
    folders: [{ ...folder, key: folderKey }]
  }
  await writeFile(toFsPath(join(saveDir, LOCAL_FOLDER_MANIFEST_NAME)), serializeManifest(copy), 'utf8')
}

export async function clearFolderManifest(saveDir: string): Promise<void> {
  if (!saveDir || !pathExists(saveDir)) return
  const file = join(saveDir, LOCAL_FOLDER_MANIFEST_NAME)
  if (!pathExists(file)) return
  await rm(toFsPath(file), { force: true })
}

export async function writeIdentityManifest(
  saveDir: string,
  threadId: number,
  title: string,
  folderName?: string
): Promise<void> {
  if (!saveDir || !threadId || !pathExists(saveDir)) return
  const existing = await readFolderManifest(saveDir)
  const key = folderKeyForDir(saveDir, folderName)
  const base = existing?.threadId === threadId ? existing : emptyManifest(threadId, title, Date.now())
  await writeFolderManifest(
    saveDir,
    {
      ...base,
      threadId,
      title: title || base.title,
      updatedAt: Date.now()
    },
    key
  )
}

export async function listDiskSaves(
  dir: string
): Promise<{ files: DiskSaveFile[]; skipped: string[] }> {
  if (!pathExists(dir)) return { files: [], skipped: [] }
  const entries = await readdir(toFsPath(dir), { withFileTypes: true }).catch(() => [])
  const skipped: string[] = []
  const candidates = entries.filter((entry) => entry.isFile() && classifySaveName(entry.name))
  const files = await mapLimit(candidates, HASH_CONCURRENCY, async (entry) => {
    const kind = classifySaveName(entry.name)
    if (!kind) return null
    const localPath = join(dir, entry.name)
    const info = await stat(toFsPath(localPath)).catch(() => null)
    if (!info?.isFile()) return null
    if (Date.now() - info.mtimeMs < UNSTABLE_MS) {
      skipped.push(entry.name)
      return null
    }
    const hash = await hashFile(localPath).catch(() => '')
    if (!hash) return null
    return {
      name: entry.name,
      hash,
      size: info.size,
      modifiedAt: info.mtimeMs,
      kind
    } satisfies DiskSaveFile
  })
  return {
    files: files.filter((item): item is DiskSaveFile => Boolean(item)),
    skipped
  }
}

export async function recheckLocalManifest(
  threadId: number,
  title: string,
  sources: Array<{ key: string; localDir: string }>
): Promise<SaveManifest> {
  const prev = (await readGameManifest(threadId)) ?? emptyManifest(threadId, title)
  const now = Date.now()
  let next: SaveManifest = {
    ...prev,
    threadId,
    title: title || prev.title,
    updatedAt: now
  }
  const seen = new Set<string>()
  for (const source of sources) {
    seen.add(source.key)
    const disk = await listDiskSaves(source.localDir)
    const folder = recheckFolder(folderByKey(prev, source.key), disk.files, now, disk.skipped)
    next = upsertFolder(next, { ...folder, key: source.key })
    await writeFolderManifest(source.localDir, next, source.key)
  }
  next = abandonUnsourcedFolders(next, seen, now)
  next = {
    ...next,
    folders: next.folders.filter(
      (folder) => seen.has(folder.key) || folder.files.length > 0 || folder.deleted.length > 0
    )
  }
  await writeGameManifest(next)
  return next
}

type FolderTarget = {
  threadId: number
  title: string
  folderKey: string
  saveDir: string
}

async function resolveTarget(
  saveDir: string,
  hint?: { threadId?: number; title?: string; folderKey?: string }
): Promise<FolderTarget | null> {
  const rec = await getIdentifiedSaveFolder(saveDir)
  const folder = await readFolderManifest(saveDir)
  const threadId = Number(hint?.threadId || rec?.threadId || folder?.threadId || 0)
  if (!threadId) return null
  return {
    threadId,
    title: hint?.title || rec?.title || folder?.title || '',
    folderKey: hint?.folderKey || folderKeyForDir(saveDir, rec?.folderName),
    saveDir
  }
}

async function updateFolder(
  target: FolderTarget,
  mutate: (folder: SaveManifestFolder, now: number) => SaveManifestFolder
): Promise<void> {
  const prev = (await readGameManifest(target.threadId)) ?? emptyManifest(target.threadId, target.title)
  const now = Date.now()
  const next = upsertFolder(prev, mutate(folderByKey(prev, target.folderKey), now))
  next.title = target.title || next.title
  next.updatedAt = now
  await writeGameManifest(next)
  await writeFolderManifest(target.saveDir, next, target.folderKey)
}

export async function recordLocalSaveDeletes(
  saveDir: string,
  names: string[],
  hint?: { threadId?: number; title?: string; folderKey?: string }
): Promise<void> {
  const target = await resolveTarget(saveDir, hint)
  if (!target || !names.length) return
  const unique = [...new Set(names.filter(Boolean))]
  const hashes = new Map<string, string>()
  const prev = (await readGameManifest(target.threadId)) ?? emptyManifest(target.threadId, target.title)
  const folder = folderByKey(prev, target.folderKey)
  for (const name of unique) {
    const existing = folder.files.find((file) => file.name === name)
    const hash =
      existing?.hash ||
      (await hashFile(join(target.saveDir, name)).catch(() => ''))
    if (hash) hashes.set(name, hash)
  }
  await updateFolder(target, (current, now) => {
    let next = current
    for (const name of unique) {
      next = applyFolderDelete(next, name, hashes.get(name) || '', now)
    }
    return next
  })
}

export async function recordLocalSaveRename(
  saveDir: string,
  fromName: string,
  toName: string,
  hint?: { threadId?: number; title?: string; folderKey?: string }
): Promise<void> {
  if (!fromName || !toName || fromName === toName) return
  const target = await resolveTarget(saveDir, hint)
  if (!target) return
  await updateFolder(target, (folder, now) => applyFolderRename(folder, fromName, toName, now))
}

export async function recordLocalSaveEdit(
  saveDir: string,
  name: string,
  hint?: { threadId?: number; title?: string; folderKey?: string }
): Promise<void> {
  if (!name) return
  const target = await resolveTarget(saveDir, hint)
  if (!target) return
  const localPath = join(saveDir, name)
  const info = await stat(toFsPath(localPath)).catch(() => null)
  if (!info?.isFile()) return
  const kind = classifySaveName(name)
  if (!kind) return
  const hash = await hashFile(localPath).catch(() => '')
  if (!hash) return
  await updateFolder(target, (folder, now) =>
    applyFolderEdit(
      folder,
      name,
      { hash, name, size: info.size, modifiedAt: info.mtimeMs, kind },
      now
    )
  )
}

export async function recordLocalSaveFolderCleared(
  saveDir: string,
  hint?: { threadId?: number; title?: string; folderKey?: string }
): Promise<void> {
  const target = await resolveTarget(saveDir, hint)
  if (!target) return
  const disk = await listDiskSaves(saveDir)
  const names = new Set(disk.files.map((file) => file.name))
  const prev = (await readGameManifest(target.threadId)) ?? emptyManifest(target.threadId, target.title)
  for (const file of folderByKey(prev, target.folderKey).files) names.add(file.name)
  await recordLocalSaveDeletes(saveDir, [...names], hint)
}

export function localNameByHash(manifest: SaveManifest | null): Map<string, string> {
  const map = new Map<string, string>()
  if (!manifest) return map
  for (const folder of manifest.folders) {
    for (const file of folder.files) {
      if (file.hash) map.set(file.hash, file.name)
    }
  }
  return map
}

export function localHashes(manifest: SaveManifest | null): Set<string> {
  const hashes = new Set<string>()
  if (!manifest) return hashes
  for (const folder of manifest.folders) {
    for (const file of folder.files) {
      if (file.hash) hashes.add(file.hash)
    }
  }
  return hashes
}

export { folderByKey, LOCAL_FOLDER_MANIFEST_NAME }
