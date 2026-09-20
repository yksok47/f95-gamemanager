import { basename } from 'path'
import type { CloudSaveKind } from './select'
import { cloudBlobName, isCloudMetaName } from './select'

export const MANIFEST_VERSION = 1
export const CLOUD_MANIFEST_NAME = 'manifest.json'
export const CLOUD_LEGACY_META_NAME = 'game.json'
export const LOCAL_FOLDER_MANIFEST_NAME = 'f95gm-manifest.json'

export type SaveManifestFile = {
  hash: string
  /** Local filename on disk (e.g. `1-2.save`). */
  name: string
  /** Opaque Drive blob name (e.g. `f95gm-<hash>`). Empty until first upload. */
  remoteName: string
  size: number
  modifiedAt: number
  kind: CloudSaveKind
  updatedAt: number
}

export type SaveManifestTombstone = {
  hash: string
  name: string
  deletedAt: number
}

export type SaveManifestFolder = {
  key: string
  files: SaveManifestFile[]
  deleted: SaveManifestTombstone[]
}

export type SaveManifest = {
  version: 1
  threadId: number
  title: string
  updatedAt: number
  folders: SaveManifestFolder[]
}

export type DiskSaveFile = {
  hash: string
  name: string
  size: number
  modifiedAt: number
  kind: CloudSaveKind
}

export function isManifestFileName(name: string): boolean {
  return isCloudMetaName(name)
}

export function folderKey(name: string): string {
  const trimmed = name.trim() || 'saves'
  return trimmed.replace(/[\\/]/g, '_').slice(0, 120)
}

export function folderKeyForDir(localDir: string, folderName?: string): string {
  return folderKey(folderName || basename(localDir))
}

export function emptyFolder(key: string): SaveManifestFolder {
  return { key, files: [], deleted: [] }
}

export function emptyManifest(threadId: number, title = '', updatedAt = 0): SaveManifest {
  return {
    version: MANIFEST_VERSION,
    threadId,
    title,
    updatedAt,
    folders: []
  }
}

export function folderByKey(manifest: SaveManifest, key: string): SaveManifestFolder {
  return manifest.folders.find((folder) => folder.key === key) ?? emptyFolder(key)
}

export function localFolderHasFile(
  local: SaveManifest | null,
  folderKey: string,
  name: string,
  hash = ''
): boolean {
  if (!local || !folderKey) return false
  const folder = folderByKey(local, folderKey)
  if (hash && folder.files.some((file) => file.hash === hash)) return true
  return folder.files.some((file) => file.name === name)
}

export function upsertFolder(manifest: SaveManifest, folder: SaveManifestFolder): SaveManifest {
  const folders = manifest.folders.filter((item) => item.key !== folder.key)
  folders.push(folder)
  folders.sort((a, b) => a.key.localeCompare(b.key))
  return { ...manifest, folders }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function asKind(value: unknown): CloudSaveKind | null {
  if (value === 'slot' || value === 'auto' || value === 'quick' || value === 'always') return value
  return null
}

function parseFile(value: unknown): SaveManifestFile | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SaveManifestFile>
  const name = asText(raw.name)
  const kind = asKind(raw.kind)
  if (!name || !kind) return null
  const hash = asText(raw.hash)
  const remoteName = asText(raw.remoteName) || (hash ? cloudBlobName(hash) : '')
  return {
    hash,
    name,
    remoteName,
    size: Math.max(0, asNumber(raw.size)),
    modifiedAt: asNumber(raw.modifiedAt),
    kind,
    updatedAt: asNumber(raw.updatedAt) || asNumber(raw.modifiedAt)
  }
}

/** Ensure a file row has an opaque Drive name derived from its content hash. */
export function withRemoteName(file: SaveManifestFile): SaveManifestFile {
  if (file.remoteName) return file
  if (!file.hash) return file
  return { ...file, remoteName: cloudBlobName(file.hash) }
}

