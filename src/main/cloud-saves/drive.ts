import { readFile } from 'fs/promises'
import { toFsPath } from '../win-path'
import { getAccessToken } from './oauth'

const DRIVE_API = 'https://www.googleapis.com/drive/v3'
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const APP_DATA_SPACE = 'appDataFolder'
const ROOT_NAME = 'F95 Game Manager Saves'
const ROOT_FLAG = 'cloud-saves-root'
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,size,md5Checksum,parents,appProperties'
const MAX_INFLIGHT = 6
const RETRY_STATUSES = new Set([403, 429, 500, 502, 503, 504])

export type DriveFile = {
  id: string
  name: string
  mimeType: string
  modifiedTime: number
  size: number
  md5Checksum?: string
  parentIds: string[]
  appProperties: Record<string, string>
}

const folderCache = new Map<string, string>()
let rootIdPromise: Promise<string> | null = null
let inflight = 0
const waiters: Array<() => void> = []

export function clearDriveCaches(): void {
  folderCache.clear()
  rootIdPromise = null
}

function folderCacheKey(parentId: string, name: string): string {
  return `${parentId}\n${name}`
}

function rememberFolder(parentId: string, name: string, id: string): string {
  folderCache.set(folderCacheKey(parentId, name), id)
  return id
}

function asBody(data: Buffer): Blob {
  const copy = new Uint8Array(data.byteLength)
  copy.set(data)
  return new Blob([copy])
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withDriveSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_INFLIGHT) {
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
  inflight += 1
  try {
    return await fn()
  } finally {
    inflight -= 1
    waiters.shift()?.()
  }
}

function retryDelayMs(attempt: number, retryAfter?: string | null): number {
  const header = Number(retryAfter)
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 20_000)
  return Math.min(400 * 2 ** attempt, 8_000)
}

