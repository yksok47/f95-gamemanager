import { existsSync, mkdirSync, statSync, unlink } from 'fs'
import { extname, join } from 'path'
import { session, shell } from 'electron'
import type { DownloadRecord, DownloadStatus, GameFileContext } from '@shared/types'
import { getDownloadContext } from './download-context'
import {
  isFinishedDownloadStatus,
  loadDownloadHistory,
  persistDownloadHistory
} from './download-history-store'
import { isArchivePath } from './fs-utils'
import { addGameFileFromDownload } from './game-files-store'
import { hashFile } from './hash'
import { dismissGuestsAfterDownload } from './open-url'
import { getDownloadsDirSync } from './settings-store'
import { sendToRenderer } from './windows'

type TrackedDownload = {
  id: string
  item?: Electron.DownloadItem
  filename: string
  url: string
  savePath: string
  receivedBytes: number
  totalBytes: number
  status: DownloadStatus
  paused: boolean
  canResume: boolean
  bytesPerSecond: number
  error?: string
  startedAt: number
  updatedAt: number
  lastSampleAt: number
  lastSampleBytes: number
  context?: GameFileContext
  hash?: string
  libraryStatus?: 'hashing' | 'indexed' | 'error'
}

const tracked = new Map<string, TrackedDownload>()
let broadcastTimer: ReturnType<typeof setTimeout> | null = null
let historyTimer: ReturnType<typeof setTimeout> | null = null
let lastHistoryFingerprint = ''

function sanitizeFilename(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .trim()
  return cleaned || 'download'
}

function uniquePath(dir: string, filename: string): string {
  const base = sanitizeFilename(filename)
  const dest = join(dir, base)
  if (!existsSync(dest)) return dest

  const ext = extname(base)
  const stem = ext ? base.slice(0, -ext.length) : base
  for (let index = 1; index < 1000; index += 1) {
    const next = join(dir, `${stem} (${index})${ext}`)
    if (!existsSync(next)) return next
  }
  return join(dir, `${stem}-${Date.now()}${ext}`)
}

function toRecord(entry: TrackedDownload): DownloadRecord {
  return {
    id: entry.id,
    filename: entry.filename,
    url: entry.url,
    savePath: entry.savePath,
    receivedBytes: entry.receivedBytes,
    totalBytes: entry.totalBytes,
    status: entry.status,
    paused: entry.paused,
    canResume: entry.canResume,
    bytesPerSecond: entry.bytesPerSecond,
    error: entry.error,
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    gameThreadId: entry.context?.threadId,
    gameTitle: entry.context?.title,
    gameVersion: entry.context?.version,
    hash: entry.hash,
    libraryStatus: entry.libraryStatus
  }
}

function listRecords(): DownloadRecord[] {
  return [...tracked.values()].map(toRecord).sort((a, b) => b.startedAt - a.startedAt)
}

function historyFingerprint(items: DownloadRecord[]): string {
  return JSON.stringify(
    items
      .filter((item) => isFinishedDownloadStatus(item.status))
      .map((item) => ({
        id: item.id,
        status: item.status,
        savePath: item.savePath,
        hash: item.hash,
        libraryStatus: item.libraryStatus,
        updatedAt: item.updatedAt
      }))
  )
}

function scheduleHistoryPersist(): void {
  if (historyTimer) clearTimeout(historyTimer)
  historyTimer = setTimeout(() => {
    historyTimer = null
    const items = listRecords().filter((item) => isFinishedDownloadStatus(item.status))
    const fingerprint = historyFingerprint(items)
    if (fingerprint === lastHistoryFingerprint) return
    lastHistoryFingerprint = fingerprint
    void persistDownloadHistory(items).catch((error) => {
      console.warn('Could not persist download history', error)
    })
  }, 300)
}

function broadcast(): void {
  sendToRenderer('downloads:changed', listRecords())
  scheduleHistoryPersist()
}

function recordToTracked(row: DownloadRecord): TrackedDownload {
  return {
    id: row.id,
    filename: row.filename,
    url: row.url,
    savePath: row.savePath,
    receivedBytes: row.receivedBytes,
    totalBytes: row.totalBytes,
    status: row.status,
    paused: false,
    canResume: false,
    bytesPerSecond: 0,
    error: row.error,
    startedAt: row.startedAt,
    updatedAt: row.updatedAt,
    lastSampleAt: row.updatedAt,
    lastSampleBytes: row.receivedBytes,
    hash: row.hash,
    libraryStatus: row.libraryStatus,
    context:
      row.gameThreadId != null
        ? {
            threadId: row.gameThreadId,
            title: row.gameTitle || row.filename,
            version: row.gameVersion || ''
          }
        : undefined
  }
}

