import { basename, dirname, join } from 'path'
/**
 * WebTorrent engine — Electron MAIN process only (Node APIs).
 * Client: webtorrent ≥2.3 (NOT webtorrent-hybrid). Magnet + seed(path).
 * Announce list uses TRACKER_ANNOUNCE_URL (opentracker HTTP+UDP).
 *
 * Loaded ONLY when P2P is enabled (dynamic import). Stub-safe if dependency missing.
 *
 * NAT: direct WebRTC ICE via the WebSocket tracker and native node-datachannel.
 * HTTP/UDP trackers are retained for normal BitTorrent peers and swarm visibility.
 * infoHash exposed to metadata/UI is normalized 40-char hex; Buffer stays inside WT.
 *
 * Fallback note (not built): aria2 RPC may later help multi-GB hashing performance.
 */

import type { P2pTransferProgress } from '@shared/p2p'
import { mkdir, rename, stat, unlink } from 'fs/promises'
import { addGameFileFromDownload } from '../game-files-store'
import { getDownloadsDirSync, getUntrustedDownloadsDirSync } from '../settings-store'
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
  wires?: Array<{ destroy: () => void; remoteAddress?: string | null; remotePort?: number | null }>
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
  }
>()
const listeners = new Set<(items: P2pTransferProgress[]) => void>()

function emit(): void {
  const items = [...progressById.values()]
  for (const listener of listeners) listener(items)
}

type TrackMeta = {
  contentHash?: string
  infoHash?: string | null
  gameName?: string
  gameVersion?: string | null
  f95ThreadId?: number | null
  f95ThreadUrl?: string | null
  normalizedName?: string
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

  const buf = torrent.torrentFile
  if (buf) {
    void saveCachedTorrentFile(contentHash, buf).catch((err) => {
      console.warn('[p2p] failed to cache quarantined torrent', err)
    })
  }

  quarantineIds.add(id)
  pausedIds.add(id)
  quarantineMetaById.set(id, {
    contentHash,
    infoHash: normalizeInfoHash(torrent.infoHash) || meta?.infoHash || null,
    gameName: meta?.gameName,
    gameVersion: meta?.gameVersion,
    f95ThreadId: meta?.f95ThreadId,
    f95ThreadUrl: meta?.f95ThreadUrl,
    normalizedName: meta?.normalizedName,
    filePath
  })

  try {
    torrent.pause?.()
    disconnectTorrentPeers(torrent)
  } catch (error) {
    console.warn('[p2p] quarantine pause failed', error)
  }

  const cur = progressById.get(id)
  progressById.set(id, {
    id,
    contentHash,
    infoHash: normalizeInfoHash(torrent.infoHash) || meta?.infoHash || null,
    path: filePath,
    state: 'quarantined',
    downloaded: torrent.downloaded ?? cur?.downloaded ?? 0,
    uploaded: 0,
    length: torrent.length ?? cur?.length ?? 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    progress: 1,
    numPeers: 0,
    gameName: meta?.gameName ?? cur?.gameName,
    f95ThreadId: meta?.f95ThreadId ?? cur?.f95ThreadId,
    normalizedName: meta?.normalizedName ?? torrent.name ?? cur?.normalizedName
  })
  emit()
  console.info('[p2p] download quarantined pending review', filePath)
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
  }
): Promise<void> {
  const contentHash = meta.contentHash.trim().toLowerCase()
  const threadId = meta.f95ThreadId
  if (threadId == null || !Number.isFinite(Number(threadId))) {
    throw new Error('Missing thread id — cannot add quarantined file to library.')
  }
  const st = await stat(trustedPath)
  await addGameFileFromDownload(
    {
      threadId: Number(threadId),
      title: meta.gameName || meta.normalizedName || basename(trustedPath),
      version: meta.gameVersion || 'Unknown',
      threadUrl: meta.f95ThreadUrl || undefined
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
    gameVersion: meta.gameVersion || null,
    f95ThreadId: Number(threadId),
    f95ThreadUrl: meta.f95ThreadUrl || null
  })
  finalizedContentHashes.add(contentHash)
  console.info('[p2p] approved quarantine → library', trustedPath)
  try {
    await p2pSeedPath(trustedPath, {
      contentHash,
      gameName: meta.gameName,
      f95ThreadId: meta.f95ThreadId ?? null,
      normalizedName: normalizePackageFilename(meta.normalizedName || basename(trustedPath))
    })
    console.info('[p2p] reseeding approved package', contentHash)
  } catch (error) {
    console.warn('[p2p] reseed after approve failed', error)
  }
}

