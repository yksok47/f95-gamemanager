/**
 * Persist finished HTTP downloads so they survive restart until the user clears them.
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { DownloadLibraryStatus, DownloadRecord, DownloadStatus, PackageTagHint } from '@shared/types'
import { getAppPaths } from './paths'

const FINISHED = new Set<DownloadStatus>(['completed', 'cancelled', 'interrupted'])
const LIBRARY_STATUSES = new Set<DownloadLibraryStatus>([
  'hashing',
  'pendingReview',
  'indexed',
  'error'
])

export type DownloadHistoryStore = {
  version: 1
  items: DownloadRecord[]
}

function empty(): DownloadHistoryStore {
  return { version: 1, items: [] }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function asPackageHint(value: unknown): PackageTagHint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<PackageTagHint>
  const contentKind = Number(raw.contentKind)
  const version = typeof raw.version === 'string' ? raw.version.trim() : ''
  const os = Array.isArray(raw.os)
    ? [...new Set(raw.os.map((n) => Number(n)).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b)
    : []
  // Kind-only hints are valid (content type known, OS/version still to choose).
  if (!Number.isFinite(contentKind)) return undefined
  return { os, contentKind, version }
}

export function isFinishedDownloadStatus(status: DownloadStatus): boolean {
  return FINISHED.has(status)
}

export function normalizeDownloadHistory(value: unknown): DownloadHistoryStore {
  if (!value || typeof value !== 'object') return empty()
  const raw = value as Partial<DownloadHistoryStore>
  if (!Array.isArray(raw.items)) return empty()
  const items: DownloadRecord[] = []
  for (const item of raw.items) {
    if (!item || typeof item !== 'object') continue
    const e = item as Partial<DownloadRecord>
    if (typeof e.id !== 'string' || !e.id) continue
    const status = e.status
    if (status !== 'completed' && status !== 'cancelled' && status !== 'interrupted') continue
    const libraryStatus =
      e.libraryStatus && LIBRARY_STATUSES.has(e.libraryStatus) ? e.libraryStatus : undefined
    items.push({
      id: e.id,
      filename: asString(e.filename) || 'download',
      url: asString(e.url) || '',
      savePath: asString(e.savePath) || '',
      receivedBytes: asNumber(e.receivedBytes) ?? 0,
      totalBytes: asNumber(e.totalBytes) ?? 0,
      status,
      paused: false,
      canResume: false,
      bytesPerSecond: 0,
      error: asString(e.error),
      startedAt: asNumber(e.startedAt) ?? Date.now(),
      updatedAt: asNumber(e.updatedAt) ?? Date.now(),
      finishedAt: asNumber(e.finishedAt) ?? asNumber(e.updatedAt) ?? Date.now(),
      gameThreadId: asNumber(e.gameThreadId),
      gameTitle: asString(e.gameTitle),
      gameVersion: asString(e.gameVersion),
      hash: asString(e.hash),
      libraryStatus,
      packageHint: asPackageHint(e.packageHint)
    })
  }
  return { version: 1, items }
}

export async function loadDownloadHistory(): Promise<DownloadRecord[]> {
  try {
    const raw = await readFile(getAppPaths().downloadsHistoryFile, 'utf8')
    return normalizeDownloadHistory(JSON.parse(raw)).items
  } catch {
    return []
  }
}

export async function persistDownloadHistory(items: DownloadRecord[]): Promise<void> {
  const file = getAppPaths().downloadsHistoryFile
  await mkdir(dirname(file), { recursive: true })
  const store: DownloadHistoryStore = {
    version: 1,
    items: normalizeDownloadHistory({ version: 1, items }).items
  }
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8')
}
