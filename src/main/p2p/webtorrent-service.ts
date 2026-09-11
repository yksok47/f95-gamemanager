/**
 * WebTorrent engine — Electron MAIN process only (Node APIs).
 * Client: webtorrent ≥2.3 (NOT webtorrent-hybrid). Magnet + seed(path).
 * Announce list uses TRACKER_ANNOUNCE_URL (opentracker HTTP+UDP).
 *
 * Loaded ONLY when P2P is enabled (dynamic import). Stub-safe if dependency missing.
 *
 * JS-fallback (interim): registerWebtorrentCompat() stubs missing node-datachannel
 * native and hardens infoHash/arr2hex so TCP+HTTP announce works without VS Build Tools.
 * infoHash exposed to metadata/UI is normalized 40-char hex; Buffer stays inside WT.
 *
 * Fallback note (not built): aria2 RPC may later help multi-GB hashing performance.
 */

import type { P2pTransferProgress } from '@shared/p2p'
import { getAnnounceList } from './env'
import { normalizeInfoHash } from '@shared/content-address'
import { registerWebtorrentCompat } from './webtorrent-compat'

type WebTorrentLike = {
  add: (uri: string, opts?: object, cb?: (torrent: TorrentLike) => void) => TorrentLike
  seed: (input: string | string[] | Buffer, opts?: object, cb?: (torrent: TorrentLike) => void) => TorrentLike
  remove: (torrentId: string, opts?: object, cb?: (err?: Error | null) => void) => void
  destroy: (cb?: (err?: Error | null) => void) => void
  torrents: TorrentLike[]
  on: (event: string, cb: (...args: unknown[]) => void) => void
}

type TorrentLike = {
  infoHash: string
  name: string
  length: number
  downloaded: number
  uploaded: number
  downloadSpeed: number
  uploadSpeed: number
  progress: number
  numPeers: number
  files: { path: string; name: string; length: number }[]
  done: boolean
  destroy: (opts?: object, cb?: (err?: Error | null) => void) => void
  on: (event: string, cb: (...args: unknown[]) => void) => void
}

let client: WebTorrentLike | null = null
let loadError: string | null = null
const progressById = new Map<string, P2pTransferProgress>()
const listeners = new Set<(items: P2pTransferProgress[]) => void>()

function emit(): void {
  const items = [...progressById.values()]
  for (const listener of listeners) listener(items)
}

function trackTorrent(id: string, torrent: TorrentLike, contentHash?: string): void {
  const update = (state: P2pTransferProgress['state'], error?: string): void => {
    progressById.set(id, {
      id,
      contentHash,
      infoHash: normalizeInfoHash(torrent.infoHash),
      path: torrent.files?.[0]?.path,
      state,
      downloaded: torrent.downloaded ?? 0,
      uploaded: torrent.uploaded ?? 0,
      length: torrent.length ?? 0,
      downloadSpeed: torrent.downloadSpeed ?? 0,
      uploadSpeed: torrent.uploadSpeed ?? 0,
      progress: torrent.progress ?? 0,
      numPeers: torrent.numPeers ?? 0,
      error
    })
    emit()
  }

  update(torrent.done ? 'seeding' : 'downloading')
  torrent.on('download', () => update(torrent.done ? 'seeding' : 'downloading'))
  torrent.on('upload', () => update(torrent.done ? 'seeding' : 'downloading'))
  torrent.on('done', () => update('seeding'))
  torrent.on('error', (err: unknown) => {
    update('error', err instanceof Error ? err.message : String(err))
  })
  torrent.on('warning', (err: unknown) => {
    console.warn('[p2p/webtorrent]', err)
  })
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
    client = new WebTorrent()
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
  opts?: { contentHash?: string; path?: string }
): Promise<P2pTransferProgress> {
  const wt = await ensureClient()
  const id = `add:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  return new Promise((resolve, reject) => {
    try {
      const torrent = wt.add(
        magnetUri,
        { announce: announceList(), path: opts?.path },
        (t) => {
          trackTorrent(id, t, opts?.contentHash)
          resolve(progressById.get(id)!)
        }
      )
      torrent.on('error', (err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    } catch (error) {
      reject(error)
    }
  })
}

export async function p2pSeedPath(
  filePath: string,
  opts?: { contentHash?: string }
): Promise<P2pTransferProgress> {
  const wt = await ensureClient()
  const id = `seed:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`
  return new Promise((resolve, reject) => {
    try {
      const torrent = wt.seed(filePath, { announce: announceList() }, (t) => {
        trackTorrent(id, t, opts?.contentHash)
        resolve(progressById.get(id)!)
      })
      torrent.on('error', (err: unknown) => {
        reject(err instanceof Error ? err : new Error(String(err)))
      })
    } catch (error) {
      reject(error)
    }
  })
}

export async function p2pRemove(idOrInfoHash: string): Promise<void> {
  const wt = client
  if (!wt) {
    progressById.delete(idOrInfoHash)
    emit()
    return
  }
  const entry = progressById.get(idOrInfoHash)
  const torrentId = entry?.infoHash || idOrInfoHash
  await new Promise<void>((resolve) => {
    wt.remove(torrentId, { destroyStore: false }, () => resolve())
  })
  progressById.delete(idOrInfoHash)
  for (const [key, value] of progressById) {
    if (value.infoHash === torrentId) progressById.delete(key)
  }
  emit()
}

export async function destroyWebTorrent(): Promise<void> {
  if (!client) return
  const wt = client
  client = null
  progressById.clear()
  emit()
  await new Promise<void>((resolve) => {
    wt.destroy(() => resolve())
  })
}

export function getWebTorrentLoadError(): string | null {
  return loadError
}
