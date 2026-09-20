import { randomBytes } from 'crypto'
import {
  deleteDriveFile,
  downloadDriveFile,
  findDriveFile,
  getUserDataRootId,
  listDriveFiles,
  uploadDriveBytes,
  type DriveFile
} from '../cloud-saves/drive'
import {
  nextHead,
  parseHead,
  parseSnapshotFileName,
  recoveryFileOrder,
  snapshotFileName,
  staleSnapshotNames,
  snapshotsToKeep,
  USER_DATA_HEAD_NAME,
  type UserDataHead
} from './head'
import { parseEnvelope, serializeEnvelope, type UserDataPayload } from './snapshot'

export type RemoteUserData = {
  payload: UserDataPayload
  checksum: string
  fileName: string
  head: UserDataHead | null
}

async function readJsonFile(file: DriveFile): Promise<unknown> {
  const body = await downloadDriveFile(file.id)
  return JSON.parse(body.toString('utf8')) as unknown
}

async function loadHead(folderId: string, files: DriveFile[]): Promise<UserDataHead | null> {
  const named = files.find((file) => file.name === USER_DATA_HEAD_NAME)
  const found = named || (await findDriveFile(folderId, USER_DATA_HEAD_NAME))
  if (!found) return null
  try {
    return parseHead(await readJsonFile(found))
  } catch {
    return null
  }
}

async function loadVerifiedSnapshot(
  files: DriveFile[],
  fileName: string
): Promise<{ payload: UserDataPayload; checksum: string } | null> {
  const file = files.find((item) => item.name === fileName)
  if (!file) return null
  try {
    const body = await downloadDriveFile(file.id)
    return parseEnvelope(body)
  } catch {
    return null
  }
}

export async function downloadRemoteUserData(): Promise<RemoteUserData | null> {
  const folderId = await getUserDataRootId()
  const files = await listDriveFiles(folderId)
  const head = await loadHead(folderId, files)
  const names = files.map((file) => file.name)
  for (const fileName of recoveryFileOrder(head, names)) {
    const loaded = await loadVerifiedSnapshot(files, fileName)
    if (!loaded) continue
    return {
      payload: loaded.payload,
      checksum: loaded.checksum,
      fileName,
      head
    }
  }
  return null
}

export async function uploadRemoteUserData(payload: UserDataPayload): Promise<{
  checksum: string
  revision: number
  fileName: string
}> {
  const envelope = serializeEnvelope(payload)
  const folderId = await getUserDataRootId()
  const files = await listDriveFiles(folderId)
  const head = await loadHead(folderId, files)
  const nonce = randomBytes(4).toString('hex')
  const fileName = snapshotFileName(payload.revision, payload.updatedAt, nonce)
  await uploadDriveBytes({
    parentId: folderId,
    name: fileName,
    mimeType: 'application/json',
    body: envelope.bytes
  })
  const next = nextHead(head, {
    revision: payload.revision,
    checksum: envelope.checksum,
    fileName,
    updatedAt: payload.updatedAt
  })
  const existingHead = files.find((file) => file.name === USER_DATA_HEAD_NAME)
  try {
    await uploadDriveBytes({
      parentId: folderId,
      name: USER_DATA_HEAD_NAME,
      mimeType: 'application/json',
      existingId: existingHead?.id,
      body: Buffer.from(JSON.stringify(next), 'utf8')
    })
  } catch (error) {
    const uploaded = (await listDriveFiles(folderId)).find((file) => file.name === fileName)
    if (uploaded) {
      await deleteDriveFile(uploaded.id).catch(() => undefined)
    }
    throw error
  }
  const keep = snapshotsToKeep(next)
  const stale = staleSnapshotNames(
    (await listDriveFiles(folderId)).map((file) => file.name),
    keep
  )
  const latest = await listDriveFiles(folderId)
  await Promise.all(
    stale.map(async (name) => {
      const file = latest.find((item) => item.name === name)
      if (file) await deleteDriveFile(file.id).catch(() => undefined)
    })
  )
  return { checksum: envelope.checksum, revision: payload.revision, fileName }
}

export function isSnapshotName(name: string): boolean {
  return Boolean(parseSnapshotFileName(name))
}
