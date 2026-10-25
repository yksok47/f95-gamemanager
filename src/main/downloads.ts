import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  statSync,
  truncateSync,
  unlink
} from 'fs'
import { copyFile, rename, unlink as unlinkAsync } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import { Transform, type Readable } from 'stream'
import { pipeline } from 'stream/promises'
import { session, shell } from 'electron'
import { normalizePackageFilename } from '@shared/content-address'
import { normalizePackageInstallTags, type PackageInstallTags } from '@shared/p2p'
import type {
  DownloadLibraryStatus,
  DownloadRecord,
  DownloadStatus,
  GameFileContext,
  PackageTagHint
} from '@shared/types'
import { isDataNodesInterstitialDownload } from '@shared/datanodes'
import { isGuestContents, shouldBlockDownload } from './adblock'
import { knownInstallTags } from './auto-approve'
import { startAutoInstall } from './auto-install'
import { getDownloadContext } from './download-context'
import {
  isFinishedDownloadStatus,
  loadDownloadHistory,
  persistDownloadHistory
} from './download-history-store'
import { isReviewablePackagePath } from './fs-utils'
import { addGameFileFromDownload } from './game-files-store'
import { hashFile } from './hash'
import { dismissGuestsAfterDownload, releaseGuestsAfterDownload } from './open-url'
import { flagPackageAs, onLibraryPackageAdded } from './p2p/controller'
import { reportLinkFile, reportSignedInstall } from './p2p/metadata-client'
import { publicSourceLinks } from './f95/download-gate'
import {
  getAutoApproveDownloadsSync,
  getDownloadsDirSync,
  getIncomingDownloadsDirSync,
  getUntrustedDownloadsDirSync
} from './settings-store'
import { sendToRenderer } from './windows'

type SpeedSample = { at: number; bytes: number }

/** Controls for a download the app writes itself instead of through Chromium. */
type StreamTransfer = {
  pause: () => void
  resume: () => void
  cancel: () => void
}

export type StreamDownloadSource = {
  filename: string
  url: string
  totalBytes: number
  context?: GameFileContext
  /** Plaintext from byte `start` to the end of the file. */
  open: (start: number) => Readable
}

type TrackedDownload = {
  id: string
  item?: Electron.DownloadItem
  transfer?: StreamTransfer
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
  finishedAt?: number
  speedSamples: SpeedSample[]
  context?: GameFileContext
  hash?: string
  libraryStatus?: DownloadLibraryStatus
  packageHint?: PackageTagHint
  sourceLinks?: string[]
}

const tracked = new Map<string, TrackedDownload>()
let broadcastTimer: ReturnType<typeof setTimeout> | null = null
let historyTimer: ReturnType<typeof setTimeout> | null = null
let lastHistoryFingerprint = ''

const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i
const MAX_FILENAME_LEN = 150

function sanitizeFilename(name: string): string {
  let cleaned = name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/g, '')
    .trim()
  if (!cleaned || WINDOWS_RESERVED_NAME.test(cleaned)) cleaned = 'download'
  const ext = extname(cleaned)
  const stem = ext ? cleaned.slice(0, -ext.length) : cleaned
  const maxStem = Math.max(1, MAX_FILENAME_LEN - ext.length)
  return `${stem.slice(0, maxStem)}${ext}` || 'download'
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

function fileSize(filePath: string): number | null {
  try {
    return statSync(filePath).size
  } catch {
    return null
  }
}

/**
 * Chromium creates a 0-byte file at the default name before `will-download`.
 * That placeholder is this download, so it must not be treated as a name collision.
 */
function downloadSavePath(dir: string, filename: string): string {
  const dest = join(dir, sanitizeFilename(filename))
  if (fileSize(dest) === 0) return dest
  return uniquePath(dir, filename)
}

/** Prefer the recorded path, then the original filename beside it when that path is missing. */
function locateFinishedFile(entry: TrackedDownload): string {
  if (entry.savePath && existsSync(entry.savePath)) return entry.savePath
  if (!entry.filename) return entry.savePath
  const dir = entry.savePath ? dirname(entry.savePath) : getUntrustedDownloadsDirSync()
  const sibling = join(dir, sanitizeFilename(entry.filename))
  if (existsSync(sibling)) return sibling
  return entry.savePath
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
    finishedAt: entry.finishedAt,
    gameThreadId: entry.context?.threadId,
    gameTitle: entry.context?.title,
    gameVersion: entry.context?.version,
    gameCreator: entry.context?.creator,
    gameCoverUrl: entry.context?.coverUrl,
    gameEngine: entry.context?.engine,
    hash: entry.hash,
    libraryStatus: entry.libraryStatus,
    packageHint: entry.packageHint || entry.context?.packageHint,
    sourceLinks: entry.sourceLinks || entry.context?.sourceLinks
  }
}