function parseTombstone(value: unknown): SaveManifestTombstone | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SaveManifestTombstone>
  const hash = asText(raw.hash)
  const name = asText(raw.name)
  const deletedAt = asNumber(raw.deletedAt)
  if (!hash || !name || !deletedAt) return null
  return { hash, name, deletedAt }
}

function parseFolder(value: unknown): SaveManifestFolder | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SaveManifestFolder> & { key?: unknown }
  const key = asText(raw.key) || 'saves'
  const files = Array.isArray(raw.files)
    ? raw.files.map(parseFile).filter((item): item is SaveManifestFile => Boolean(item))
    : []
  const deleted = Array.isArray(raw.deleted)
    ? raw.deleted.map(parseTombstone).filter((item): item is SaveManifestTombstone => Boolean(item))
    : []
  return { key, files, deleted }
}

export function parseManifest(value: unknown): SaveManifest | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<SaveManifest> & { threadId?: unknown }
  const threadId = asNumber(raw.threadId)
  if (!Number.isInteger(threadId) || threadId <= 0) return null
  const folders = Array.isArray(raw.folders)
    ? raw.folders.map(parseFolder).filter((item): item is SaveManifestFolder => Boolean(item))
    : []
  return {
    version: MANIFEST_VERSION,
    threadId,
    title: asText(raw.title),
    updatedAt: asNumber(raw.updatedAt),
    folders
  }
}

export function parseManifestJson(text: string): SaveManifest | null {
  try {
    return parseManifest(JSON.parse(text) as unknown)
  } catch {
    return null
  }
}

