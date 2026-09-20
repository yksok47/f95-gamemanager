import { selectCloudSaves, type CloudSaveCandidate } from './select'
import {
  withRemoteName,
  type SaveManifestFile,
  type SaveManifestFolder
} from './manifest'

const MTIME_SKEW_MS = 2000

export type PlannedUpload = {
  name: string
  remoteName: string
  hash: string
  size: number
  modifiedAt: number
  kind: SaveManifestFile['kind']
}

export type PlannedDownload = {
  name: string
  remoteName: string
  hash: string
  size: number
  modifiedAt: number
  kind: SaveManifestFile['kind']
}

export type PlannedRename = {
  from: string
  to: string
  hash: string
}

export type PlannedDelete = {
  name: string
  remoteName: string
  hash: string
}

export type FolderSyncPlan = {
  uploads: PlannedUpload[]
  downloads: PlannedDownload[]
  remoteRenames: PlannedRename[]
  remoteDeletes: PlannedDelete[]
  localDeletes: PlannedDelete[]
  nextLocal: SaveManifestFolder
  nextCloud: SaveManifestFolder
}

function asCandidate(file: SaveManifestFile): CloudSaveCandidate {
  return {
    name: file.name,
    localPath: file.name,
    size: file.size,
    modifiedAt: file.modifiedAt,
    kind: file.kind
  }
}

function unhashedMatch(local: SaveManifestFile, remote: SaveManifestFile): boolean {
  if (local.hash && remote.hash) return local.hash === remote.hash
  if (local.name !== remote.name) return false
  if (local.size && remote.size && local.size !== remote.size) return false
  if (!local.modifiedAt || !remote.modifiedAt) return false
  return Math.abs(local.modifiedAt - remote.modifiedAt) <= MTIME_SKEW_MS
}

function newerFile(local: SaveManifestFile, remote: SaveManifestFile): SaveManifestFile {
  if (local.modifiedAt > remote.modifiedAt + MTIME_SKEW_MS) return local
  if (remote.modifiedAt > local.modifiedAt + MTIME_SKEW_MS) return remote
  if (local.size !== remote.size) return local.modifiedAt >= remote.modifiedAt ? local : remote
  return local.updatedAt >= remote.updatedAt ? local : remote
}

function fileId(file: SaveManifestFile): string {
  return file.hash || file.remoteName || `name:${file.name}`
}

function remoteKey(file: SaveManifestFile): string {
  return file.remoteName || file.name
}

function tombstonesFrom(
  files: readonly { hash: string; name: string }[],
  now: number
): SaveManifestFolder['deleted'] {
  const stones = new Map<string, SaveManifestFolder['deleted'][number]>()
  for (const file of files) {
    if (!file.hash || stones.has(file.hash)) continue
    stones.set(file.hash, { hash: file.hash, name: file.name, deletedAt: now })
  }
  return [...stones.values()].sort((a, b) => a.hash.localeCompare(b.hash))
}

function planAbandonedFolder(
  local: SaveManifestFolder,
  cloud: SaveManifestFolder,
  now: number
): FolderSyncPlan {
  const deleted = tombstonesFrom(
    [...local.deleted, ...cloud.deleted, ...local.files, ...cloud.files],
    now
  )
  const key = local.key || cloud.key
  const empty = { key, files: [] as SaveManifestFolder['files'], deleted }
  return {
    uploads: [],
    downloads: [],
    remoteRenames: [],
    remoteDeletes: cloud.files.map((file) => ({
      name: file.name,
      remoteName: remoteKey(file),
      hash: file.hash
    })),
    localDeletes: [],
    nextLocal: empty,
    nextCloud: empty
  }
}

/**
 * Compare local and cloud folder manifests and return the Drive/disk operations
 * needed to match them, including slot-limit pruning on the cloud side.
 *
 * Drive blobs are addressed by `remoteName` (opaque). Local renames only change
 * `name` in the manifests — no Drive rename. Edits change the hash, so the plan
 * uploads a new blob and deletes the old one.
 *
 * `localGone` means this save location was unmapped or the folder was removed:
 * delete every cloud file in it and do not download anything back.
 */
