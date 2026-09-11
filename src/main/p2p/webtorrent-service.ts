import { basename, dirname, join } from 'path'
/**
 * WebTorrent engine — Electron MAIN process only (Node APIs).
 * Client: webtorrent ≥2.3 (NOT webtorrent-hybrid). Magnet + seed(path).
 * Announce list uses TRACKER_ANNOUNCE_URL (opentracker HTTP+UDP).
 *
 * Loaded ONLY when P2P is enabled (dynamic import). Stub-safe if dependency missing.
 *
 * NAT: STUN iceServers configured for WebRTC hole-punching (no user port forwards).
 * JS-fallback (interim): registerWebtorrentCompat() stubs missing node-datachannel
 * native and hardens infoHash/arr2hex so TCP+HTTP announce works without VS Build Tools.
 * infoHash exposed to metadata/UI is normalized 40-char hex; Buffer stays inside WT.
 *
 * Fallback note (not built): aria2 RPC may later help multi-GB hashing performance.
 */

import type { P2pTransferProgress } from '@shared/p2p'
import { mkdir, rename, stat, unlink } from 'fs/promises'
import { addGameFileFromDownload } from '../game-files-store'
import { getDownloadsDirSync, getUntrustedDownloadsDirSync } from '../settings-store'
import { getAnnounceList, getIceServers } from './env'
import { loadCachedTorrentFile, saveCachedTorrentFile } from './torrent-file-cache'
import { upsertTorrentMapEntry } from './torrent-map-store'
import { normalizeInfoHash, normalizePackageFilename } from '@shared/content-address'
import { registerWebtorrentCompat } from './webtorrent-compat'

type WebTorrentLike = {
  add: (uri: string | Buffer | Uint8Array, opts?: object, cb?: (torrent: TorrentLike) => void) => TorrentLike
  seed: (input: string | string[] | Buffer, opts?: object, cb?: (torrent: TorrentLike) => void) => TorrentLike
  remove: (torrentId: string, opts?: object, cb?: (err?: Error | null) => void) => void
  destroy: (cb?: (err?: Error | null) => void) => void
  torrents: TorrentLike[]
  torrentPort?: number
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
  paused?: boolean
  wires?: Array<{ destroy: () => void }>
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
  addPeer?: (peer: string, source?: unknown) => boolean
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



function trackTorrent(id: string, torrent: TorrentLike, meta?: TrackMeta): void {
  hookPeerRewrite(torrent)
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
      progress: torrent.progress ?? 0,
      numPeers: torrent.numPeers ?? 0,
      error,
      gameName: meta?.gameName ?? prev?.gameName,
      f95ThreadId: meta?.f95ThreadId ?? prev?.f95ThreadId,
      normalizedName: meta?.normalizedName ?? torrent.name ?? prev?.normalizedName
    })
    emit()
  }

  if (!pausedIds.has(id)) {
    update(torrent.done ? 'seeding' : 'downloading')
  } else {
    update('paused')
  }
  if (torrent.done && id.startsWith('add:') && !pausedIds.has(id) && !quarantineIds.has(id)) {
    void enterQuarantine(id, torrent, meta)
  }
  torrentById.set(id, torrent)
  if (trackedListenerIds.has(id)) return
  trackedListenerIds.add(id)
  torrent.on('download', () => update(torrent.done ? 'seeding' : 'downloading'))
  torrent.on('upload', () => update(torrent.done ? 'seeding' : 'downloading'))
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


const peerRewriteHooked = new WeakSet<object>()

let cachedPublicIp: string | null = null
let publicIpFetch: Promise<string | null> | null = null
const PUBLIC_IP_TTL_MS = 10 * 60 * 1000
let publicIpFetchedAt = 0

function isLoopbackTracker(): boolean {
  try {
    const url = announceList()[0]
    if (!url) return false
    const host = new URL(url).hostname
    return host === '127.0.0.1' || host === 'localhost' || host === '::1'
  } catch {
    return false
  }
}

function parsePeerAddr(addr: string): { host: string; port: string } | null {
  const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(addr.trim())
  if (!m) return null
  return { host: m[1], port: m[2] }
}

function localListenPorts(): Set<number> {
  const ports = new Set<number>()
  const tp = client?.torrentPort
  if (typeof tp === 'number' && tp > 0) ports.add(tp)
  return ports
}

