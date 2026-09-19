import { basename, dirname, join } from 'path'
/**
 * WebTorrent engine — Electron MAIN process only (Node APIs).
 * Client: webtorrent ≥2.3 (NOT webtorrent-hybrid). Magnet + seed(path).
 * Announce list uses TRACKER_WEBRTC_URL (WebSocket tracker only).
 *
 * Loaded ONLY when P2P is enabled (dynamic import). Stub-safe if dependency missing.
 *
 * NAT: direct WebRTC ICE via the tracker WebSocket and native node-datachannel.
 * infoHash exposed to metadata/UI is normalized 40-char hex; Buffer stays inside WT.
 *
 * Fallback note (not built): aria2 RPC may later help multi-GB hashing performance.
 */

import {
  isInFlightP2pState,
  type PackageConsensus,
  type PackageInstallTags,
  type P2pTransferProgress
} from '@shared/p2p'
import { mkdir, rename, stat, unlink } from 'fs/promises'
import { addGameFileFromDownload } from '../game-files-store'
import {
  getDownloadsDirSync,
  getP2pUploadLimitKBpsSync,
  getUntrustedDownloadsDirSync
} from '../settings-store'
import {
  persistP2pDownloadSession,
  type PersistedP2pDownload
} from './download-session-store'
import { getAnnounceList, getStunServers } from './env'
import { loadCachedTorrentFile, saveCachedTorrentFile } from './torrent-file-cache'
import { upsertTorrentMapEntry } from './torrent-map-store'
import { normalizeInfoHash, normalizePackageFilename } from '@shared/content-address'
import { installNativeWebRtc } from './webrtc'
import { registerWebtorrentCompat } from './webtorrent-compat'


type WebTorrentLike = {
  add: (uri: string | Buffer | Uint8Array, opts?: object, cb?: (torrent: TorrentLike) => void) => TorrentLike
  seed: (input: string | string[] | Buffer, opts?: object, cb?: (torrent: TorrentLike) => void) => TorrentLike
  remove: (torrentId: string, opts?: object, cb?: (err?: Error | null) => void) => void
  destroy: (cb?: (err?: Error | null) => void) => void
  torrents: TorrentLike[]
  on: (event: string, cb: (...args: unknown[]) => void) => void
  throttleGroups?: {
    up?: {
      setEnabled: (enabled: boolean) => void
      setRate: (rate: number) => void
    }
  }
}

type TorrentLike = {
  infoHash: string
  name: string
  path?: string
  length: number
  downloaded: number
  uploaded: number
  downloadSpeed: number
  uploadSpeed: number
  progress: number
  numPeers: number
  files: { path: string; name: string; length: number }[]
  done: boolean
  ready?: boolean
  paused?: boolean
  wires?: Array<{
    destroy: () => void
    remoteAddress?: string | null
    remotePort?: number | null
    uploadSpeed?: (() => number) | number
    downloadSpeed?: (() => number) | number
  }>
  discovery?: {
    tracker?: {
      update?: (opts?: object) => void
      start?: (opts?: object) => void
      stop?: (opts?: object) => void
    }
  }
  destroy: (opts?: object, cb?: (err?: Error | null) => void) => void
  on: (event: string, cb: (...args: unknown[]) => void) => void
  torrentFile?: Buffer | Uint8Array
  resume?: () => void
  pause?: () => void
}

let client: WebTorrentLike | null = null
let loadError: string | null = null
const progressById = new Map<string, P2pTransferProgress>()
const trackedListenerIds = new Set<string>()
const finalizedContentHashes = new Set<string>()
const torrentById = new Map<string, TorrentLike>()
const pausedIds = new Set<string>()
/** Torrents paused only so an archive can be read/extracted — keep reporting as seeds. */
const archiveHoldIds = new Set<string>()
const quarantineIds = new Set<string>()
const quarantineMetaById = new Map<
  string,
  {
    contentHash?: string
    infoHash?: string | null
    gameName?: string
    gameVersion?: string | null
    f95ThreadId?: number | null
    f95ThreadUrl?: string | null
    normalizedName?: string
    filePath: string
    /** Original .torrent so approve can reseed without create-torrent hashing. */
    torrentFile?: Buffer
  }
>()
type TrackMeta = {
  contentHash?: string
  infoHash?: string | null
  gameName?: string
  gameVersion?: string | null
  f95ThreadId?: number | null
  f95ThreadUrl?: string | null
  normalizedName?: string
  savePath?: string
  consensus?: PackageConsensus | null
}

const listeners = new Set<(items: P2pTransferProgress[]) => void>()
const metaById = new Map<string, TrackMeta>()
const detachWaiters = new Map<string, Promise<void>>()
const refreshById = new Map<string, () => void>()
const lastTransferAt = new Map<string, number>()
let persistTimer: ReturnType<typeof setTimeout> | null = null
let persistSuspended = false
let progressTicker: ReturnType<typeof setInterval> | null = null
let lastPersistFingerprint = ''
const SPEED_NOISE_BPS = 32
const SPEED_STALE_MS = 2000

function uploadLimitBytesPerSec(): number {
  const kBps = getP2pUploadLimitKBpsSync()
  if (!Number.isFinite(kBps) || kBps <= 0) return -1
  return Math.floor(kBps * 1024)
}

/** Apply the saved upload cap to a live WebTorrent client. 0 KB/s = unlimited. */
export function applyP2pUploadLimit(): void {
  const group = client?.throttleGroups?.up
  if (!group) return
  const bytes = uploadLimitBytesPerSec()
  if (bytes < 0) {
    group.setEnabled(false)
    return
  }
  group.setRate(bytes)
  group.setEnabled(true)
}

function emit(): void {
  const items = [...progressById.values()]
  for (const listener of listeners) listener(items)
  schedulePersistDownloads()
}

function rememberMeta(id: string, meta?: TrackMeta): TrackMeta | undefined {
  if (!meta) return metaById.get(id)
  const prev = metaById.get(id)
  const next = { ...prev, ...meta }
  metaById.set(id, next)
  return next
}

function isPersistableTransferState(
  state: P2pTransferProgress['state']
): state is PersistedP2pDownload['state'] {
  return state !== 'idle' && state !== 'seeding' && isInFlightP2pState(state)
}