export function planFolderSync(
  local: SaveManifestFolder,
  cloud: SaveManifestFolder,
  keepCount: number,
  includeAutoQuick: boolean,
  now = Date.now(),
  localGone = false
): FolderSyncPlan {
  if (localGone) return planAbandonedFolder(local, cloud, now)
  const tombstoned = new Map(local.deleted.map((stone) => [stone.hash, stone]))
  const cloudTombstoned = new Map(cloud.deleted.map((stone) => [stone.hash, stone]))
  const localByHash = new Map(local.files.filter((file) => file.hash).map((file) => [file.hash, file]))
  const localByName = new Map(local.files.map((file) => [file.name, file]))
  const cloudByHash = new Map(cloud.files.filter((file) => file.hash).map((file) => [file.hash, file]))
  const cloudByRemote = new Map(cloud.files.map((file) => [remoteKey(file), file]))
  const cloudByName = new Map(cloud.files.map((file) => [file.name, file]))

  const mergedById = new Map<string, SaveManifestFile>()
  const localDeletes: PlannedDelete[] = []

  for (const file of local.files) {
    const cloudStone = file.hash ? cloudTombstoned.get(file.hash) : undefined
    if (cloudStone && cloudStone.deletedAt >= file.updatedAt) {
      localDeletes.push({
        name: file.name,
        remoteName: remoteKey(file),
        hash: file.hash
      })
      continue
    }
    const remote = file.hash
      ? cloudByHash.get(file.hash)
      : cloudByRemote.get(remoteKey(file)) || cloudByName.get(file.name)
    mergedById.set(
      fileId(file),
      withRemoteName({
        ...file,
        remoteName: file.remoteName || remote?.remoteName || ''
      })
    )
  }

  for (const remote of cloud.files) {
    const localStone = remote.hash ? tombstoned.get(remote.hash) : undefined
    if (localStone && localStone.deletedAt >= (remote.updatedAt || remote.modifiedAt)) continue
    if (remote.hash && localByHash.has(remote.hash) && mergedById.has(fileId(localByHash.get(remote.hash)!))) {
      continue
    }
    const localName = localByName.get(remote.name)
    if (localName) {
      mergedById.delete(fileId(localName))
      const winner = unhashedMatch(localName, remote)
        ? {
            ...localName,
            hash: localName.hash || remote.hash,
            remoteName: localName.remoteName || remote.remoteName || remote.name
          }
        : {
            ...newerFile(localName, remote),
            remoteName:
              newerFile(localName, remote).remoteName ||
              remote.remoteName ||
              localName.remoteName ||
              ''
          }
      mergedById.set(fileId(winner), withRemoteName({ ...winner, name: localName.name }))
      continue
    }
    mergedById.set(fileId(remote), withRemoteName(remote))
  }

  const merged = [...mergedById.values()].map(withRemoteName)
  const selected = selectCloudSaves(merged.map(asCandidate), keepCount, includeAutoQuick)
  const desiredNames = new Set(selected.map((item) => item.name))
  const desired = merged.filter((file) => desiredNames.has(file.name))
  const desiredByHash = new Map(desired.filter((file) => file.hash).map((file) => [file.hash, file]))
  const desiredByRemote = new Map(desired.map((file) => [remoteKey(file), file]))

  const uploads: PlannedUpload[] = []
  const downloads: PlannedDownload[] = []
  const remoteRenames: PlannedRename[] = []
  const remoteDeletes: PlannedDelete[] = []
  const nextLocalFiles = new Map(
    local.files
      .filter(
        (file) =>
          !localDeletes.some(
            (item) => item.hash === file.hash || item.name === file.name
          )
      )
      .map((file) => [file.name, withRemoteName({ ...file })])
  )

  for (const file of cloud.files) {
    const wanted = file.hash
      ? desiredByHash.get(file.hash)
      : desiredByRemote.get(remoteKey(file))
    if (!wanted) {
      remoteDeletes.push({
        name: file.name,
        remoteName: remoteKey(file),
        hash: file.hash
      })
    }
  }

  for (const file of desired) {
    const ready = withRemoteName(file)
    const localSameHash = ready.hash ? localByHash.get(ready.hash) : undefined
    const remoteSameHash = ready.hash ? cloudByHash.get(ready.hash) : undefined
    const remoteSameBlob =
      cloudByRemote.get(remoteKey(ready)) ||
      (ready.name ? cloudByName.get(ready.name) : undefined)

    if (localSameHash) {
      if (remoteSameHash) {
        const from = remoteKey(remoteSameHash)
        const to = remoteKey(ready)
        if (from && to && from !== to) {
          remoteRenames.push({ from, to, hash: ready.hash })
        }
      } else if (remoteSameBlob && unhashedMatch(ready, remoteSameBlob)) {
        const from = remoteKey(remoteSameBlob)
        const to = remoteKey(ready)
        if (from && to && from !== to) {
          remoteRenames.push({ from, to, hash: ready.hash })
        }
      } else {
        uploads.push({
          name: ready.name,
          remoteName: remoteKey(ready),
          hash: ready.hash,
          size: ready.size,
          modifiedAt: ready.modifiedAt,
          kind: ready.kind
        })
      }
      nextLocalFiles.set(ready.name, { ...ready, updatedAt: ready.updatedAt || now })
    } else {
      downloads.push({
        name: ready.name,
        remoteName: remoteKey(remoteSameHash || remoteSameBlob || ready),
        hash: ready.hash,
        size: ready.size,
        modifiedAt: ready.modifiedAt,
        kind: ready.kind
      })
      nextLocalFiles.set(ready.name, { ...ready, updatedAt: now })
    }
  }

  const uploadRemotes = new Set(uploads.map((item) => item.remoteName))
  const renameFrom = new Set(remoteRenames.map((item) => item.from))
  const filteredDeletes = remoteDeletes.filter(
    (item) => !uploadRemotes.has(item.remoteName) && !renameFrom.has(item.remoteName)
  )

  const nextCloudDeleted = [
    ...local.deleted.filter((stone) => !desiredByHash.has(stone.hash)),
    ...cloud.deleted.filter((stone) => !desiredByHash.has(stone.hash) && !tombstoned.has(stone.hash))
  ]
  const nextCloud: SaveManifestFolder = {
    key: local.key || cloud.key,
    files: desired
      .map((file) => withRemoteName({ ...file, updatedAt: file.updatedAt || now }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    deleted: nextCloudDeleted.sort((a, b) => a.hash.localeCompare(b.hash))
  }
  const keptTombstones = [
    ...local.deleted.filter((stone) => !desiredByHash.has(stone.hash)),
    ...localDeletes.map((item) => ({
      hash: item.hash,
      name: item.name,
      deletedAt: now
    }))
  ]
  const seenStones = new Set<string>()
  const nextLocalDeleted = keptTombstones.filter((stone) => {
    if (!stone.hash || seenStones.has(stone.hash)) return false
    seenStones.add(stone.hash)
    return true
  })
  const nextLocal: SaveManifestFolder = {
    key: local.key || cloud.key,
    files: [...nextLocalFiles.values()].sort((a, b) => a.name.localeCompare(b.name)),
    deleted: nextLocalDeleted
  }

  return {
    uploads,
    downloads,
    remoteRenames,
    remoteDeletes: filteredDeletes,
    localDeletes,
    nextLocal,
    nextCloud
  }
}

export function planHasWork(plan: FolderSyncPlan): boolean {
  return Boolean(
    plan.uploads.length ||
      plan.downloads.length ||
      plan.remoteRenames.length ||
      plan.remoteDeletes.length ||
      plan.localDeletes.length
  )
}

/** True when cloud manifest rows differ enough that Drive's manifest.json must be rewritten. */
export function planNeedsCloudManifest(plan: FolderSyncPlan, prevCloud: SaveManifestFolder): boolean {
  if (planHasWork(plan)) return true
  if (plan.nextCloud.files.length !== prevCloud.files.length) return true
  if (plan.nextCloud.deleted.length !== prevCloud.deleted.length) return true
  const prevByHash = new Map(prevCloud.files.map((file) => [file.hash || file.name, file]))
  for (const file of plan.nextCloud.files) {
    const prev = prevByHash.get(file.hash || file.name)
    if (!prev) return true
    if (prev.name !== file.name) return true
    if (remoteKey(prev) !== remoteKey(file)) return true
    if (prev.hash !== file.hash) return true
    if (prev.updatedAt !== file.updatedAt) return true
  }
  return false
}