function listRecords(): DownloadRecord[] {
  return [...tracked.values()]
    .map(toRecord)
    .sort((a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id))
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
        packageHint: item.packageHint,
        updatedAt: item.updatedAt,
        finishedAt: item.finishedAt
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
    finishedAt: row.finishedAt ?? (isFinishedDownloadStatus(row.status) ? row.updatedAt : undefined),
    speedSamples: [],
    hash: row.hash,
    libraryStatus: row.libraryStatus,
    packageHint: row.packageHint,
    sourceLinks: row.sourceLinks,
    context:
      row.gameThreadId != null
        ? {
            threadId: row.gameThreadId,
            title: row.gameTitle || row.filename,
            version: row.gameVersion || '',
            creator: row.gameCreator,
            coverUrl: row.gameCoverUrl,
            engine: row.gameEngine,
            packageHint: row.packageHint,
            sourceLinks: row.sourceLinks
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
  // Finished before review existed for this file type (e.g. a loose .rpy/.rpyc patch).
  for (const entry of tracked.values()) {
    if (entry.status === 'completed' && !entry.libraryStatus) {
      void prepareArchiveForReview(entry)
    }
  }
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

const SPEED_WINDOW_MS = 3000
const SPEED_SAMPLE_MS = 250
const SPEED_MIN_SPAN_MS = 500

/**
 * Average over a few seconds. Hosts that deliver in bursts (MEGA chunks) read as
 * zero between bursts with a single short sample, so the speed blinked on and off.
 */
function sampleSpeed(samples: SpeedSample[], now: number, bytes: number, previous: number): number {
  const last = samples[samples.length - 1]
  if (last && bytes < last.bytes) samples.length = 0
  if (!samples.length || now - samples[samples.length - 1].at >= SPEED_SAMPLE_MS) {
    samples.push({ at: now, bytes })
  }
  while (samples.length > 2 && now - samples[1].at >= SPEED_WINDOW_MS) samples.shift()
  const first = samples[0]
  const span = now - first.at
  if (span < SPEED_MIN_SPAN_MS) return previous
  return Math.max(0, ((bytes - first.bytes) * 1000) / span)
}

function syncFromItem(entry: TrackedDownload): void {
  const { item } = entry
  if (!item) return
  const now = Date.now()
  const received = item.getReceivedBytes()
  entry.bytesPerSecond = sampleSpeed(entry.speedSamples, now, received, entry.bytesPerSecond)
  entry.filename = item.getFilename() || entry.filename
  entry.url = item.getURL() || entry.url
  entry.savePath = item.getSavePath() || entry.savePath
  entry.receivedBytes = received
  entry.totalBytes = item.getTotalBytes()
  entry.paused = item.isPaused()
  entry.canResume = item.canResume()
  const nextStatus = statusFromItem(item)
  if (isFinishedDownloadStatus(nextStatus) && !entry.finishedAt) {
    entry.finishedAt = now
  }
  entry.status = nextStatus
  entry.updatedAt = now
}

function nextId(): string {
  return `dl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function applyConfiguredDownloadPath(): void {
  const dir = getIncomingDownloadsDirSync()
  try {
    mkdirSync(dir, { recursive: true })
    session.defaultSession.setDownloadPath(dir)
  } catch (error) {
    console.warn('Could not set downloads folder', error)
  }
}

function pathsEqual(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

/** Move a reviewed file out of untrusted into the trusted downloads folder. */
async function promoteFromUntrusted(src: string): Promise<string> {
  const untrustedDir = getUntrustedDownloadsDirSync()
  if (!pathsEqual(dirname(src), untrustedDir)) return src

  const trustedDir = getDownloadsDirSync()
  mkdirSync(trustedDir, { recursive: true })
  const dest = uniquePath(trustedDir, basename(src))
  try {
    await rename(src, dest)
  } catch {
    // cross-device fallback (same pattern as P2P quarantine approve)
    await copyFile(src, dest)
    await unlinkAsync(src)
  }
  return dest
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
    if (!existing.finishedAt) existing.finishedAt = now
    existing.hash = opts.hash || existing.hash
    existing.libraryStatus = opts.hash ? 'indexed' : existing.libraryStatus
    if (opts.gameThreadId != null) {
      existing.context = {
        threadId: Number(opts.gameThreadId),
        title: opts.gameTitle || existing.context?.title || opts.filename,
        version: opts.gameVersion || existing.context?.version || '',
        packageHint: existing.context?.packageHint || existing.packageHint
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
    finishedAt: now,
    speedSamples: [],
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
  if (entry?.transfer) {
    entry.transfer.cancel()
    return listRecords()
  }
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
  if (entry?.transfer) {
    entry.transfer.pause()
    broadcast()
    return listRecords()
  }
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
  if (entry?.transfer) {
    entry.transfer.resume()
    broadcast()
    return listRecords()
  }
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
  if (entry.transfer) {
    entry.transfer.cancel()
  } else if (entry.status === 'progressing' || entry.status === 'paused') {
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

function isAwaitingLibraryReview(entry: TrackedDownload): boolean {
  return entry.libraryStatus === 'pendingReview' || entry.libraryStatus === 'hashing'
}

export function clearFinishedDownloads(): DownloadRecord[] {
  for (const [id, entry] of tracked) {
    if (entry.status === 'completed' || entry.status === 'cancelled') {
      if (isAwaitingLibraryReview(entry)) continue
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

/** Hash a finished package and wait for tag approval before library insert. */
async function prepareArchiveForReview(entry: TrackedDownload): Promise<void> {
  const context = entry.context
  if (!context) return
  const packagePath = locateFinishedFile(entry)
  if (!packagePath || !isReviewablePackagePath(packagePath)) return
  entry.savePath = packagePath
  entry.libraryStatus = 'hashing'
  entry.packageHint = entry.packageHint || context.packageHint
  broadcast()
  try {
    const hash = await hashFile(entry.savePath)
    entry.hash = hash
    entry.libraryStatus = 'pendingReview'
    entry.updatedAt = Date.now()
  } catch (error) {
    console.warn('Could not hash archive for review', error)
    entry.libraryStatus = 'error'
  }
  broadcast()
  if (entry.libraryStatus === 'pendingReview' && getAutoApproveDownloadsSync()) {
    await autoApproveDownload(entry)
  }
}

async function autoApproveDownload(entry: TrackedDownload): Promise<void> {
  if (!entry.hash) return
  try {
    const tags = await knownInstallTags(entry.hash, entry.packageHint, entry.context?.packageHint)
    if (!tags) return
    if (tracked.get(entry.id) !== entry || entry.libraryStatus !== 'pendingReview') return
    await approveDownload(entry.id, tags)
  } catch (error) {
    console.warn('[downloads] auto-approve failed', error)
  }
}

export async function approveDownload(
  id: string,
  tags: PackageInstallTags
): Promise<DownloadRecord[]> {
  const entry = tracked.get(id)
  if (!entry) throw new Error('Download not found.')
  if (entry.status !== 'completed') throw new Error('That file is not finished yet.')
  if (entry.libraryStatus !== 'pendingReview') {
    throw new Error('That download is not waiting for approval.')
  }
  const context = entry.context
  if (!context) throw new Error('Missing game context — cannot add to library.')
  if (!entry.savePath || !existsSync(entry.savePath)) {
    throw new Error('Downloaded file is missing on disk.')
  }
  const hash = entry.hash?.trim().toLowerCase()
  if (!hash) throw new Error('Missing content hash — wait for hashing to finish.')

  const normalizedTags = normalizePackageInstallTags(tags)
  // Library metadata must match the approval dialog exactly — no thread/game fallbacks.
  const nextContext: GameFileContext = {
    ...context,
    version: normalizedTags.version,
    packageHint: {
      os: normalizedTags.os,
      contentKind: normalizedTags.contentKind,
      version: normalizedTags.version
    }
  }

  const trustedPath = await promoteFromUntrusted(entry.savePath)
  entry.savePath = trustedPath
  entry.filename = basename(trustedPath)
  const size = existsSync(trustedPath) ? statSync(trustedPath).size : entry.receivedBytes

  await addGameFileFromDownload(nextContext, trustedPath, hash, size)
  entry.context = nextContext
  entry.libraryStatus = 'indexed'
  entry.updatedAt = Date.now()
  broadcast()

  void onLibraryPackageAdded({
    filePath: trustedPath,
    contentHash: hash,
    gameName: nextContext.title,
    gameVersion: normalizedTags.version,
    f95ThreadId: nextContext.threadId,
    f95ThreadUrl: nextContext.threadUrl
  }).catch((error) => {
    console.warn('[p2p] auto-seed after HTTP download approve failed', error)
  })

  const sourceLinks = publicSourceLinks(entry.sourceLinks ?? context.sourceLinks ?? [])
  void (async () => {
    // Link first: it creates the package row, so the install tags below never 404.
    if (sourceLinks?.length) {
      try {
        await reportLinkFile({
          contentHash: hash,
          f95ThreadId: nextContext.threadId,
          f95ThreadUrl: nextContext.threadUrl,
          gameName: nextContext.title,
          urls: sourceLinks,
          normalizedName: normalizePackageFilename(trustedPath),
          sizeBytes: size
        })
      } catch (error) {
        console.warn('[downloads] link report after approve failed', error)
      }
    }
    await reportSignedInstall(hash, normalizedTags)
  })().catch((error) => {
    console.warn('[downloads] install report after approve failed', error)
  })

  startAutoInstall(nextContext.threadId, hash)

  return listRecords()
}

export async function rejectDownload(id: string): Promise<DownloadRecord[]> {
  const entry = tracked.get(id)
  if (!entry) return listRecords()
  if (entry.libraryStatus !== 'pendingReview' && entry.libraryStatus !== 'hashing') {
    throw new Error('That download is not waiting for approval.')
  }
  const savePath = entry.savePath
  tracked.delete(id)
  broadcast()
  if (savePath && existsSync(savePath)) {
    unlink(savePath, (error) => {
      if (error) console.warn('Could not delete rejected download', error)
    })
  }
  return listRecords()
}

/** Reject a pending HTTP download and report the content hash as harmful. */
export async function flagDownload(
  id: string,
  note?: string
): Promise<DownloadRecord[]> {
  const entry = tracked.get(id)
  if (!entry) return listRecords()
  if (entry.status !== 'completed') throw new Error('That file is not finished yet.')
  if (entry.libraryStatus !== 'pendingReview') {
    throw new Error('That download is not waiting for approval.')
  }
  const contentHash = entry.hash?.trim().toLowerCase()
  if (!contentHash) throw new Error('Missing content hash — wait for hashing to finish.')

  const records = await rejectDownload(id)
  try {
    await flagPackageAs(contentHash, 'harmful', note)
  } catch (error) {
    console.warn('[downloads] harmful flag after reject failed', error)
  }
  return records
}

function settleStream(entry: TrackedDownload, status: DownloadStatus, error?: string): void {
  const now = Date.now()
  entry.status = status
  entry.paused = false
  entry.canResume = false
  entry.bytesPerSecond = 0
  entry.error = error
  entry.updatedAt = now
  entry.finishedAt = now
}

function cancelStream(entry: TrackedDownload): void {
  entry.transfer = undefined
  settleStream(entry, 'cancelled')
  unlink(entry.savePath, () => undefined)
  broadcast()
}

/**
 * Pausing holds the chunk being written, so backpressure stops the source without
 * dropping its state. A failed transfer keeps the partial file and resumes after it.
 */
function runStream(entry: TrackedDownload, source: StreamDownloadSource, start: number): void {
  const abort = new AbortController()
  let held: (() => void) | null = null
  const now = Date.now()
  entry.status = 'progressing'
  entry.paused = false
  entry.canResume = false
  entry.error = undefined
  entry.finishedAt = undefined
  entry.receivedBytes = start
  entry.bytesPerSecond = 0
  entry.speedSamples = [{ at: now, bytes: start }]
  entry.updatedAt = now

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const at = Date.now()
      entry.receivedBytes += chunk.length
      entry.bytesPerSecond = sampleSpeed(entry.speedSamples, at, entry.receivedBytes, entry.bytesPerSecond)
      entry.updatedAt = at
      scheduleBroadcast()
      if (entry.paused) held = () => callback(null, chunk)
      else callback(null, chunk)
    }
  })

  // MEGA delivers in multi-megabyte chunks; resample between them so a stall reads as slowing down.
  const ticker = setInterval(() => {
    if (entry.status !== 'progressing') return
    entry.bytesPerSecond = sampleSpeed(entry.speedSamples, Date.now(), entry.receivedBytes, entry.bytesPerSecond)
    scheduleBroadcast()
  }, 1000)

  entry.transfer = {
    pause: () => {
      if (entry.status !== 'progressing') return
      entry.status = 'paused'
      entry.paused = true
      entry.canResume = true
      entry.bytesPerSecond = 0
    },
    resume: () => {
      if (entry.status !== 'paused') return
      entry.status = 'progressing'
      entry.paused = false
      entry.canResume = false
      entry.speedSamples = [{ at: Date.now(), bytes: entry.receivedBytes }]
      const release = held
      held = null
      release?.()
    },
    cancel: () => abort.abort()
  }
  broadcast()

  void (async () => {
    try {
      if (start > 0) truncateSync(entry.savePath, start)
      const out = createWriteStream(entry.savePath, { flags: start > 0 ? 'a' : 'w' })
      await pipeline(source.open(start), meter, out, { signal: abort.signal })
    } finally {
      clearInterval(ticker)
    }
  })().then(
    () => {
      entry.transfer = undefined
      settleStream(entry, 'completed')
      broadcast()
      void prepareArchiveForReview(entry)
    },
    (error: unknown) => {
      if (abort.signal.aborted) {
        cancelStream(entry)
        return
      }
      console.warn('[downloads] transfer failed', entry.url, error)
      settleStream(entry, 'interrupted', error instanceof Error ? error.message : String(error))
      entry.canResume = true
      entry.transfer = {
        pause: () => undefined,
        resume: () => {
          const written = fileSize(entry.savePath) ?? 0
          // A complete file that still failed (integrity check) has to start over.
          runStream(entry, source, written < entry.totalBytes ? written : 0)
        },
        cancel: () => cancelStream(entry)
      }
      broadcast()
    }
  )
}

/** Track a download the app streams to disk itself, landing in the incoming folder like the rest. */
export function startStreamDownload(source: StreamDownloadSource): void {
  const dir = getIncomingDownloadsDirSync()
  mkdirSync(dir, { recursive: true })
  const savePath = uniquePath(dir, source.filename)
  closeSync(openSync(savePath, 'w'))
  const now = Date.now()
  const entry: TrackedDownload = {
    id: nextId(),
    filename: basename(savePath),
    url: source.url,
    savePath,
    receivedBytes: 0,
    totalBytes: source.totalBytes,
    status: 'progressing',
    paused: false,
    canResume: false,
    bytesPerSecond: 0,
    startedAt: now,
    updatedAt: now,
    speedSamples: [],
    context: source.context,
    packageHint: source.context?.packageHint,
    sourceLinks: source.context?.sourceLinks
  }
  tracked.set(entry.id, entry)
  runStream(entry, source, 0)
}

export function registerDownloadHandler(): void {
  applyConfiguredDownloadPath()
  void restoreDownloadHistory().catch((error) => {
    console.warn('Could not restore download history', error)
  })
  session.defaultSession.on('will-download', (event, item, webContents) => {
    try {
    const initiator = webContents && !webContents.isDestroyed() ? webContents : null
    if (
      isDataNodesInterstitialDownload(item.getURL(), item.getFilename(), item.getMimeType())
    ) {
      console.warn('[datanodes] skipped HTML interstitial', item.getURL())
      event.preventDefault()
      return
    }
    if (initiator && isGuestContents(initiator)) {
      if (
        shouldBlockDownload({
          url: item.getURL(),
          pageUrl: '',
          filename: item.getFilename(),
          mimeType: item.getMimeType(),
          urlChain: item.getURLChain()
        })
      ) {
        console.warn('[adblock] blocked download', item.getURL())
        event.preventDefault()
        return
      }
    }

    const dir = getIncomingDownloadsDirSync()
    try {
      mkdirSync(dir, { recursive: true })
    } catch (error) {
      console.warn('Could not create downloads folder', error)
    }
    const filename = item.getFilename() || 'download'
    try {
      item.setSavePath(downloadSavePath(dir, filename))
    } catch (error) {
      console.warn('Could not set download path', error)
      event.preventDefault()
      return
    }

    const now = Date.now()
    const context = getDownloadContext(initiator)
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
      speedSamples: [{ at: now, bytes: item.getReceivedBytes() }],
      context,
      packageHint: context?.packageHint,
      sourceLinks: context?.sourceLinks
    }
    tracked.set(entry.id, entry)
    broadcast()
    dismissGuestsAfterDownload(initiator)

    let releasedGuest = false
    const releaseGuest = (): void => {
      if (releasedGuest) return
      releasedGuest = true
      releaseGuestsAfterDownload(initiator)
    }

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
      if (!entry.finishedAt) entry.finishedAt = Date.now()
      entry.bytesPerSecond = 0
      entry.paused = false
      entry.canResume = item.canResume()
      if (state === 'cancelled' && entry.savePath) {
        unlink(entry.savePath, () => undefined)
      }
      broadcast()
      releaseGuest()
      if (state === 'completed') void prepareArchiveForReview(entry)
    })
    } catch (error) {
      console.warn('will-download handler failed', error)
    }
  })
}
