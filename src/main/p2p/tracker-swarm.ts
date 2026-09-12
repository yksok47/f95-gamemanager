/**
 * Live swarm probe against the WebSocket tracker (scrape).
 * Used when opening the game P2P downloads tab — not via metadata-api.
 */
import { getP2pEnv } from './env'
import { normalizeInfoHash } from '@shared/content-address'
import type { PackageMetadata } from '@shared/p2p'

const TIMEOUT_MS = 2500

type TrackerSocket = {
  send: (data: string) => void
  close: () => void
  on: (event: string, cb: (...args: unknown[]) => void) => void
}

type ScrapeFile = {
  complete?: number
  incomplete?: number
}

function toHexInfoHash(key: unknown): string | null {
  if (typeof key === 'string') {
    const hex = normalizeInfoHash(key)
    if (hex) return hex
    if (key.length === 20) return Buffer.from(key, 'latin1').toString('hex')
    return null
  }
  if (Buffer.isBuffer(key) || key instanceof Uint8Array) {
    return Buffer.from(key).toString('hex')
  }
  return null
}

function scrapeCounts(files: Record<string, ScrapeFile> | undefined): Map<string, number> {
  const out = new Map<string, number>()
  if (!files) return out
  for (const [key, file] of Object.entries(files)) {
    const hash = toHexInfoHash(key)
    if (!hash) continue
    const n = Number(file?.complete)
    out.set(hash, Number.isFinite(n) ? Math.max(0, n) : 0)
  }
  return out
}

async function loadWs(): Promise<new (url: string) => TrackerSocket> {
  const mod = (await import('ws')) as {
    default?: new (url: string) => TrackerSocket
    WebSocket?: new (url: string) => TrackerSocket
  }
  return mod.default ?? mod.WebSocket ?? (mod as unknown as new (url: string) => TrackerSocket)
}

async function scrapeTracker(infoHashes: string[]): Promise<Map<string, number>> {
  const url = getP2pEnv().trackerWebRtcUrl?.trim()
  if (!url || !infoHashes.length) return new Map()

  const WebSocket = await loadWs()

  return new Promise((resolve) => {
    let settled = false
    const finish = (counts: Map<string, number>) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        /* ignore */
      }
      resolve(counts)
    }

    const socket = new WebSocket(url)
    const timer = setTimeout(() => {
      console.warn('[p2p] tracker scrape timeout')
      finish(new Map())
    }, TIMEOUT_MS)

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          action: 'scrape',
          info_hash: infoHashes.length === 1 ? infoHashes[0] : infoHashes
        })
      )
    })
    socket.on('message', (raw: unknown) => {
      try {
        const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw)
        const msg = JSON.parse(text) as {
          action?: string
          files?: Record<string, ScrapeFile>
          complete?: number
          info_hash?: unknown
        }
        if (msg.action === 'announce' && msg.info_hash != null) {
          const hash = toHexInfoHash(msg.info_hash)
          const n = Number(msg.complete)
          finish(hash && Number.isFinite(n) ? new Map([[hash, Math.max(0, n)]]) : new Map())
          return
        }
        if (msg.action && msg.action !== 'scrape') return
        finish(scrapeCounts(msg.files))
      } catch (error) {
        console.warn('[p2p] tracker scrape parse', error)
        finish(new Map())
      }
    })
    socket.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[p2p] tracker scrape error', message)
      finish(new Map())
    })
    socket.on('close', () => finish(new Map()))
  })
}

/** Overlay live tracker peer counts onto discovery packages (tab enter / refresh). */
export async function enrichPackagesWithLiveSwarm(
  items: PackageMetadata[]
): Promise<PackageMetadata[]> {
  if (!items.length) return items
  const hashes = [
    ...new Set(
      items
        .map((pkg) => normalizeInfoHash(pkg.infoHash))
        .filter((hash): hash is string => Boolean(hash))
    )
  ]
  let counts = new Map<string, number>()
  try {
    counts = await scrapeTracker(hashes)
  } catch (error) {
    console.warn('[p2p] live swarm probe failed', error)
  }
  return items.map((pkg) => {
    const hash = normalizeInfoHash(pkg.infoHash)
    const n = hash ? (counts.get(hash) ?? 0) : 0
    return {
      ...pkg,
      activeSeeders: n,
      seeders: n,
      leechers: null
    }
  })
}
