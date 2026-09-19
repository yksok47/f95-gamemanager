/**
 * Remembered mappings from on-disk save folders to F95 threads.
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname, resolve } from 'path'
import { saneLikeCount, saneViewCount } from '@shared/counts'
import type { IdentifiedSaveFolder } from '@shared/types'
import { getAppPaths } from './paths'
import { mergeIdentifiedSaveFolder } from './save-folder-meta'
import { pathExists } from './win-path'
import { sendToRenderer } from './windows'

export type { IdentifiedSaveFolder }

export type FailedSaveFolder = {
  folderName: string
  savePath: string
  failedAt: number
}

export type SaveFoldersStore = {
  version: 1
  identified: Record<string, IdentifiedSaveFolder>
  failed: Record<string, FailedSaveFolder>
}

let cache: SaveFoldersStore | null = null
let writeChain: Promise<void> = Promise.resolve()

export function saveFolderKey(savePath: string): string {
  return resolve(savePath).toLowerCase()
}

function empty(): SaveFoldersStore {
  return { version: 1, identified: {}, failed: {} }
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asIds(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const ids: number[] = []
  const seen = new Set<number>()
  for (const entry of value) {
    const id = Number(entry)
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

function asScreens(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const urls: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const url = asText(entry)
    if (!url || seen.has(url)) continue
    seen.add(url)
    urls.push(url)
  }
  return urls
}

function asIdentified(value: unknown): IdentifiedSaveFolder | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<IdentifiedSaveFolder>
  const threadId = Number(raw.threadId)
  const savePath = asText(raw.savePath)
  const title = asText(raw.title)
  const folderName = asText(raw.folderName)
  if (!Number.isFinite(threadId) || threadId <= 0 || !savePath || !title) return null
  const screens = asScreens(raw.screens)
  const prefixes = asIds(raw.prefixes)
  const tags = asIds(raw.tags)
  return {
    title,
    threadId,
    coverUrl: asText(raw.coverUrl) || null,
    savePath,
    folderName: folderName || savePath,
    identifiedAt: Number(raw.identifiedAt) || 0,
    creator: asText(raw.creator) || undefined,
    engine: asText(raw.engine) || undefined,
    version: asText(raw.version) || undefined,
    rating: Number(raw.rating) || undefined,
    likes: saneLikeCount(raw.likes) || undefined,
    views: saneViewCount(raw.views) || undefined,
    threadUrl: asText(raw.threadUrl) || undefined,
    prefixes: prefixes.length ? prefixes : undefined,
    tags: tags.length ? tags : undefined,
    timestamp: Number(raw.timestamp) || undefined,
    updatedAt: asText(raw.updatedAt) || undefined,
    screens: screens.length ? screens : undefined
  }
}

function asFailed(value: unknown): FailedSaveFolder | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<FailedSaveFolder>
  const savePath = typeof raw.savePath === 'string' ? raw.savePath.trim() : ''
  const folderName = typeof raw.folderName === 'string' ? raw.folderName.trim() : ''
  if (!savePath) return null
  return {
    folderName: folderName || savePath,
    savePath,
    failedAt: Number(raw.failedAt) || 0
  }
}

function normalize(value: unknown): SaveFoldersStore {
  if (!value || typeof value !== 'object') return empty()
  const raw = value as Partial<SaveFoldersStore>
  const identified: Record<string, IdentifiedSaveFolder> = {}
  const failed: Record<string, FailedSaveFolder> = {}
  if (raw.identified && typeof raw.identified === 'object') {
    for (const entry of Object.values(raw.identified)) {
      const item = asIdentified(entry)
      if (!item) continue
      identified[saveFolderKey(item.savePath)] = item
    }
  }
  if (raw.failed && typeof raw.failed === 'object') {
    for (const entry of Object.values(raw.failed)) {
      const item = asFailed(entry)
      if (!item) continue
      failed[saveFolderKey(item.savePath)] = item
    }
  }
  return { version: 1, identified, failed }
}

async function loadStore(): Promise<SaveFoldersStore> {
  if (cache) return cache
  try {
    const raw = await readFile(getAppPaths().saveFoldersFile, 'utf8')
    cache = normalize(JSON.parse(raw))
  } catch {
    cache = empty()
  }
  return cache
}

function broadcast(): void {
  sendToRenderer('library:save-folders-changed', Object.values(cache?.identified || {}))
}

async function persist(store: SaveFoldersStore): Promise<void> {
  const file = getAppPaths().saveFoldersFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8')
}

function queueWrite(store: SaveFoldersStore): Promise<void> {
  cache = store
  broadcast()
  writeChain = writeChain
    .then(() => persist(store))
    .catch((error) => {
      console.warn('[save-folders] persist failed', error)
    })
  return writeChain
}

export async function listIdentifiedSaveFolders(): Promise<IdentifiedSaveFolder[]> {
  const store = await loadStore()
  return Object.values(store.identified)
}

export async function getIdentifiedSaveFolder(savePath: string): Promise<IdentifiedSaveFolder | null> {
  const store = await loadStore()
  return store.identified[saveFolderKey(savePath)] ?? null
}

export function pickIdentifiedSaveFolder(
  records: IdentifiedSaveFolder[],
  threadId?: number,
  title?: string
): IdentifiedSaveFolder | null {
  if (threadId) {
    const matches = records.filter((item) => item.threadId === threadId)
    if (matches.length) {
      return matches.sort((a, b) => b.identifiedAt - a.identifiedAt)[0]
    }
  }
  const needle = (title || '').trim().toLowerCase()
  if (!needle) return null
  const matches = records.filter((item) => item.title.trim().toLowerCase() === needle)
  return matches.length === 1 ? matches[0] : null
}

export async function findIdentifiedSaveFolder(
  threadId?: number,
  title?: string
): Promise<IdentifiedSaveFolder | null> {
  const store = await loadStore()
  return pickIdentifiedSaveFolder(Object.values(store.identified), threadId, title)
}

export async function getFailedSaveFolder(savePath: string): Promise<FailedSaveFolder | null> {
  const store = await loadStore()
  return store.failed[saveFolderKey(savePath)] ?? null
}

export async function listFailedSaveFolders(): Promise<FailedSaveFolder[]> {
  const store = await loadStore()
  return Object.values(store.failed)
}

export async function rememberIdentifiedSaveFolders(entries: IdentifiedSaveFolder[]): Promise<void> {
  if (!entries.length) return
  const store = await loadStore()
  const identified = { ...store.identified }
  const failed = { ...store.failed }
  let changed = false
  for (const entry of entries) {
    const item = asIdentified(entry)
    if (!item) continue
    const key = saveFolderKey(item.savePath)
    const merged = mergeIdentifiedSaveFolder(identified[key], {
      ...item,
      identifiedAt: item.identifiedAt || Date.now()
    })
    identified[key] = merged
    if (failed[key]) {
      delete failed[key]
    }
    changed = true
  }
  if (!changed) return
  await queueWrite({ version: 1, identified, failed })
}

export async function forgetIdentifiedSaveFoldersForThread(threadId: number): Promise<void> {
  if (!threadId) return
  const store = await loadStore()
  const identified = { ...store.identified }
  let changed = false
  for (const [key, item] of Object.entries(identified)) {
    if (item.threadId !== threadId) continue
    delete identified[key]
    changed = true
  }
  if (!changed) return
  await queueWrite({ version: 1, identified, failed: store.failed })
}

export async function markSaveFolderIdentifyFailed(savePath: string, folderName: string): Promise<void> {
  const path = savePath.trim()
  if (!path) return
  const store = await loadStore()
  const key = saveFolderKey(path)
  const identified = { ...store.identified }
  delete identified[key]
  await queueWrite({
    version: 1,
    identified,
    failed: {
      ...store.failed,
      [key]: {
        folderName: folderName.trim() || path,
        savePath: path,
        failedAt: Date.now()
      }
    }
  })
}

export async function pruneMissingSaveFolders(): Promise<void> {
  const store = await loadStore()
  const identified: Record<string, IdentifiedSaveFolder> = {}
  const failed: Record<string, FailedSaveFolder> = {}
  let changed = false
  for (const [key, item] of Object.entries(store.identified)) {
    if (pathExists(item.savePath)) {
      identified[key] = item
    } else {
      changed = true
    }
  }
  for (const [key, item] of Object.entries(store.failed)) {
    if (pathExists(item.savePath)) {
      failed[key] = item
    } else {
      changed = true
    }
  }
  if (!changed) return
  await queueWrite({ version: 1, identified, failed })
}