export async function restoreDownloadHistory(): Promise<void> {
  const rows = await loadDownloadHistory()
  if (!rows.length) return
  for (const row of rows) {
    if (tracked.has(row.id)) continue
    tracked.set(row.id, recordToTracked(row))
  }
  lastHistoryFingerprint = historyFingerprint(rows)
  broadcast()
}

function scheduleBroadcast(): void {
  if (broadcastTimer) return
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null
    broadcast()
  }, 150)
}

function statusFromItem(item: Electron.DownloadItem): DownloadStatus {
  const state = item.getState()
  if (state === 'progressing') return item.isPaused() ? 'paused' : 'progressing'
  if (state === 'completed' || state === 'cancelled' || state === 'interrupted') return state
  return 'interrupted'
}

function syncFromItem(entry: TrackedDownload): void {
  const { item } = entry
  if (!item) return
  const now = Date.now()
  const received = item.getReceivedBytes()
  if (now - entry.lastSampleAt >= 400) {
    const elapsed = Math.max(1, now - entry.lastSampleAt)
    entry.bytesPerSecond = Math.max(0, ((received - entry.lastSampleBytes) * 1000) / elapsed)
    entry.lastSampleAt = now
    entry.lastSampleBytes = received
  }
  entry.filename = item.getFilename() || entry.filename
  entry.url = item.getURL() || entry.url
  entry.savePath = item.getSavePath() || entry.savePath
  entry.receivedBytes = received
  entry.totalBytes = item.getTotalBytes()
  entry.paused = item.isPaused()
  entry.canResume = item.canResume()
  entry.status = statusFromItem(item)
  entry.updatedAt = now
}