function persistableSnapshot(): PersistedP2pDownload[] {
  const items: PersistedP2pDownload[] = []
  for (const t of progressById.values()) {
    if (t.id.startsWith('seed:') || !isPersistableTransferState(t.state)) continue
    const meta = metaById.get(t.id)
    const q = quarantineMetaById.get(t.id)
    items.push({
      id: t.id,
      contentHash: t.contentHash,
      infoHash: t.infoHash ?? null,
      path: t.path,
      savePath: meta?.savePath || getUntrustedDownloadsDirSync(),
      filePath: q?.filePath || t.path,
      state: t.state,
      downloaded: t.downloaded,
      uploaded: t.uploaded,
      length: t.length,
      progress: t.progress,
      gameName: t.gameName ?? meta?.gameName,
      gameVersion: t.gameVersion ?? meta?.gameVersion ?? q?.gameVersion,
      f95ThreadId: t.f95ThreadId ?? meta?.f95ThreadId ?? q?.f95ThreadId,
      f95ThreadUrl: t.f95ThreadUrl ?? meta?.f95ThreadUrl ?? q?.f95ThreadUrl,
      normalizedName: t.normalizedName ?? meta?.normalizedName,
      error: t.error,
      updatedAt: Date.now()
    })
  }
  return items
}

function persistFingerprint(items: PersistedP2pDownload[]): string {
  return JSON.stringify(items.map(({ updatedAt: _updatedAt, ...rest }) => rest))
}

function schedulePersistDownloads(): void {
  if (persistSuspended) return
  if (persistTimer) clearTimeout(persistTimer)
  persistTimer = setTimeout(() => {
    persistTimer = null
    const snap = persistableSnapshot()
    const fingerprint = persistFingerprint(snap)
    if (fingerprint === lastPersistFingerprint) return
    lastPersistFingerprint = fingerprint
    void persistP2pDownloadSession(snap).catch((err) => {
      console.warn('[p2p] persist downloads failed', err)
    })
  }, 400)
}

export async function flushP2pDownloadSession(): Promise<void> {
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  const snap = persistableSnapshot()
  lastPersistFingerprint = persistFingerprint(snap)
  await persistP2pDownloadSession(snap)
}

function forgetTransfer(id: string): void {
  progressById.delete(id)
  torrentById.delete(id)
  trackedListenerIds.delete(id)
  pausedIds.delete(id)
  archiveHoldIds.delete(id)
  quarantineIds.delete(id)
  quarantineMetaById.delete(id)
  metaById.delete(id)
  refreshById.delete(id)
  lastTransferAt.delete(id)
  if (refreshById.size === 0) stopProgressTicker()
}

function startProgressTicker(): void {
  if (progressTicker) return
  progressTicker = setInterval(() => {
    if (refreshById.size === 0) {
      stopProgressTicker()
      return
    }
    for (const refresh of refreshById.values()) refresh()
    emit()
  }, 1000)
}

function stopProgressTicker(): void {
  if (!progressTicker) return
  clearInterval(progressTicker)
  progressTicker = null
}


function resolveTorrentDiskPath(torrent: TorrentLike): string | undefined {
  const rel = torrent.files?.[0]?.path
  if (!rel) return undefined
  // WebTorrent File.path is torrent-relative; absolute = join(torrent.path, file.path).
  if (torrent.path) return join(torrent.path, rel)
  return rel
}

async function enterQuarantine(
  id: string,
  torrent: TorrentLike,
  meta?: TrackMeta
): Promise<void> {
  const filePath = resolveTorrentDiskPath(torrent)
  const contentHash = meta?.contentHash?.trim().toLowerCase()
  if (!filePath || !contentHash) {
    console.warn('[p2p] quarantine skipped — missing path/contentHash', { filePath, contentHash })
    return
  }
  if (quarantineIds.has(id) || finalizedContentHashes.has(contentHash)) return

  const stored = rememberMeta(id, meta)
  const torrentFile = copyTorrentFile(torrent.torrentFile)
  if (torrentFile) {
    try {
      await saveCachedTorrentFile(contentHash, torrentFile)
    } catch (err) {
      console.warn('[p2p] failed to cache quarantined torrent', err)
    }
  }

  quarantineIds.add(id)
  pausedIds.add(id)
  quarantineMetaById.set(id, {
    contentHash,
    infoHash: normalizeInfoHash(torrent.infoHash) || stored?.infoHash || null,
    gameName: stored?.gameName,
    gameVersion: stored?.gameVersion,
    f95ThreadId: stored?.f95ThreadId,
    f95ThreadUrl: stored?.f95ThreadUrl,
    normalizedName: stored?.normalizedName,
    filePath,
    torrentFile
  })

  const cur = progressById.get(id)
  progressById.set(id, {
    id,
    contentHash,
    infoHash: normalizeInfoHash(torrent.infoHash) || stored?.infoHash || null,
    path: filePath,
    state: 'quarantined',
    downloaded: torrent.downloaded ?? cur?.downloaded ?? 0,
    uploaded: 0,
    length: torrent.length ?? cur?.length ?? 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    progress: 1,
    numPeers: 0,
    numActivePeers: 0,
    gameName: stored?.gameName ?? cur?.gameName,
    gameVersion: stored?.gameVersion ?? cur?.gameVersion,
    f95ThreadId: stored?.f95ThreadId ?? cur?.f95ThreadId,
    f95ThreadUrl: stored?.f95ThreadUrl ?? cur?.f95ThreadUrl,
    normalizedName: stored?.normalizedName ?? torrent.name ?? cur?.normalizedName
  })
  emit()

  const detach = detachLiveTorrent(id)
    .catch((error) => {
      console.warn('[p2p] quarantine detach failed', error)
    })
    .finally(() => {
      detachWaiters.delete(id)
    })
  detachWaiters.set(id, detach)
  await detach
  void flushP2pDownloadSession().catch((err) => {
    console.warn('[p2p] persist after quarantine failed', err)
  })
  console.info('[p2p] download quarantined pending review', filePath)
}

async function waitForDetach(id: string): Promise<void> {
  const pending = detachWaiters.get(id)
  if (pending) await pending
}

/** Drop the live torrent so Windows releases the file for review/move. Keeps progress. */
async function detachLiveTorrent(id: string): Promise<void> {
  const wt = client
  const live = torrentById.get(id)
  if (!wt || !live) {
    torrentById.delete(id)
    trackedListenerIds.delete(id)
    return
  }
  try {
    live.pause?.()
    disconnectTorrentPeers(live)
  } catch (error) {
    console.warn('[p2p] quarantine pause failed', error)
  }
  await announceStopped(live)
  const torrentId = normalizeInfoHash(live.infoHash) || progressById.get(id)?.infoHash || id
  await new Promise<void>((resolve) => {
    try {
      wt.remove(torrentId, { destroyStore: false }, () => resolve())
    } catch {
      resolve()
    }
  })
  torrentById.delete(id)
  trackedListenerIds.delete(id)
}

