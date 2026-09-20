/**
 * Live swarm probe against the WebSocket tracker (scrape).
 * Used when opening the game P2P downloads tab — not via metadata-api.
 *
 * bittorrent-tracker WS scrape expects 20-byte binary info_hash strings
 * (same as announce), not 40-char hex.
 */
import { getP2pEnv } from './env'
import { normalizeInfoHash } from '@shared/content-address'
import type { PackageMetadata } from '@shared/p2p'
import { hexInfoHashToBinary, scrapeCounts, toHexInfoHash } from './tracker-swarm-parse'
import { getP2pHttpsAgent } from './p2p-tls'

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

async function loadWs(): Promise<new (url: string, opts?: object) => TrackerSocket> {
  const mod = (await import('ws')) as {
    default?: new (url: string, opts?: object) => TrackerSocket
    WebSocket?: new (url: string, opts?: object) => TrackerSocket
  }
  return mod.default ?? mod.WebSocket ?? (mod as unknown as new (url: string, opts?: object) => TrackerSocket)
}

async function scrapeTracker(infoHashes: string[]): Promise<Map<string, number> | null> {
  const url = getP2pEnv().trackerWebRtcUrl?.trim()
  if (!url || !infoHashes.length) return null

  const binaryHashes = infoHashes
    .map((hex) => hexInfoHashToBinary(hex))
    .filter((h): h is string => Boolean(h))
  if (!binaryHashes.length) return null

  const WebSocket = await loadWs()
  const socketOpts = url.startsWith('wss:') ? { agent: getP2pHttpsAgent() } : undefined

  return new Promise((resolve) => {
    let settled = false
    const finish = (counts: Map<string, number> | null) => {
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

    const socket = new WebSocket(url, socketOpts)
    const timer = setTimeout(() => {
      console.warn('[p2p] tracker scrape timeout')
      finish(null)
    }, TIMEOUT_MS)

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          action: 'scrape',
          // Tracker parse-websocket requires length === 20 binary strings.
          info_hash: binaryHashes.length === 1 ? binaryHashes[0] : binaryHashes
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
          'failure reason'?: string
        }
        if (msg['failure reason']) {
          console.warn('[p2p] tracker scrape failed', msg['failure reason'])
          finish(null)
          return
        }
        if (msg.action === 'announce' && msg.info_hash != null) {
          const hash = toHexInfoHash(msg.info_hash)
          const n = Number(msg.complete)
          finish(hash && Number.isFinite(n) ? new Map([[hash, Math.max(0, n)]]) : null)
          return
        }
        if (msg.action && msg.action !== 'scrape') return
        if (!msg.files) {
          finish(null)
          return
        }
        finish(scrapeCounts(msg.files))
      } catch (error) {
        console.warn('[p2p] tracker scrape parse', error)
        finish(null)
      }
    })
    socket.on('error', (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[p2p] tracker scrape error', message)
      finish(null)
    })
    socket.on('close', () => finish(null))
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
  let counts: Map<string, number> | null = null
  try {
    counts = await scrapeTracker(hashes)
  } catch (error) {
    console.warn('[p2p] live swarm probe failed', error)
  }
  // Failed scrape must not wipe counts to 0 (would show "0 peers seeding" while peers are up).
  if (!counts) return items

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