async function driveFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return withDriveSlot(async () => {
    let token = await getAccessToken()
    for (let attempt = 0; attempt < 5; attempt++) {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${token}`)
      let res: Response
      try {
        res = await fetch(url, { ...init, headers })
      } catch (error) {
        if (attempt < 4) {
          await sleep(retryDelayMs(attempt))
          continue
        }
        throw error
      }
      if (res.status === 401 && attempt === 0) {
        token = await getAccessToken()
        continue
      }
      if (RETRY_STATUSES.has(res.status) && attempt < 4) {
        await sleep(retryDelayMs(attempt, res.headers.get('retry-after')))
        continue
      }
      return res
    }
    throw new Error('Google Drive request failed after retries.')
  })
}

async function driveJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await driveFetch(url, init)
  const json = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok) {
    throw new Error(json.error?.message || `Google Drive request failed (${res.status})`)
  }
  return json
}

function parseFile(raw: {
  id?: string
  name?: string
  mimeType?: string
  modifiedTime?: string
  size?: string
  md5Checksum?: string
  parents?: string[]
  appProperties?: Record<string, string>
}): DriveFile | null {
  if (!raw.id || !raw.name) return null
  return {
    id: raw.id,
    name: raw.name,
    mimeType: raw.mimeType || 'application/octet-stream',
    modifiedTime: raw.modifiedTime ? Date.parse(raw.modifiedTime) : 0,
    size: Number(raw.size) || 0,
    md5Checksum: raw.md5Checksum,
    parentIds: Array.isArray(raw.parents) ? raw.parents.filter((id) => typeof id === 'string' && id) : [],
    appProperties: raw.appProperties && typeof raw.appProperties === 'object' ? raw.appProperties : {}
  }
}

async function listByQuery(query: string, pageSize = 1000, firstPageOnly = false): Promise<DriveFile[]> {
  const files: DriveFile[] = []
  let pageToken = ''
  while (true) {
    const url = new URL(`${DRIVE_API}/files`)
    url.searchParams.set('q', query)
    url.searchParams.set('fields', `nextPageToken,files(${FILE_FIELDS})`)
    url.searchParams.set('pageSize', String(pageSize))
    url.searchParams.set('spaces', APP_DATA_SPACE)
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const json = await driveJson<{ nextPageToken?: string; files?: unknown[] }>(url.toString())
    for (const item of json.files || []) {
      const file = parseFile(item as Parameters<typeof parseFile>[0])
      if (file) files.push(file)
    }
    pageToken = json.nextPageToken || ''
    if (!pageToken || firstPageOnly) break
  }
  return files
}

async function listChildren(parentId: string, foldersOnly = false): Promise<DriveFile[]> {
  const folderFilter = foldersOnly ? ` and mimeType = '${FOLDER_MIME}'` : ''
  const files = await listByQuery(
    `'${escapeQuery(parentId)}' in parents and trashed = false${folderFilter}`
  )
  for (const file of files) {
    if (!file.parentIds.length) file.parentIds = [parentId]
    if (file.mimeType === FOLDER_MIME) rememberFolder(parentId, file.name, file.id)
  }
  return files
}

async function findNamedChild(
  parentId: string,
  name: string,
  foldersOnly: boolean
): Promise<DriveFile | null> {
  const typeFilter = foldersOnly
    ? ` and mimeType = '${FOLDER_MIME}'`
    : ` and mimeType != '${FOLDER_MIME}'`
  const matches = await listByQuery(
    `name = '${escapeQuery(name)}' and '${escapeQuery(parentId)}' in parents and trashed = false${typeFilter}`,
    10,
    true
  )
  const match = matches[0] || null
  if (match?.mimeType === FOLDER_MIME) rememberFolder(parentId, name, match.id)
  return match
}

async function createFolder(
  name: string,
  parentId: string,
  appProperties?: Record<string, string>
): Promise<DriveFile> {
  const created = await driveJson<Parameters<typeof parseFile>[0]>(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME,
      parents: [parentId],
      appProperties
    })
  })
  const file = parseFile(created)
  if (!file) throw new Error('Google Drive did not return the new folder.')
  rememberFolder(parentId, name, file.id)
  return file
}

async function findOrCreateFolder(
  name: string,
  parentId: string,
  appProperties?: Record<string, string>
): Promise<string> {
  const cached = folderCache.get(folderCacheKey(parentId, name))
  if (cached) return cached
  const existing = await findNamedChild(parentId, name, true)
  if (existing) return existing.id
  return (await createFolder(name, parentId, appProperties)).id
}

async function resolveRootId(): Promise<string> {
  const url = new URL(`${DRIVE_API}/files`)
  url.searchParams.set(
    'q',
    `appProperties has { key='f95gm' and value='${ROOT_FLAG}' } and mimeType = '${FOLDER_MIME}' and trashed = false`
  )
  url.searchParams.set('fields', `files(${FILE_FIELDS})`)
  url.searchParams.set('spaces', APP_DATA_SPACE)
  const json = await driveJson<{ files?: unknown[] }>(url.toString())
  const existing = (json.files || [])
    .map((item) => parseFile(item as Parameters<typeof parseFile>[0]))
    .find(Boolean)
  if (existing) return existing.id
  const created = await driveJson<Parameters<typeof parseFile>[0]>(`${DRIVE_API}/files`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: ROOT_NAME,
      mimeType: FOLDER_MIME,
      parents: [APP_DATA_SPACE],
      appProperties: { f95gm: ROOT_FLAG }
    })
  })
  const file = parseFile(created)
  if (!file) throw new Error('Could not create the Google Drive saves folder.')
  return file.id
}

export async function getDriveRootId(): Promise<string> {
  rootIdPromise ??= resolveRootId().catch((error) => {
    rootIdPromise = null
    throw error
  })
  return rootIdPromise
}

export async function getGameFolderId(threadId: number, title?: string): Promise<string> {
  const rootId = await getDriveRootId()
  const props: Record<string, string> = { f95gm: `game-${threadId}` }
  const trimmed = title?.trim().slice(0, 120)
  if (trimmed) props.title = trimmed
  return findOrCreateFolder(String(threadId), rootId, props)
}

export async function findGameFolderId(threadId: number): Promise<string | null> {
  const rootId = await getDriveRootId()
  const cached = folderCache.get(folderCacheKey(rootId, String(threadId)))
  if (cached) return cached
  const existing = await findNamedChild(rootId, String(threadId), true)
  return existing?.id || null
}

export async function getChildFolderId(parentId: string, name: string): Promise<string> {
  return findOrCreateFolder(name, parentId)
}

export async function findChildFolderId(parentId: string, name: string): Promise<string | null> {
  const cached = folderCache.get(folderCacheKey(parentId, name))
  if (cached) return cached
  const existing = await findNamedChild(parentId, name, true)
  return existing?.id || null
}

export async function listDriveFiles(parentId: string): Promise<DriveFile[]> {
  return (await listChildren(parentId, false)).filter((item) => item.mimeType !== FOLDER_MIME)
}

export async function listDriveFolders(parentId: string): Promise<DriveFile[]> {
  return listChildren(parentId, true)
}

export async function listDriveChildren(parentId: string): Promise<DriveFile[]> {
  return listChildren(parentId, false)
}

export async function listAllAppDataFiles(): Promise<DriveFile[]> {
  return listByQuery('trashed = false')
}

export async function findDriveFile(parentId: string, name: string): Promise<DriveFile | null> {
  return findNamedChild(parentId, name, false)
}

export async function patchDriveMetadata(
  fileId: string,
  body: Record<string, unknown>
): Promise<void> {
  await driveJson(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

export function isDriveFolder(file: DriveFile): boolean {
  return file.mimeType === FOLDER_MIME
}

async function uploadMultipart(input: {
  url: string
  method: 'POST' | 'PATCH'
  meta: Record<string, unknown>
  body: Buffer
  mimeType: string
  failMessage: string
}): Promise<void> {
  const boundary = `f95gm_${Date.now().toString(16)}_${Math.random().toString(16).slice(2)}`
  const meta = JSON.stringify(input.meta)
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${input.mimeType}\r\n\r\n`
  )
  const suffix = Buffer.from(`\r\n--${boundary}--`)
  const payload = Buffer.concat([prefix, input.body, suffix])
  const res = await driveFetch(input.url, {
    method: input.method,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: asBody(payload)
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(json.error?.message || input.failMessage)
  }
}

export async function uploadDriveFile(input: {
  parentId: string
  name: string
  localPath: string
  modifiedAt: number
  existingId?: string
}): Promise<void> {
  const body = await readFile(toFsPath(input.localPath))
  const modifiedTime = new Date(input.modifiedAt).toISOString()
  if (input.existingId) {
    await uploadMultipart({
      url: `${DRIVE_UPLOAD}/files/${encodeURIComponent(input.existingId)}?uploadType=multipart`,
      method: 'PATCH',
      meta: { modifiedTime },
      body,
      mimeType: 'application/octet-stream',
      failMessage: `Could not update ${input.name} on Google Drive.`
    })
    return
  }
  await uploadMultipart({
    url: `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`,
    method: 'POST',
    meta: { name: input.name, parents: [input.parentId], modifiedTime },
    body,
    mimeType: 'application/octet-stream',
    failMessage: `Could not upload ${input.name} to Google Drive.`
  })
}

export async function downloadDriveFile(fileId: string): Promise<Buffer> {
  const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`)
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(json.error?.message || 'Could not download a save from Google Drive.')
  }
  return Buffer.from(await res.arrayBuffer())
}

export async function deleteDriveFile(fileId: string): Promise<void> {
  const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' })
  if (!res.ok && res.status !== 404) {
    const json = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
    throw new Error(json.error?.message || 'Could not remove a file from Google Drive.')
  }
  for (const [key, id] of folderCache) {
    if (id === fileId || key.startsWith(`${fileId}\n`)) folderCache.delete(key)
  }
}

export async function uploadDriveBytes(input: {
  parentId: string
  name: string
  body: Buffer
  mimeType?: string
  existingId?: string
}): Promise<void> {
  const mime = input.mimeType || 'application/octet-stream'
  if (input.existingId) {
    await uploadMultipart({
      url: `${DRIVE_UPLOAD}/files/${encodeURIComponent(input.existingId)}?uploadType=multipart`,
      method: 'PATCH',
      meta: { mimeType: mime },
      body: input.body,
      mimeType: mime,
      failMessage: `Could not update ${input.name} on Google Drive.`
    })
    return
  }
  await uploadMultipart({
    url: `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id`,
    method: 'POST',
    meta: { name: input.name, parents: [input.parentId], mimeType: mime },
    body: input.body,
    mimeType: mime,
    failMessage: `Could not upload ${input.name} to Google Drive.`
  })
}
