import {
  CLOUD_LEGACY_META_NAME,
  CLOUD_MANIFEST_NAME,
  emptyFolder,
  parseManifest,
  parseManifestJson,
  serializeManifest,
  type SaveManifest,
  type SaveManifestFolder
} from './manifest'
import { classifySaveName, isCloudBlobName } from './select'
import {
  findChildFolderId,
  findDriveFile,
  listDriveFiles,
  patchDriveMetadata,
  uploadDriveBytes,
  downloadDriveFile,
  type DriveFile
} from './drive'

export function folderFromDriveFiles(key: string, files: DriveFile[]): SaveManifestFolder {
  const entries = files
    .map((file) => {
      if (isCloudBlobName(file.name)) {
        // Opaque blobs without a manifest cannot be mapped to a local name.
        return null
      }
      const kind = classifySaveName(file.name)
      if (!kind) return null
      return {
        hash: '',
        name: file.name,
        remoteName: file.name,
        size: file.size,
        modifiedAt: file.modifiedTime,
        kind,
        updatedAt: file.modifiedTime
      }
    })
    .filter((item): item is SaveManifestFolder['files'][number] => Boolean(item))
  return { key, files: entries, deleted: [] }
}

export async function loadCloudManifest(gameFolderId: string): Promise<SaveManifest | null> {
  const existing = await findDriveFile(gameFolderId, CLOUD_MANIFEST_NAME)
  if (existing) {
    const body = await downloadDriveFile(existing.id)
    const parsed = parseManifestJson(body.toString('utf8'))
    if (parsed) return parsed
  }
  const legacy = await findDriveFile(gameFolderId, CLOUD_LEGACY_META_NAME)
  if (!legacy) return null
  const body = await downloadDriveFile(legacy.id)
  try {
    const raw = JSON.parse(body.toString('utf8')) as { threadId?: number; title?: string }
    return parseManifest({
      version: 1,
      threadId: raw.threadId,
      title: raw.title,
      updatedAt: legacy.modifiedTime,
      folders: []
    })
  } catch {
    return null
  }
}

export async function saveCloudManifest(gameFolderId: string, manifest: SaveManifest): Promise<void> {
  const existing = await findDriveFile(gameFolderId, CLOUD_MANIFEST_NAME)
  const body = Buffer.from(serializeManifest(manifest), 'utf8')
  await Promise.all([
    uploadDriveBytes({
      parentId: gameFolderId,
      name: CLOUD_MANIFEST_NAME,
      mimeType: 'application/json',
      existingId: existing?.id,
      body
    }),
    patchDriveMetadata(gameFolderId, {
      appProperties: {
        f95gm: `game-${manifest.threadId}`,
        title: manifest.title.trim().slice(0, 120)
      }
    }).catch(() => undefined)
  ])
}

export async function loadCloudFolder(
  parentId: string,
  key: string,
  known: SaveManifest | null
): Promise<SaveManifestFolder> {
  const fromManifest = known?.folders.find((folder) => folder.key === key)
  if (fromManifest && (fromManifest.files.length || known?.updatedAt)) return fromManifest
  const folderId = await findChildFolderId(parentId, key)
  if (!folderId) return fromManifest ?? emptyFolder(key)
  return folderFromDriveFiles(key, await listDriveFiles(folderId))
}