/** Promote a reviewed quarantine file into library + trusted downloads + seeding. */
async function promoteQuarantinedFile(
  trustedPath: string,
  meta: {
    contentHash: string
    infoHash?: string | null
    gameName?: string
    gameVersion?: string | null
    f95ThreadId?: number | null
    f95ThreadUrl?: string | null
    normalizedName?: string
    torrentFile?: Buffer
  },
  tags?: PackageInstallTags
): Promise<void> {
  const contentHash = meta.contentHash.trim().toLowerCase()
  const threadId = meta.f95ThreadId
  if (threadId == null || !Number.isFinite(Number(threadId))) {
    throw new Error('Missing thread id — cannot add quarantined file to library.')
  }
  // When tags are provided, copy them exactly (empty version stays empty).
  const gameVersion = tags ? tags.version : meta.gameVersion || ''
  const st = await stat(trustedPath)
  await addGameFileFromDownload(
    {
      threadId: Number(threadId),
      title: meta.gameName || meta.normalizedName || basename(trustedPath),
      version: gameVersion,
      threadUrl: meta.f95ThreadUrl || undefined,
      packageHint: tags
        ? {
            os: tags.os,
            contentKind: tags.contentKind,
            version: tags.version
          }
        : undefined
    },
    trustedPath,
    contentHash,
    st.size
  )
  const infoHash = normalizeInfoHash(meta.infoHash)
  await upsertTorrentMapEntry({
    contentHash,
    infoHash,
    path: trustedPath,
    normalizedName: normalizePackageFilename(meta.normalizedName || basename(trustedPath)),
    sizeBytes: st.size,
    gameName: meta.gameName || undefined,
    gameVersion,
    f95ThreadId: Number(threadId),
    f95ThreadUrl: meta.f95ThreadUrl || null
  })
  finalizedContentHashes.add(contentHash)
  console.info('[p2p] approved quarantine → library', trustedPath)
  // Reseed in the background so Approve returns once the file is in the library.
  void p2pSeedPath(trustedPath, {
    contentHash,
    infoHash: meta.infoHash,
    torrentFile: meta.torrentFile,
    gameName: meta.gameName,
    f95ThreadId: meta.f95ThreadId ?? null,
    normalizedName: normalizePackageFilename(meta.normalizedName || basename(trustedPath))
  })
    .then(() => console.info('[p2p] reseeding approved package', contentHash))
    .catch((error) => console.warn('[p2p] reseed after approve failed', error))
}

export async function p2pRevealQuarantine(id: string): Promise<string> {
  await waitForDetach(id)
  const meta = quarantineMetaById.get(id)
  const cur = progressById.get(id)
  const filePath = meta?.filePath || cur?.path
  if (!filePath) throw new Error('Quarantined file path missing.')
  const { shell } = await import('electron')
  shell.showItemInFolder(filePath)
  return filePath
}

export async function p2pApproveQuarantine(
  id: string,
  tags?: PackageInstallTags
): Promise<{
  dest: string
  contentHash: string
  sizeBytes: number
  gameName?: string
  gameVersion?: string | null
  f95ThreadId?: number | null
  normalizedName?: string
}> {
  await waitForDetach(id)
  const meta = quarantineMetaById.get(id)
  if (!meta?.filePath || !meta.contentHash) {
    throw new Error('No quarantined download with that id.')
  }
  const src = meta.filePath
  const trustedDir = getDownloadsDirSync()
  await mkdir(trustedDir, { recursive: true })
  const dest = join(trustedDir, basename(src))
  if (torrentById.has(id)) {
    await detachLiveTorrent(id)
  }
  forgetTransfer(id)
  emit()
  try {
    await rename(src, dest)
  } catch {
    // cross-device fallback
    const { copyFile } = await import('fs/promises')
    await copyFile(src, dest)
    await unlink(src)
  }
  await promoteQuarantinedFile(dest, { ...meta, contentHash: meta.contentHash }, tags)
  const st = await stat(dest)
  const gameVersion = tags ? tags.version : meta.gameVersion
  return {
    dest,
    contentHash: meta.contentHash,
    sizeBytes: st.size,
    gameName: meta.gameName,
    gameVersion,
    f95ThreadId: meta.f95ThreadId,
    normalizedName: meta.normalizedName
  }
}

export async function p2pRejectQuarantine(id: string): Promise<void> {
  await waitForDetach(id)
  const filePath = quarantineMetaById.get(id)?.filePath || progressById.get(id)?.path
  if (torrentById.has(id)) {
    await p2pRemove(id, { deleteFiles: true })
    return
  }
  forgetTransfer(id)
  emit()
  if (filePath) {
    try {
      await unlink(filePath)
    } catch {
      /* already gone */
    }
  }
}



function copyTorrentFile(buf?: Buffer | Uint8Array | null): Buffer | undefined {
  if (!buf?.length) return undefined
  return Buffer.from(buf)
}

function isSeedTransfer(id: string): boolean {
  return id.startsWith('seed:')
}

/** skipVerify can mark pieces without setting torrent.done until a later _checkDone tick. */
function torrentLooksComplete(torrent: TorrentLike): boolean {
  if (torrent.done) return true
  const length = torrent.length ?? 0
  const downloaded = torrent.downloaded ?? 0
  if (length > 0 && downloaded >= length) return true
  const progress = torrent.progress ?? 0
  return length > 0 && progress >= 1
}

function liveTorrentState(id: string, torrent: TorrentLike): P2pTransferProgress['state'] {
  if (quarantineIds.has(id)) return 'quarantined'
  if (pausedIds.has(id)) return 'paused'
  if (archiveHoldIds.has(id)) {
    const prev = progressById.get(id)?.state
    if (prev === 'seeding' || isSeedTransfer(id) || torrentLooksComplete(torrent)) return 'seeding'
    return prev && prev !== 'paused' ? prev : 'seeding'
  }
  if (isSeedTransfer(id)) {
    // Local share: create-torrent hashing has no infoHash yet. After metadata,
    // we already have the file — never label that as a download.
    if (
      normalizeInfoHash(torrent.infoHash) ||
      torrentLooksComplete(torrent) ||
      torrent.ready ||
      // Reseed of a known torrent: skipVerify parse is not a download.
      normalizeInfoHash(metaById.get(id)?.infoHash)
    ) {
      return 'seeding'
    }
    return 'checking'
  }
  if (torrentLooksComplete(torrent)) return 'seeding'
  const peers = torrent.numPeers ?? 0
  const speed = torrent.downloadSpeed ?? 0
  if (peers === 0 && speed <= 0) return 'connecting'
  return 'downloading'
}