export function serializeManifest(manifest: SaveManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`
}

function upsertTombstone(
  deleted: SaveManifestTombstone[],
  stone: SaveManifestTombstone
): SaveManifestTombstone[] {
  const next = deleted.filter((item) => item.hash !== stone.hash)
  next.push(stone)
  next.sort((a, b) => a.hash.localeCompare(b.hash))
  return next
}

/**
 * Compare a previous folder snapshot to hashed files on disk.
 * Detects new files, edits, slot renames (same hash), and user deletes (tombstones).
 * `skippedNames` are files that exist but were too new to hash — keep the previous row.
 */
export function recheckFolder(
  prev: SaveManifestFolder,
  disk: readonly DiskSaveFile[],
  now: number,
  skippedNames: readonly string[] = []
): SaveManifestFolder {
  const skipped = new Set(skippedNames)
  const diskByHash = new Map(disk.map((file) => [file.hash, file]))
  const diskByName = new Map(disk.map((file) => [file.name, file]))
  const prevByHash = new Map(prev.files.map((file) => [file.hash, file]))
  const prevByName = new Map(prev.files.map((file) => [file.name, file]))
  const files: SaveManifestFile[] = []
  const seenHashes = new Set<string>()
  let deleted = prev.deleted.filter((stone) => !diskByHash.has(stone.hash))

  for (const file of disk) {
    const sameHash = prevByHash.get(file.hash)
    const sameName = prevByName.get(file.name)
    if (sameHash) {
      files.push(
        withRemoteName({
          ...sameHash,
          name: file.name,
          size: file.size,
          modifiedAt: file.modifiedAt,
          kind: file.kind,
          updatedAt: sameHash.name === file.name ? sameHash.updatedAt : now
        })
      )
    } else if (sameName) {
      files.push(
        withRemoteName({
          hash: file.hash,
          name: file.name,
          remoteName: cloudBlobName(file.hash),
          size: file.size,
          modifiedAt: file.modifiedAt,
          kind: file.kind,
          updatedAt: now
        })
      )
      if (sameName.hash && !diskByHash.has(sameName.hash)) {
        deleted = upsertTombstone(deleted, {
          hash: sameName.hash,
          name: sameName.name,
          deletedAt: now
        })
      }
    } else {
      files.push(
        withRemoteName({
          hash: file.hash,
          name: file.name,
          remoteName: cloudBlobName(file.hash),
          size: file.size,
          modifiedAt: file.modifiedAt,
          kind: file.kind,
          updatedAt: now
        })
      )
    }
    seenHashes.add(file.hash)
  }

  for (const prevFile of prev.files) {
    if (skipped.has(prevFile.name) && !diskByName.has(prevFile.name)) {
      if (!seenHashes.has(prevFile.hash)) {
        files.push(prevFile)
        seenHashes.add(prevFile.hash)
      }
      continue
    }
    if (seenHashes.has(prevFile.hash)) continue
    if (diskByName.has(prevFile.name)) continue
    deleted = upsertTombstone(deleted, {
      hash: prevFile.hash,
      name: prevFile.name,
      deletedAt: now
    })
  }

  files.sort((a, b) => a.name.localeCompare(b.name) || a.hash.localeCompare(b.hash))
  return { key: prev.key, files, deleted }
}

/**
 * Folders that are no longer live local sources (unmapped or deleted) are treated
 * as empty on disk so their files become tombstones for cloud delete.
 */
export function abandonUnsourcedFolders(
  manifest: SaveManifest,
  liveKeys: ReadonlySet<string>,
  now: number
): SaveManifest {
  let next = manifest
  for (const folder of manifest.folders) {
    if (liveKeys.has(folder.key)) continue
    next = upsertFolder(next, recheckFolder(folder, [], now))
  }
  return next
}

export type SyncSource = {
  key: string
  title: string
  localDir: string
}

export type CloudSyncFolder = SyncSource & {
  localGone: boolean
}

/**
 * Live local folders plus leftover manifest folders that were unmapped or deleted.
 * Leftovers are marked `localGone` so sync deletes their cloud copies.
 */
export function collectSyncFolders(
  sources: readonly SyncSource[],
  manifest: SaveManifest,
  dirExists: (dir: string) => boolean
): CloudSyncFolder[] {
  const title = sources.find((item) => item.title)?.title || manifest.title
  const seen = new Set<string>()
  const folders: CloudSyncFolder[] = []
  for (const source of sources) {
    if (seen.has(source.key)) continue
    seen.add(source.key)
    folders.push({
      ...source,
      localGone: !source.localDir || !dirExists(source.localDir)
    })
  }
  for (const folder of manifest.folders) {
    if (seen.has(folder.key)) continue
    if (!folder.files.length && !folder.deleted.length) continue
    seen.add(folder.key)
    folders.push({
      key: folder.key,
      title,
      localDir: '',
      localGone: true
    })
  }
  return folders
}

export function applyFolderDelete(
  folder: SaveManifestFolder,
  name: string,
  hash: string,
  now: number
): SaveManifestFolder {
  if (!hash) {
    return {
      ...folder,
      files: folder.files.filter((file) => file.name !== name)
    }
  }
  return {
    key: folder.key,
    files: folder.files.filter((file) => file.name !== name && file.hash !== hash),
    deleted: upsertTombstone(folder.deleted, { hash, name, deletedAt: now })
  }
}

export function applyFolderRename(
  folder: SaveManifestFolder,
  fromName: string,
  toName: string,
  now: number
): SaveManifestFolder {
  return {
    ...folder,
    files: folder.files.map((file) =>
      file.name === fromName
        ? withRemoteName({ ...file, name: toName, updatedAt: now })
        : file
    )
  }
}

export function applyFolderEdit(
  folder: SaveManifestFolder,
  name: string,
  next: DiskSaveFile,
  now: number
): SaveManifestFolder {
  const prev = folder.files.find((file) => file.name === name)
  let deleted = folder.deleted.filter((stone) => stone.hash !== next.hash)
  const files = folder.files.filter((file) => file.name !== name)
  if (prev?.hash && prev.hash !== next.hash) {
    deleted = upsertTombstone(deleted, { hash: prev.hash, name, deletedAt: now })
  }
  files.push(
    withRemoteName({
      hash: next.hash,
      name,
      remoteName: cloudBlobName(next.hash),
      size: next.size,
      modifiedAt: next.modifiedAt,
      kind: next.kind,
      updatedAt: now
    })
  )
  files.sort((a, b) => a.name.localeCompare(b.name))
  return { key: folder.key, files, deleted }
}
