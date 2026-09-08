import { existsSync, mkdirSync, statSync, unlink } from 'fs'
import { extname, join } from 'path'
import { session, shell } from 'electron'
import type { DownloadRecord, DownloadStatus, GameFileContext } from '@shared/types'
import { getDownloadContext } from './download-context'
import { isArchivePath } from './fs-utils'
import { addGameFileFromDownload } from './game-files-store'
import { hashFile } from './hash'
import { dismissGuestsAfterDownload } from './open-url'
import { getDownloadsDirSync } from './settings-store'
import { sendToRenderer } from './windows'

type TrackedDownload = {
  id: string
  item: Electron.DownloadItem
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
    gameVersion: entry.context?.version,
    hash: entry.hash,
    libraryStatus: entry.libraryStatus
  }
}

function listRecords(): DownloadRecord[] {
  return [...tracked.values()].map(toRecord).sort((a, b) => b.startedAt - a.startedAt)
}

function broadcast(): void {
  sendToRenderer('downloads:changed', listRecords())
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

export function cancelDownload(id: string): DownloadRecord[] {
  const entry = tracked.get(id)
  if (entry && (entry.status === 'progressing' || entry.status === 'paused')) {
    try {
      entry.item.cancel()
    } catch (error) {
      console.warn('Could not cancel download', error)
    }
  }
  return listRecords()
}

export function pauseDownload(id: string): DownloadRecord[] {
  const entry = tracked.get(id)
  if (entry && !entry.item.isPaused() && entry.item.getState() === 'progressing') {
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
  if (entry && entry.item.canResume()) {
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
    entry.item.cancel()
  }
  tracked.delete(id)
  broadcast()
  return listRecords()
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
  if (!entry.context || !entry.savePath || !isArchivePath(entry.savePath || entry.filename)) return
  entry.libraryStatus = 'hashing'
  broadcast()
  try {
    const hash = await hashFile(entry.savePath)
    const size = existsSync(entry.savePath) ? statSync(entry.savePath).size : entry.receivedBytes
    await addGameFileFromDownload(entry.context, entry.savePath, hash, size)
    entry.hash = hash
    entry.libraryStatus = 'indexed'
  } catch (error) {
    console.warn('Could not add archive to game files', error)
    entry.libraryStatus = 'error'
  }
  broadcast()
}

export function registerDownloadHandler(): void {
  applyConfiguredDownloadPath()
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