function trackTorrent(id: string, torrent: TorrentLike, meta?: TrackMeta): void {
  torrentById.set(id, torrent)
  const stored = rememberMeta(id, meta)
  const resolveInfoHash = (): string | null =>
    normalizeInfoHash(torrent.infoHash) || normalizeInfoHash(stored?.infoHash) || progressById.get(id)?.infoHash || null

  const update = (state: P2pTransferProgress['state'], error?: string, silent = false): void => {
    const prev = progressById.get(id)
    const forcedPause = pausedIds.has(id)
    const forcedQuarantine = quarantineIds.has(id)
    let nextState = state
    if (forcedQuarantine && state !== 'error') nextState = 'quarantined'
    else if (forcedPause && state !== 'error' && state !== 'paused') nextState = 'paused'

    const complete = torrentLooksComplete(torrent) || nextState === 'seeding'
    const liveLength = torrent.length ?? 0
    const liveDownloaded = torrent.downloaded ?? 0
    const liveProgress = torrent.progress ?? 0
    const length = liveLength > 0 ? liveLength : (prev?.length ?? 0)
    const downloaded = Math.max(liveDownloaded, prev?.downloaded ?? 0)
    const progress = complete
      ? Math.max(liveProgress, prev?.progress ?? 0, 1)
      : Math.max(
          liveProgress,
          prev?.progress ?? 0,
          length > 0 ? downloaded / length : 0
        )
    const idle = nextState === 'paused' || nextState === 'quarantined'
    const seeding = nextState === 'seeding' || complete
    const stale = Date.now() - (lastTransferAt.get(id) ?? 0) > SPEED_STALE_MS
    const peers = idle
      ? { connected: 0, active: 0 }
      : stale
        ? { ...countPeerActivity(torrent), active: 0 }
        : countPeerActivity(torrent)
    const liveSpeeds = torrentTransferSpeeds(torrent)
    const rawDown = idle || seeding || stale ? 0 : liveSpeeds.down
    const rawUp = idle || stale ? 0 : liveSpeeds.up
    progressById.set(id, {
      id,
      contentHash: stored?.contentHash ?? prev?.contentHash,
      infoHash: resolveInfoHash(),
      path: resolveTorrentDiskPath(torrent) ?? prev?.path,
      state: nextState,
      downloaded,
      uploaded: Math.max(torrent.uploaded ?? 0, prev?.uploaded ?? 0),
      length,
      downloadSpeed: rawDown < SPEED_NOISE_BPS ? 0 : rawDown,
      uploadSpeed: rawUp < SPEED_NOISE_BPS ? 0 : rawUp,
      progress,
      numPeers: peers.connected,
      numActivePeers: peers.active,
      error,
      gameName: stored?.gameName ?? prev?.gameName,
      gameVersion: stored?.gameVersion ?? prev?.gameVersion,
      f95ThreadId: stored?.f95ThreadId ?? prev?.f95ThreadId,
      f95ThreadUrl: stored?.f95ThreadUrl ?? prev?.f95ThreadUrl,
      normalizedName: stored?.normalizedName ?? torrent.name ?? prev?.normalizedName,
      consensus: stored?.consensus ?? prev?.consensus
    })
    if (!silent) emit()
  }

  const refresh = (silent = false): void => {
    update(liveTorrentState(id, torrent), undefined, silent)
  }

  refresh()
  if (torrentLooksComplete(torrent) && id.startsWith('add:') && !pausedIds.has(id) && !quarantineIds.has(id)) {
    void enterQuarantine(id, torrent, meta)
  }
  torrentById.set(id, torrent)
  refreshById.set(id, () => refresh(true))
  startProgressTicker()
  if (trackedListenerIds.has(id)) return
  trackedListenerIds.add(id)
  torrent.on('download', () => {
    lastTransferAt.set(id, Date.now())
    refresh()
  })
  torrent.on('upload', () => {
    lastTransferAt.set(id, Date.now())
    refresh()
  })
  torrent.on('metadata', () => refresh())
  torrent.on('ready', () => refresh())
  torrent.on('seed', () => refresh())
  torrent.on('wire', () => refresh())
  torrent.on('done', () => {
    if (pausedIds.has(id)) {
      update('paused')
      return
    }
    if (id.startsWith('add:')) {
      void enterQuarantine(id, torrent, meta)
      return
    }
    update('seeding')
  })
  torrent.on('error', (err: unknown) => {
    update('error', err instanceof Error ? err.message : String(err))
  })
}

/** Re-push current transfer snapshots so the renderer can refresh the shared list. */
export function touchP2pProgress(): void {
  emit()
}