export async function p2pRevealQuarantine(id: string): Promise<string> {
  const meta = quarantineMetaById.get(id)
  const cur = progressById.get(id)
  const filePath = meta?.filePath || cur?.path
  if (!filePath) throw new Error('Quarantined file path missing.')
  const { shell } = await import('electron')
  shell.showItemInFolder(filePath)
  return filePath
}

export async function p2pApproveQuarantine(id: string): Promise<void> {
  const meta = quarantineMetaById.get(id)
  if (!meta?.filePath || !meta.contentHash) {
    throw new Error('No quarantined download with that id.')
  }
  const src = meta.filePath
  const trustedDir = getDownloadsDirSync()
  await mkdir(trustedDir, { recursive: true })
  const dest = join(trustedDir, basename(src))
  // Drop live torrent first so Windows releases the lock for rename.
  quarantineIds.delete(id)
  pausedIds.delete(id)
  quarantineMetaById.delete(id)
  await p2pRemove(id, { deleteFiles: false })
  try {
    await rename(src, dest)
  } catch {
    // cross-device fallback
    const { copyFile } = await import('fs/promises')
    await copyFile(src, dest)
    await unlink(src)
  }
  await promoteQuarantinedFile(dest, { ...meta, contentHash: meta.contentHash })
  // clear any leftover progress
  progressById.delete(id)
  emit()
}

export async function p2pRejectQuarantine(id: string): Promise<void> {
  quarantineIds.delete(id)
  pausedIds.delete(id)
  quarantineMetaById.delete(id)
  await p2pRemove(id, { deleteFiles: true })
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
  if (isSeedTransfer(id)) {
    // Local share: create-torrent hashing has no infoHash yet. After metadata,
    // we already have the file — never label that as a download.
    if (normalizeInfoHash(torrent.infoHash) || torrentLooksComplete(torrent) || torrent.ready) {
      return 'seeding'
    }
    return 'checking'
  }
  return torrentLooksComplete(torrent) ? 'seeding' : 'downloading'
}