async function refreshPublicIp(force = false): Promise<string | null> {
  if (!force && cachedPublicIp && Date.now() - publicIpFetchedAt < PUBLIC_IP_TTL_MS) {
    return cachedPublicIp
  }
  if (publicIpFetch) return publicIpFetch
  publicIpFetch = (async () => {
    try {
      const res = await fetch('https://api.ipify.org?format=json', {
        signal: AbortSignal.timeout(5000)
      })
      if (!res.ok) return cachedPublicIp
      const data = (await res.json()) as { ip?: string }
      const ip = typeof data.ip === 'string' ? data.ip.trim() : ''
      if (ip) {
        cachedPublicIp = ip
        publicIpFetchedAt = Date.now()
        console.info('[p2p] public IP for hairpin rewrite', ip)
      }
      return cachedPublicIp
    } catch (error) {
      console.warn('[p2p] public IP lookup failed', error)
      return cachedPublicIp
    } finally {
      publicIpFetch = null
    }
  })()
  return publicIpFetch
}

/**
 * Peer address rewrite:
 * - Loopback tracker (Docker): any peer → 127.0.0.1:port (bridge IPs are unreachable from host).
 * - Production hairpin NAT: tracker returns our WAN IP for local seeders.
 *   Own listen port → 127.0.0.1 (self). Other same-WAN peers are left alone — LSD
 *   finds them on the LAN (rewriting to this NIC would still be ourselves).
 */
function rewritePeerAddress(addr: string): string {
  const parsed = parsePeerAddr(addr)
  if (!parsed) return addr
  const { host, port } = parsed
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return addr

  if (isLoopbackTracker()) {
    return `127.0.0.1:${port}`
  }

  const wan = cachedPublicIp
  if (!wan || host !== wan) return addr

  const portNum = Number(port)
  if (localListenPorts().has(portNum)) {
    return `127.0.0.1:${port}`
  }
  // Same WAN, other port: do not map onto this host's LAN IP — leave for LSD.
  return addr
}

function hookPeerRewrite(torrent: TorrentLike): void {
  if (peerRewriteHooked.has(torrent as object)) return
  if (typeof torrent.addPeer !== 'function') return
  peerRewriteHooked.add(torrent as object)
  void refreshPublicIp()
  const original = torrent.addPeer.bind(torrent)
  torrent.addPeer = (peer: string, source?: unknown): boolean => {
    const next = typeof peer === 'string' ? rewritePeerAddress(peer) : peer
    if (typeof peer === 'string' && next !== peer) {
      console.info('[p2p] rewrite tracker peer', peer, '->', next)
    }
    return original(next as string, source)
  }
}

async function ensureClient(): Promise<WebTorrentLike> {
  if (client) return client
  if (loadError) throw new Error(loadError)
  try {
    // Dynamic import — do not load webtorrent when P2P is off.
    // Register NDC stub + arr2hex hex-string compat first (JS-fallback).
    registerWebtorrentCompat()
    const mod = (await import('webtorrent')) as { default?: new () => WebTorrentLike } & (new () => WebTorrentLike)
    const WebTorrent = mod.default ?? mod
    // STUN enables ICE hole-punching so peers behind home NATs can connect
    // without opening ports. Requires real WebRTC (node-datachannel), not the JS stub.
    // Private tracker swarm: DHT off (public). LSD on for same-LAN peers under hairpin NAT.
    client = new (WebTorrent as unknown as new (opts?: object) => WebTorrentLike)({
      dht: false,
      // LSD: LAN multicast so two PCs on the same subnet find each other even when the
      // tracker only returns the shared WAN IP (hairpin NAT). DHT stays off.
      lsd: true,
      // Prefer TCP for local Docker-tracker peers; uTP to bridge IPs is flaky on Windows.
      utp: false,
      tracker: {
        rtcConfig: {
          iceServers: getIceServers()
        }
      }
    })
    client.on('error', (err: unknown) => {
      console.warn('[p2p/webtorrent] client error', err)
    })
    client.on('torrent', (torrent: unknown) => {
      hookPeerRewrite(torrent as TorrentLike)
    })
    void refreshPublicIp()
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
    if (cur?.infoHash) return cur
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
  const state = torrent?.done ? 'seeding' : 'downloading'
  const next = { ...cur, state: state as P2pTransferProgress['state'] }
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