function wireByteSpeed(value: (() => number) | number | undefined): number {
  if (typeof value === 'function') {
    try {
      return value() || 0
    } catch {
      return 0
    }
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function torrentTransferSpeeds(torrent: TorrentLike): { up: number; down: number } {
  const wires = torrent.wires
  if (!Array.isArray(wires) || wires.length === 0) {
    return { up: 0, down: 0 }
  }
  let up = 0
  let down = 0
  let sawWireSpeed = false
  for (const w of wires) {
    if (typeof w.uploadSpeed === 'function' || typeof w.downloadSpeed === 'function') {
      sawWireSpeed = true
    }
    up += wireByteSpeed(w.uploadSpeed)
    down += wireByteSpeed(w.downloadSpeed)
  }
  if (sawWireSpeed) return { up, down }
  return { up: torrent.uploadSpeed ?? 0, down: torrent.downloadSpeed ?? 0 }
}

function countPeerActivity(torrent: TorrentLike): { connected: number; active: number } {
  const connected = Math.max(0, torrent.numPeers ?? 0)
  const wires = torrent.wires
  if (!Array.isArray(wires) || wires.length === 0) {
    return { connected, active: 0 }
  }
  let active = 0
  for (const w of wires) {
    const up = wireByteSpeed(w.uploadSpeed)
    const down = wireByteSpeed(w.downloadSpeed)
    if (up >= SPEED_NOISE_BPS || down >= SPEED_NOISE_BPS) active += 1
  }
  return { connected, active }
}

function disconnectTorrentPeers(torrent: TorrentLike): void {
  const wires = torrent.wires
  if (!Array.isArray(wires)) return
  for (const wire of [...wires]) {
    try {
      wire.destroy()
    } catch {
      /* ignore */
    }
  }
}



async function ensureClient(): Promise<WebTorrentLike> {
  persistSuspended = false
  if (client) return client
  if (loadError) throw new Error(loadError)
  try {
    const webrtc = await installNativeWebRtc()
    if (!webrtc.ok) {
      throw new Error(`native WebRTC unavailable: ${webrtc.message}`)
    }
    // WebTorrent checks globalThis.WRTC as it is imported, so native WebRTC
    // must be installed before this dynamic import.
    registerWebtorrentCompat()
    const mod = (await import('webtorrent')) as { default?: new () => WebTorrentLike } & (new () => WebTorrentLike)
    const WebTorrent = mod.default ?? mod
    if (!(WebTorrent as unknown as { WEBRTC_SUPPORT?: boolean }).WEBRTC_SUPPORT) {
      throw new Error('WebTorrent did not enable the native WebRTC transport')
    }
    const iceServers = getStunServers()
    console.info(
      '[p2p] WebTorrent client',
      'direct WebRTC enabled',
      'iceServers=',
      iceServers.length,
      'wsTracker=',
      Boolean(getAnnounceList().some((u) => u.startsWith('ws')))
    )
    // Public-path only: DHT/LSD off so peers meet through the configured tracker.
    const { getP2pHttpsAgent } = await import('./p2p-tls')
    client = new (WebTorrent as unknown as new (opts?: object) => WebTorrentLike)({
      dht: false,
      lsd: false,
      // WebRTC (native) via the WebSocket tracker. uTP flaky on Windows.
      utp: false,
      uploadLimit: uploadLimitBytesPerSec(),
      tracker: {
        rtcConfig: {
          iceServers
        },
        // Trust private CA for wss:// tracker (same pin as metadata HTTPS).
        proxyOpts: {
          httpsAgent: getP2pHttpsAgent()
        }
      }
    })
    client.on('error', (err: unknown) => {
      console.warn('[p2p/webtorrent] client error', err)
    })
    return client
  } catch (error) {
    loadError =
      error instanceof Error
        ? `webtorrent unavailable: ${error.message}`
        : 'webtorrent unavailable'
    throw new Error(loadError)
  }
}

function announceList(): string[] {
  return getAnnounceList()
}

function infoHashFromMagnet(magnetUri: string): string | null {
  const m = /btih:([a-fA-F0-9]{40})/i.exec(magnetUri)
  return m ? m[1].toLowerCase() : null
}

function findTrackedByHash(contentHash?: string, infoHash?: string | null): P2pTransferProgress | undefined {
  const ch = contentHash?.trim().toLowerCase()
  const ih = normalizeInfoHash(infoHash)
  return listP2pProgress().find(
    (t) => (ch && t.contentHash?.toLowerCase() === ch) || (ih && t.infoHash === ih)
  )
}

export function onP2pProgress(listener: (items: P2pTransferProgress[]) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function listP2pProgress(): P2pTransferProgress[] {
  return [...progressById.values()]
}

export function adoptQuarantinedTransfer(entry: PersistedP2pDownload): P2pTransferProgress {
  persistSuspended = false
  const filePath = entry.filePath || entry.path
  const contentHash = entry.contentHash?.trim().toLowerCase()
  if (!filePath || !contentHash) {
    throw new Error('Invalid quarantined download snapshot')
  }
  const id = entry.id
  const meta: TrackMeta = {
    contentHash,
    infoHash: normalizeInfoHash(entry.infoHash) || null,
    gameName: entry.gameName,
    gameVersion: entry.gameVersion,
    f95ThreadId: entry.f95ThreadId,
    f95ThreadUrl: entry.f95ThreadUrl,
    normalizedName: entry.normalizedName,
    savePath: entry.savePath
  }
  rememberMeta(id, meta)
  quarantineIds.add(id)
  pausedIds.add(id)
  quarantineMetaById.set(id, { ...meta, filePath })
  const row: P2pTransferProgress = {
    id,
    contentHash,
    infoHash: meta.infoHash,
    path: filePath,
    state: 'quarantined',
    downloaded: entry.length || entry.downloaded,
    uploaded: 0,
    length: entry.length || entry.downloaded,
    downloadSpeed: 0,
    uploadSpeed: 0,
    progress: 1,
    numPeers: 0,
    numActivePeers: 0,
    gameName: entry.gameName,
    gameVersion: entry.gameVersion,
    f95ThreadId: entry.f95ThreadId,
    f95ThreadUrl: entry.f95ThreadUrl,
    normalizedName: entry.normalizedName
  }
  progressById.set(id, row)
  emit()
  return row
}

export function adoptFailedTransfer(entry: PersistedP2pDownload, error: string): P2pTransferProgress {
  persistSuspended = false
  rememberMeta(entry.id, {
    contentHash: entry.contentHash,
    infoHash: entry.infoHash,
    gameName: entry.gameName,
    gameVersion: entry.gameVersion,
    f95ThreadId: entry.f95ThreadId,
    f95ThreadUrl: entry.f95ThreadUrl,
    normalizedName: entry.normalizedName,
    savePath: entry.savePath
  })
  const row: P2pTransferProgress = {
    id: entry.id,
    contentHash: entry.contentHash,
    infoHash: entry.infoHash ?? null,
    path: entry.path || entry.filePath,
    state: 'error',
    downloaded: entry.downloaded,
    uploaded: entry.uploaded,
    length: entry.length,
    downloadSpeed: 0,
    uploadSpeed: 0,
    progress: entry.progress,
    numPeers: 0,
    numActivePeers: 0,
    error,
    gameName: entry.gameName,
    gameVersion: entry.gameVersion,
    f95ThreadId: entry.f95ThreadId,
    f95ThreadUrl: entry.f95ThreadUrl,
    normalizedName: entry.normalizedName
  }
  progressById.set(entry.id, row)
  emit()
  return row
}

export function hasLiveTorrent(id: string): boolean {
  return torrentById.has(id)
}

export async function p2pAddMagnet(
  magnetUri: string,
  opts?: {
    contentHash?: string
    path?: string
    gameName?: string
    f95ThreadId?: number | null
    f95ThreadUrl?: string | null
    gameVersion?: string | null
    normalizedName?: string
    consensus?: PackageConsensus | null
    startPaused?: boolean
    snapshot?: {
      downloaded?: number
      uploaded?: number
      length?: number
      progress?: number
      path?: string
    }
  }
): Promise<P2pTransferProgress> {
  const wtClient = await ensureClient()
  const downloadPath = opts?.path || getUntrustedDownloadsDirSync()
  try {
    await mkdir(downloadPath, { recursive: true })
  } catch {
    /* best-effort */
  }

  const magnetInfoHash = infoHashFromMagnet(magnetUri)
  const already = findTrackedByHash(opts?.contentHash, magnetInfoHash)
  if (already) {
    // Stale seed/error rows after library delete must not block a fresh add.
    if (
      already.state === 'connecting' ||
      already.state === 'downloading' ||
      already.state === 'checking' ||
      already.state === 'paused' ||
      already.state === 'quarantined'
    ) {
      return already
    }
    if (already.state === 'seeding' && already.path) {
      try {
        const { access } = await import('fs/promises')
        await access(already.path)
        return already
      } catch {
        await p2pRemove(already.id, { deleteFiles: false })
      }
    } else if (already.state === 'seeding' || already.state === 'error' || already.state === 'idle') {
      await p2pRemove(already.id, { deleteFiles: false })
    } else {
      return already
    }
  }

  // WebTorrent may already have this infoHash (e.g. prior click waiting on metadata).
  const existingTorrent = magnetInfoHash
    ? wtClient.torrents.find((t) => normalizeInfoHash(t.infoHash) === magnetInfoHash)
    : undefined
  if (existingTorrent) {
    const id = `add:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
    trackTorrent(id, existingTorrent, {
      contentHash: opts?.contentHash,
      infoHash: magnetInfoHash,
      gameName: opts?.gameName,
      gameVersion: opts?.gameVersion,
      f95ThreadId: opts?.f95ThreadId,
      f95ThreadUrl: opts?.f95ThreadUrl,
      normalizedName: opts?.normalizedName,
      consensus: opts?.consensus,
      savePath: downloadPath
    })
    if (existingTorrent.done) {
      void enterQuarantine(id, existingTorrent, {
        contentHash: opts?.contentHash,
        infoHash: magnetInfoHash,
        gameName: opts?.gameName,
        gameVersion: opts?.gameVersion,
        f95ThreadId: opts?.f95ThreadId,
        f95ThreadUrl: opts?.f95ThreadUrl,
        normalizedName: opts?.normalizedName
      })
    }
    return progressById.get(id)!
  }

  const id = `add:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  const meta = {
    contentHash: opts?.contentHash,
    infoHash: magnetInfoHash,
    gameName: opts?.gameName,
    gameVersion: opts?.gameVersion,
    f95ThreadId: opts?.f95ThreadId,
    f95ThreadUrl: opts?.f95ThreadUrl,
    normalizedName: opts?.normalizedName,
    consensus: opts?.consensus,
    savePath: downloadPath
  }
  if (opts?.startPaused) pausedIds.add(id)
  if (opts?.snapshot && ((opts.snapshot.length ?? 0) > 0 || (opts.snapshot.downloaded ?? 0) > 0)) {
    progressById.set(id, {
      id,
      contentHash: opts.contentHash,
      infoHash: magnetInfoHash,
      path: opts.snapshot.path,
      state: opts.startPaused ? 'paused' : 'connecting',
      downloaded: opts.snapshot.downloaded ?? 0,
      uploaded: opts.snapshot.uploaded ?? 0,
      length: opts.snapshot.length ?? 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      progress:
        opts.snapshot.progress ||
        ((opts.snapshot.length ?? 0) > 0
          ? (opts.snapshot.downloaded ?? 0) / (opts.snapshot.length ?? 1)
          : 0),
      numPeers: 0,
      numActivePeers: 0,
      gameName: opts.gameName,
      gameVersion: opts.gameVersion,
      f95ThreadId: opts.f95ThreadId,
      f95ThreadUrl: opts.f95ThreadUrl,
      normalizedName: opts.normalizedName,
      consensus: opts.consensus
    })
  }

  try {
    const torrent = wtClient.add(magnetUri, { announce: announceList(), path: downloadPath })
    // Track immediately so UI shows Connecting before metadata/peers arrive.
    trackTorrent(id, torrent, meta)
    if (opts?.startPaused) {
      try {
        torrent.pause?.()
        disconnectTorrentPeers(torrent)
      } catch (error) {
        console.warn('[p2p] startPaused failed', error)
      }
    }
    torrent.on('ready', () => {
      // Refresh progress now that infoHash/length are known
      trackTorrent(id, torrent, meta)
      if (torrent.done) void enterQuarantine(id, torrent, meta)
    })
    torrent.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      if (/duplicate|already exists|Cannot add/i.test(msg)) {
        const tracked = findTrackedByHash(opts?.contentHash, magnetInfoHash)
        if (tracked) return
      }
      const cur = progressById.get(id)
      if (cur) {
        progressById.set(id, { ...cur, state: 'error', error: msg })
        emit()
      }
    })
    return progressById.get(id)!
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    if (/duplicate|already exists|Cannot add/i.test(msg)) {
      const tracked = findTrackedByHash(opts?.contentHash, magnetInfoHash)
      if (tracked) return tracked
    }
    throw error instanceof Error ? error : new Error(msg)
  }
}

export async function p2pSeedPath(
  filePath: string,
  opts?: {
    contentHash?: string
    infoHash?: string | null
    torrentFile?: Buffer | Uint8Array
    gameName?: string
    f95ThreadId?: number | null
    normalizedName?: string
  }
): Promise<P2pTransferProgress> {
  const wtClient = await ensureClient()
  const id = `seed:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  const meta = {
    contentHash: opts?.contentHash,
    infoHash: normalizeInfoHash(opts?.infoHash),
    gameName: opts?.gameName,
    f95ThreadId: opts?.f95ThreadId,
    normalizedName: opts?.normalizedName
  }

  // Fast path: reuse the original .torrent + skipVerify (no create-torrent re-hash).
  const cached =
    copyTorrentFile(opts?.torrentFile) ||
    (opts?.contentHash ? await loadCachedTorrentFile(opts.contentHash) : null)
  if (cached) {
    const existing = findTrackedByHash(opts?.contentHash, meta.infoHash)
    if (existing?.state === 'seeding') return existing
    try {
      const torrent = wtClient.add(cached, {
        announce: announceList(),
        path: dirname(filePath),
        skipVerify: true
      } as object)
      trackTorrent(id, torrent, meta)
      try {
        torrent.resume?.()
      } catch {
        /* ignore */
      }
      torrent.on('ready', () => {
        trackTorrent(id, torrent, meta)
        try {
          torrent.resume?.()
        } catch {
          /* ignore */
        }
      })
      torrent.on('error', (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        if (/duplicate|already exists|Cannot add/i.test(msg)) return
        const cur = progressById.get(id)
        if (cur) {
          progressById.set(id, { ...cur, state: 'error', error: msg })
          emit()
        }
      })
      return progressById.get(id)!
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (/duplicate|already exists|Cannot add/i.test(msg)) {
        const tracked = findTrackedByHash(opts?.contentHash, meta.infoHash)
        if (tracked) return tracked
      }
      console.warn('[p2p] cached torrent add failed, falling back to seed(path)', msg)
    }
  }

  const seedMeta = { ...meta, infoHash: undefined }

  try {
    const torrent = wtClient.seed(filePath, { announce: announceList() }, (t) => {
      trackTorrent(id, t, {
        ...seedMeta,
        infoHash: normalizeInfoHash(t.infoHash)
      })
      try {
        t.resume?.()
      } catch {
        /* ignore */
      }
      const buf = t.torrentFile
      if (opts?.contentHash && buf) {
        void saveCachedTorrentFile(opts.contentHash, buf).catch((err) => {
          console.warn('[p2p] failed to cache torrent file', err)
        })
      }
    })
    // Keep the live torrent for waitForTorrentInfoHash, but do not emit a Checking
    // row — the file is already usable; piece hashing is background work.
    torrentById.set(id, torrent)
    rememberMeta(id, seedMeta)
    torrent.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      const cur = progressById.get(id)
      if (cur) {
        progressById.set(id, { ...cur, state: 'error', error: msg })
        emit()
        return
      }
      progressById.set(id, {
        id,
        contentHash: seedMeta.contentHash,
        infoHash: null,
        path: filePath,
        state: 'error',
        downloaded: 0,
        uploaded: 0,
        length: 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        progress: 0,
        numPeers: 0,
        numActivePeers: 0,
        error: msg,
        gameName: seedMeta.gameName,
        f95ThreadId: seedMeta.f95ThreadId,
        normalizedName: seedMeta.normalizedName
      })
      emit()
    })
    return {
      id,
      contentHash: seedMeta.contentHash,
      infoHash: null,
      path: filePath,
      state: 'checking',
      downloaded: 0,
      uploaded: 0,
      length: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      progress: 0,
      numPeers: 0,
      numActivePeers: 0,
      gameName: seedMeta.gameName,
      f95ThreadId: seedMeta.f95ThreadId,
      normalizedName: seedMeta.normalizedName
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error))
  }
}


export async function waitForTorrentInfoHash(
  id: string,
  timeoutMs = 180_000
): Promise<P2pTransferProgress> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const cur = progressById.get(id)
    const live = torrentById.get(id)
    const infoHash =
      cur?.infoHash || (live ? normalizeInfoHash(live.infoHash) : null)
    if (infoHash) {
      if (cur) return { ...cur, infoHash }
      return {
        id,
        infoHash,
        state: live ? liveTorrentState(id, live) : 'checking',
        downloaded: live?.downloaded ?? 0,
        uploaded: live?.uploaded ?? 0,
        length: live?.length ?? 0,
        downloadSpeed: 0,
        uploadSpeed: 0,
        progress: live?.progress ?? 0,
        numPeers: live?.numPeers ?? 0,
        numActivePeers: live ? countPeerActivity(live).active : 0
      }
    }
    if (cur?.state === 'error') {
      throw new Error(cur.error || 'P2P seed failed')
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('Timed out waiting for torrent infoHash (create-torrent still hashing?)')
}



function pauseTorrentEngine(id: string): void {
  const torrent = torrentById.get(id)
  try {
    torrent?.pause?.()
    if (torrent) disconnectTorrentPeers(torrent)
  } catch (error) {
    console.warn('[p2p] pause failed', error)
  }
}

export async function p2pPause(id: string): Promise<P2pTransferProgress | null> {
  const cur = progressById.get(id)
  if (!cur) return null
  pausedIds.add(id)
  archiveHoldIds.delete(id)
  pauseTorrentEngine(id)
  const next = {
    ...cur,
    state: 'paused' as const,
    downloadSpeed: 0,
    uploadSpeed: 0,
    numPeers: 0,
    numActivePeers: 0
  }
  progressById.set(id, next)
  emit()
  void flushP2pDownloadSession().catch((err) => {
    console.warn('[p2p] persist after pause failed', err)
  })
  return next
}

export async function p2pResume(id: string): Promise<P2pTransferProgress | null> {
  const torrent = torrentById.get(id)
  const cur = progressById.get(id)
  if (!cur) return null
  pausedIds.delete(id)
  archiveHoldIds.delete(id)
  try {
    torrent?.resume?.()
    // pause() + wire teardown empties the peer set; force a tracker update so we
    // get peers again (resume() alone only drains an already-empty queue).
    const tracker = torrent?.discovery?.tracker
    if (tracker) {
      try {
        if (typeof tracker.update === 'function') tracker.update()
        else if (typeof tracker.start === 'function') tracker.start()
      } catch (error) {
        console.warn('[p2p] tracker re-announce on resume failed', error)
      }
    }
  } catch (error) {
    console.warn('[p2p] resume failed', error)
  }
  const state = torrent
    ? liveTorrentState(id, torrent)
    : isSeedTransfer(id)
      ? 'seeding'
      : 'connecting'
  const peers = torrent ? countPeerActivity(torrent) : { connected: 0, active: 0 }
  const next = {
    ...cur,
    state,
    numPeers: peers.connected,
    numActivePeers: peers.active
  }
  progressById.set(id, next)
  emit()
  void flushP2pDownloadSession().catch((err) => {
    console.warn('[p2p] persist after resume failed', err)
  })
  return next
}


function transferIdsForArchive(
  archivePath: string,
  contentHash?: string | null
): string[] {
  const norm = archivePath.replace(/\\/g, '/').toLowerCase()
  const base = norm.split('/').pop() || norm
  const hash = contentHash?.trim().toLowerCase() || ''
  const ids: string[] = []
  for (const [id, t] of progressById) {
    const p = (t.path || '').replace(/\\/g, '/').toLowerCase()
    const hashMatch = Boolean(hash && t.contentHash?.toLowerCase() === hash)
    const pathMatch = Boolean(p && (p === norm || p.endsWith('/' + base) || norm.endsWith(p)))
    if (hashMatch || pathMatch) ids.push(id)
  }
  return ids
}

/**
 * Pause any live torrent holding this archive so Windows can open/extract it.
 * Returns ids that were newly paused (already-paused transfers are left alone).
 *
 * `silent` keeps the transfer as a seed in the UI (used while extracting).
 * Without it, the pause is user-visible so the file can stay unlocked in Explorer.
 */
export async function pauseTorrentsForArchive(
  archivePath: string,
  contentHash?: string | null,
  opts?: { silent?: boolean }
): Promise<string[]> {
  const ids = transferIdsForArchive(archivePath, contentHash)
  const pausedByUs: string[] = []
  const silent = Boolean(opts?.silent)
  for (const id of ids) {
    const cur = progressById.get(id)
    if (!cur || cur.state === 'paused' || pausedIds.has(id)) continue
    if (silent) {
      if (archiveHoldIds.has(id)) continue
      archiveHoldIds.add(id)
      pauseTorrentEngine(id)
      refreshById.get(id)?.()
      emit()
    } else {
      await p2pPause(id)
    }
    pausedByUs.push(id)
  }
  return pausedByUs
}

/** Resume torrents previously paused by {@link pauseTorrentsForArchive}. */
export async function resumeTorrentsByIds(ids: string[]): Promise<void> {
  for (const id of ids) {
    archiveHoldIds.delete(id)
    if (pausedIds.has(id) || quarantineIds.has(id)) continue
    try {
      await p2pResume(id)
    } catch (error) {
      console.warn('[p2p] resume after archive use failed', id, error)
    }
  }
}

export async function p2pStopTransfer(id: string): Promise<void> {
  await p2pRemove(id, { deleteFiles: true })
}

export function clearFinalizedContentHash(contentHash?: string | null): void {
  const h = contentHash?.trim().toLowerCase()
  if (h) finalizedContentHashes.delete(h)
}

/** Drop live WebTorrent handles for a contentHash (e.g. after library archive delete). */
export async function teardownP2pForContentHash(contentHash?: string | null): Promise<void> {
  const h = contentHash?.trim().toLowerCase()
  if (!h) return
  finalizedContentHashes.delete(h)
  const ids = [
    ...new Set(
      [...progressById.entries()]
        .filter(([, t]) => t.contentHash?.toLowerCase() === h)
        .map(([id]) => id)
    )
  ]
  for (const id of ids) {
    try {
      await p2pRemove(id, { deleteFiles: false })
    } catch (error) {
      console.warn('[p2p] teardown after library remove failed', id, error)
    }
  }
}



/** Tell trackers we left the swarm (event=stopped) so the tracker drops us now, not in ~45m. */
async function announceStopped(torrent: TorrentLike | undefined | null): Promise<void> {
  if (!torrent) return
  try {
    const tracker = torrent.discovery?.tracker
    if (tracker && typeof tracker.stop === 'function') {
      tracker.stop()
    }
  } catch (error) {
    console.warn('[p2p] tracker event=stopped failed', error)
  }
  // Brief wait so HTTP announce can leave before we tear down sockets.
  await new Promise((r) => setTimeout(r, 200))
}

export async function p2pRemove(
  idOrInfoHash: string,
  opts?: { deleteFiles?: boolean }
): Promise<void> {
  const deleteFiles = Boolean(opts?.deleteFiles)
  const wt = client
  const entry = progressById.get(idOrInfoHash)
  const filePath = entry?.path || quarantineMetaById.get(idOrInfoHash)?.filePath
  const contentHash = entry?.contentHash
  if (contentHash) finalizedContentHashes.delete(contentHash.toLowerCase())

  if (!wt) {
    forgetTransfer(idOrInfoHash)
    emit()
    if (deleteFiles && filePath) {
      try {
        await unlink(filePath)
      } catch {
        /* already gone */
      }
    }
    return
  }
  const torrentId = entry?.infoHash || idOrInfoHash
  const live =
    torrentById.get(idOrInfoHash) ||
    [...torrentById.entries()].find(([, t]) => normalizeInfoHash(t.infoHash) === normalizeInfoHash(torrentId))?.[1]
  if (live) {
    await announceStopped(live)
    await new Promise<void>((resolve) => {
      try {
        wt.remove(torrentId, { destroyStore: deleteFiles }, () => resolve())
      } catch {
        resolve()
      }
    })
  }
  forgetTransfer(idOrInfoHash)
  for (const [key, value] of [...progressById.entries()]) {
    if (value.infoHash === torrentId || (contentHash && value.contentHash?.toLowerCase() === contentHash.toLowerCase())) {
      forgetTransfer(key)
    }
  }
  emit()
  if (deleteFiles && filePath) {
    try {
      await unlink(filePath)
    } catch {
      /* destroyStore may have removed it */
    }
  }
}

export async function destroyWebTorrent(): Promise<void> {
  try {
    await flushP2pDownloadSession()
  } catch (error) {
    console.warn('[p2p] persist downloads before destroy failed', error)
  }
  persistSuspended = true
  if (persistTimer) {
    clearTimeout(persistTimer)
    persistTimer = null
  }
  stopProgressTicker()
  refreshById.clear()
  lastTransferAt.clear()
  const wt = client
  if (wt) {
    const torrents = [...torrentById.values()]
    for (const t of torrents) {
      await announceStopped(t)
    }
  }
  client = null
  progressById.clear()
  trackedListenerIds.clear()
  torrentById.clear()
  finalizedContentHashes.clear()
  pausedIds.clear()
  archiveHoldIds.clear()
  quarantineIds.clear()
  quarantineMetaById.clear()
  metaById.clear()
  detachWaiters.clear()
  emit()
  if (wt) {
    await new Promise<void>((resolve) => {
      wt.destroy(() => resolve())
    })
  }
}

export function getWebTorrentLoadError(): string | null {
  return loadError
}