function nextId(): string {
  return `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function applyConfiguredDownloadPath(): void {
  const dir = getDownloadsDirSync()
  try {
    mkdirSync(dir, { recursive: true })
    session.defaultSession.setDownloadPath(dir)
  } catch (error) {
    console.warn('Could not set downloads folder', error)
  }
}

export function listDownloads(): DownloadRecord[] {
  return listRecords()
}

/** Record a finished file (e.g. approved P2P) in the Downloads list. */
export function addCompletedDownload(opts: {
  filename: string
  savePath: string
  sizeBytes: number
  url?: string
  gameThreadId?: number | null
  gameTitle?: string
  gameVersion?: string | null
  hash?: string
}): DownloadRecord {
  const savePath = opts.savePath
  const existing = [...tracked.values()].find(
    (entry) =>
      entry.savePath.replace(/\\/g, '/').toLowerCase() === savePath.replace(/\\/g, '/').toLowerCase()
  )
  const now = Date.now()
  const size = Math.max(0, opts.sizeBytes || 0)
  if (existing) {
    existing.filename = opts.filename || existing.filename
    existing.savePath = savePath
    existing.receivedBytes = size
    existing.totalBytes = size
    existing.status = 'completed'
    existing.paused = false
    existing.canResume = false
    existing.bytesPerSecond = 0
    existing.updatedAt = now
    existing.hash = opts.hash || existing.hash
    existing.libraryStatus = opts.hash ? 'indexed' : existing.libraryStatus
    if (opts.gameThreadId != null) {
      existing.context = {
        threadId: Number(opts.gameThreadId),
        title: opts.gameTitle || existing.context?.title || opts.filename,
        version: opts.gameVersion || existing.context?.version || ''
      }
    }
    broadcast()
    return toRecord(existing)
  }
  const entry: TrackedDownload = {
    id: nextId(),
    filename: opts.filename,
    url: opts.url || '',
    savePath,
    receivedBytes: size,
    totalBytes: size,
    status: 'completed',
    paused: false,
    canResume: false,
    bytesPerSecond: 0,
    startedAt: now,
    updatedAt: now,
    lastSampleAt: now,
    lastSampleBytes: size,
    hash: opts.hash,
    libraryStatus: opts.hash ? 'indexed' : undefined,
    context:
      opts.gameThreadId != null
        ? {
            threadId: Number(opts.gameThreadId),
            title: opts.gameTitle || opts.filename,
            version: opts.gameVersion || ''
          }
        : undefined
  }
  tracked.set(entry.id, entry)
  broadcast()
  return toRecord(entry)
}

export function cancelDownload(id: string): DownloadRecord[] {
  const entry = tracked.get(id)
  if (entry && (entry.status === 'progressing' || entry.status === 'paused')) {
    try {
      entry.item?.cancel()
    } catch (error) {
      console.warn('Could not cancel download', error)
    }
  }
  return listRecords()
}

export function pauseDownload(id: string): DownloadRecord[] {
  const entry = tracked.get(id)
  if (entry?.item && !entry.item.isPaused() && entry.item.getState() === 'progressing') {
    try {
      entry.item.pause()
      syncFromItem(entry)
      broadcast()
    } catch (error) {
      console.warn('Could not pause download', error)
    }
  }
  return listRecords()
}

export function resumeDownload(id: string): DownloadRecord[] {
  const entry = tracked.get(id)
  if (entry?.item?.canResume()) {
    try {
      entry.item.resume()
      syncFromItem(entry)
      broadcast()
    } catch (error) {
      console.warn('Could not resume download', error)
    }
  }
  return listRecords()
}

export function removeDownload(id: string): DownloadRecord[] {
  const entry = tracked.get(id)
  if (!entry) return listRecords()
  if (entry.status === 'progressing' || entry.status === 'paused') {
    entry.item?.cancel()
  }
  tracked.delete(id)
  broadcast()
  return listRecords()
}

export async function flushDownloadHistory(): Promise<void> {
  if (historyTimer) {
    clearTimeout(historyTimer)
    historyTimer = null
  }
  const items = listRecords().filter((item) => isFinishedDownloadStatus(item.status))
  lastHistoryFingerprint = historyFingerprint(items)
  await persistDownloadHistory(items)
}

export function clearFinishedDownloads(): DownloadRecord[] {
  for (const [id, entry] of tracked) {
    if (entry.status === 'completed' || entry.status === 'cancelled') {
      tracked.delete(id)
    }
  }
  broadcast()
  return listRecords()
}

export async function showDownloadInFolder(id: string): Promise<void> {
  const entry = tracked.get(id)
  if (!entry?.savePath) throw new Error('Download not found.')
  shell.showItemInFolder(entry.savePath)
}

export async function openDownload(id: string): Promise<void> {
  const entry = tracked.get(id)
  if (!entry?.savePath) throw new Error('Download not found.')
  if (entry.status !== 'completed') throw new Error('That file is not finished yet.')
  const error = await shell.openPath(entry.savePath)
  if (error) throw new Error(error)
}

export async function openDownloadsFolder(): Promise<void> {
  const dir = getDownloadsDirSync()
  mkdirSync(dir, { recursive: true })
  const error = await shell.openPath(dir)
  if (error) throw new Error(error)
}

async function indexArchive(entry: TrackedDownload): Promise<void> {
  const context = entry.context
  if (!context || !entry.savePath || !isArchivePath(entry.savePath || entry.filename)) return
  entry.libraryStatus = 'hashing'
  broadcast()
  try {
    const hash = await hashFile(entry.savePath)
    const size = existsSync(entry.savePath) ? statSync(entry.savePath).size : entry.receivedBytes
    await addGameFileFromDownload(context, entry.savePath, hash, size)
    entry.hash = hash
    entry.libraryStatus = 'indexed'
    void import('./p2p/controller')
      .then(({ onLibraryPackageAdded }) =>
        onLibraryPackageAdded({
          filePath: entry.savePath,
          contentHash: hash,
          gameName: context.title,
          gameVersion: context.version,
          f95ThreadId: context.threadId,
          f95ThreadUrl: context.threadUrl
        })
      )
      .catch((error) => {
        console.warn('[p2p] auto-seed after HTTP download failed', error)
      })
  } catch (error) {
    console.warn('Could not add archive to game files', error)
    entry.libraryStatus = 'error'
  }
  broadcast()
}

export function registerDownloadHandler(): void {
  applyConfiguredDownloadPath()
  void restoreDownloadHistory().catch((error) => {
    console.warn('Could not restore download history', error)
  })
  session.defaultSession.on('will-download', (_event, item, webContents) => {
    const dir = getDownloadsDirSync()
    try {
      mkdirSync(dir, { recursive: true })
    } catch (error) {
      console.warn('Could not create downloads folder', error)
    }
    const filename = item.getFilename() || 'download'
    item.setSavePath(uniquePath(dir, filename))

    const now = Date.now()
    const entry: TrackedDownload = {
      id: nextId(),
      item,
      filename,
      url: item.getURL(),
      savePath: item.getSavePath(),
      receivedBytes: item.getReceivedBytes(),
      totalBytes: item.getTotalBytes(),
      status: 'progressing',
      paused: false,
      canResume: false,
      bytesPerSecond: 0,
      startedAt: now,
      updatedAt: now,
      lastSampleAt: now,
      lastSampleBytes: item.getReceivedBytes(),
      context: getDownloadContext(webContents)
    }
    tracked.set(entry.id, entry)
    broadcast()
    dismissGuestsAfterDownload(webContents)

    item.on('updated', () => {
      syncFromItem(entry)
      scheduleBroadcast()
    })

    item.on('done', (_doneEvent, state) => {
      syncFromItem(entry)
      if (state === 'completed' || state === 'cancelled' || state === 'interrupted') {
        entry.status = state
      } else {
        entry.status = 'interrupted'
      }
      entry.bytesPerSecond = 0
      entry.paused = false
      entry.canResume = item.canResume()
      if (state === 'cancelled' && entry.savePath) {
        unlink(entry.savePath, () => undefined)
      }
      broadcast()
      if (state === 'completed') void indexArchive(entry)
    })
  })
}