function trackTorrent(id: string, torrent: TorrentLike, meta?: TrackMeta): void {
  torrentById.set(id, torrent)
  const resolveInfoHash = (): string | null =>
    normalizeInfoHash(torrent.infoHash) || normalizeInfoHash(meta?.infoHash) || progressById.get(id)?.infoHash || null

  const update = (state: P2pTransferProgress['state'], error?: string): void => {
    const prev = progressById.get(id)
    const forcedPause = pausedIds.has(id)
    const forcedQuarantine = quarantineIds.has(id)
    let nextState = state
    if (forcedQuarantine && state !== 'error') nextState = 'quarantined'
    else if (forcedPause && state !== 'error' && state !== 'paused') nextState = 'paused'

    const complete = torrentLooksComplete(torrent) || nextState === 'seeding'
    progressById.set(id, {
      id,
      contentHash: meta?.contentHash ?? prev?.contentHash,
      infoHash: resolveInfoHash(),
      path: resolveTorrentDiskPath(torrent) ?? prev?.path,
      state: nextState,
      downloaded: torrent.downloaded ?? 0,
      uploaded: torrent.uploaded ?? 0,
      length: torrent.length ?? prev?.length ?? 0,
      downloadSpeed: nextState === 'paused' || nextState === 'quarantined' ? 0 : (torrent.downloadSpeed ?? 0),
      uploadSpeed: nextState === 'paused' || nextState === 'quarantined' ? 0 : (torrent.uploadSpeed ?? 0),
      progress: complete ? Math.max(torrent.progress ?? 0, 1) : (torrent.progress ?? 0),
      numPeers: countUniqueRemotePeerIps(torrent),
      error,
      gameName: meta?.gameName ?? prev?.gameName,
      f95ThreadId: meta?.f95ThreadId ?? prev?.f95ThreadId,
      normalizedName: meta?.normalizedName ?? torrent.name ?? prev?.normalizedName
    })
    emit()
  }

  const refresh = (): void => {
    update(liveTorrentState(id, torrent))
  }

  refresh()
  if (torrentLooksComplete(torrent) && id.startsWith('add:') && !pausedIds.has(id) && !quarantineIds.has(id)) {
    void enterQuarantine(id, torrent, meta)
  }
  torrentById.set(id, torrent)
  if (trackedListenerIds.has(id)) return
  trackedListenerIds.add(id)
  torrent.on('download', refresh)
  torrent.on('upload', refresh)
  torrent.on('metadata', refresh)
  torrent.on('ready', refresh)
  torrent.on('seed', refresh)
  torrent.on('wire', refresh)
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


/** WebTorrent numPeers counts wires (IP:port / dual transport). UI wants unique remote IPs. */
function countUniqueRemotePeerIps(torrent: TorrentLike): number {
  const wires = torrent.wires
  if (!Array.isArray(wires) || wires.length === 0) {
    return Math.max(0, torrent.numPeers ?? 0)
  }
  const seen = new Set<string>()
  for (const w of wires) {
    const addr = typeof w.remoteAddress === 'string' ? w.remoteAddress.trim() : ''
    if (!addr) continue
    // Normalize IPv4-mapped IPv6 so the same host isn't double-counted.
    const key = addr.startsWith('::ffff:') ? addr.slice(7) : addr
    if (key === '127.0.0.1' || key === '::1') continue
    seen.add(key)
  }
  // If wires lacked addresses, fall back to library count rather than lying with 0.
  if (seen.size === 0 && (torrent.numPeers ?? 0) > 0) return torrent.numPeers ?? 0
  return seen.size
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
    client = new (WebTorrent as unknown as new (opts?: object) => WebTorrentLike)({
      dht: false,
      lsd: false,
      // TCP via tracker peer list; WebRTC (native) for NAT hole punch. uTP flaky on Windows.
      utp: false,
      tracker: {
        rtcConfig: {
          iceServers
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
      normalizedName: opts?.normalizedName
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
    normalizedName: opts?.normalizedName
  }

  try {
    const torrent = wtClient.add(magnetUri, { announce: announceList(), path: downloadPath })
    // Track immediately so UI shows the transfer before metadata arrives (0-peer wait).
    trackTorrent(id, torrent, meta)
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
    gameName?: string
    f95ThreadId?: number | null
    normalizedName?: string
  }
): Promise<P2pTransferProgress> {
  const wtClient = await ensureClient()
  const id = `seed:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  const meta = {
    contentHash: opts?.contentHash,
    gameName: opts?.gameName,
    f95ThreadId: opts?.f95ThreadId,
    normalizedName: opts?.normalizedName
  }

  // Fast path: reuse cached .torrent + skipVerify (no create-torrent re-hash).
  const cached = opts?.contentHash ? await loadCachedTorrentFile(opts.contentHash) : null
  if (cached) {
    const existing = findTrackedByHash(opts?.contentHash, null)
    if (existing?.state === 'seeding') return existing
    try {
      const torrent = wtClient.add(cached, {
        announce: announceList(),
        path: dirname(filePath),
        skipVerify: true
      } as object)
      trackTorrent(id, torrent, meta)
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
      if (!/duplicate|already exists|Cannot add/i.test(msg)) {
        console.warn('[p2p] cached torrent add failed, falling back to seed(path)', msg)
      } else {
        const tracked = findTrackedByHash(opts?.contentHash, null)
        if (tracked) return tracked
      }
    }
  }

  try {
    const torrent = wtClient.seed(filePath, { announce: announceList() }, (t) => {
      trackTorrent(id, t, {
        ...meta,
        infoHash: normalizeInfoHash(t.infoHash)
      })
      const buf = t.torrentFile
      if (opts?.contentHash && buf) {
        void saveCachedTorrentFile(opts.contentHash, buf).catch((err) => {
          console.warn('[p2p] failed to cache torrent file', err)
        })
      }
    })
    // Return immediately so UI can show the transfer while create-torrent hashes.
    trackTorrent(id, torrent, meta)
    torrent.on('error', (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err)
      const cur = progressById.get(id)
      if (cur) {
        progressById.set(id, { ...cur, state: 'error', error: msg })
        emit()
      }
    })
    return progressById.get(id)!
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
        numPeers: live ? countUniqueRemotePeerIps(live) : 0
      }
    }
    if (cur?.state === 'error') {
      throw new Error(cur.error || 'P2P seed failed')
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('Timed out waiting for torrent infoHash (create-torrent still hashing?)')
}



export async function p2pPause(id: string): Promise<P2pTransferProgress | null> {
  const torrent = torrentById.get(id)
  const cur = progressById.get(id)
  if (!cur) return null
  pausedIds.add(id)
  try {
    torrent?.pause?.()
    if (torrent) disconnectTorrentPeers(torrent)
  } catch (error) {
    console.warn('[p2p] pause failed', error)
  }
  const next = { ...cur, state: 'paused' as const, downloadSpeed: 0, uploadSpeed: 0, numPeers: 0 }
  progressById.set(id, next)
  emit()
  return next
}

export async function p2pResume(id: string): Promise<P2pTransferProgress | null> {
  const torrent = torrentById.get(id)
  const cur = progressById.get(id)
  if (!cur) return null
  pausedIds.delete(id)
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
      : 'downloading'
  const next = { ...cur, state }
  progressById.set(id, next)
  emit()
  return next
}


/** Pause any live torrent holding this archive so Windows can open/extract it. */
export async function pauseTorrentsForArchive(
  archivePath: string,
  contentHash?: string | null
): Promise<void> {
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
  for (const id of ids) {
    await p2pPause(id)
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



/** Tell trackers we left the swarm (event=stopped) so opentracker drops us now, not in ~45m. */
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
  const filePath = entry?.path
  const contentHash = entry?.contentHash
  if (contentHash) finalizedContentHashes.delete(contentHash.toLowerCase())

  if (!wt) {
    progressById.delete(idOrInfoHash)
    torrentById.delete(idOrInfoHash)
    trackedListenerIds.delete(idOrInfoHash)
    pausedIds.delete(idOrInfoHash)
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
  await announceStopped(live)
  await new Promise<void>((resolve) => {
    wt.remove(torrentId, { destroyStore: deleteFiles }, () => resolve())
  })
  progressById.delete(idOrInfoHash)
  torrentById.delete(idOrInfoHash)
  trackedListenerIds.delete(idOrInfoHash)
  pausedIds.delete(idOrInfoHash)
  quarantineIds.delete(idOrInfoHash)
  quarantineMetaById.delete(idOrInfoHash)
  for (const [key, value] of [...progressById.entries()]) {
    if (value.infoHash === torrentId || (contentHash && value.contentHash?.toLowerCase() === contentHash.toLowerCase())) {
      progressById.delete(key)
      torrentById.delete(key)
      trackedListenerIds.delete(key)
      pausedIds.delete(key)
      quarantineIds.delete(key)
      quarantineMetaById.delete(key)
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
  if (!client) return
  const wt = client
  // Announce stopped for every live torrent before tearing the client down.
  const torrents = [...torrentById.values()]
  for (const t of torrents) {
    await announceStopped(t)
  }
  client = null
  progressById.clear()
  trackedListenerIds.clear()
  torrentById.clear()
  finalizedContentHashes.clear()
  pausedIds.clear()
  quarantineIds.clear()
  quarantineMetaById.clear()
  emit()
  await new Promise<void>((resolve) => {
    wt.destroy(() => resolve())
  })
}

export function getWebTorrentLoadError(): string | null {
  return loadError
}
