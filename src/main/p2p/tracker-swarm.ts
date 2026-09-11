/**
 * Live swarm probe against opentracker HTTP announce (compact peers).
 * Used when opening the game P2P downloads tab — not via metadata-api scrape.
 *
 * Important: do NOT use WHATWG fetch/URL for announce queries — Node re-encodes
 * binary info_hash percent-escapes and opentracker returns 400 Invalid Request.
 */
import http from 'node:http'
import https from 'node:https'
import { getP2pEnv } from './env'
import { normalizeInfoHash } from '@shared/content-address'
import type { PackageMetadata } from '@shared/p2p'

/** Must be exactly 20 bytes (BitTorrent peer_id). */
const OBSERVER_PEER_ID = '-GMCLI1-tabProbe0001'
const OBSERVER_PORT = 9
const TIMEOUT_MS = 2500
const POOL = 6

function announceParts(): { protocol: 'http:' | 'https:'; hostname: string; port: number; pathPrefix: string } | null {
  const url = getP2pEnv().trackerAnnounceUrl?.trim()
  if (!url) return null
  try {
    const u = new URL(url)
    const protocol = u.protocol === 'https:' ? 'https:' : 'http:'
    const port = u.port ? Number(u.port) : protocol === 'https:' ? 443 : 80
    let pathname = u.pathname || '/announce'
    if (!pathname.endsWith('/announce')) {
      pathname = pathname.replace(/\/$/, '') + '/announce'
    }
    return { protocol, hostname: u.hostname, port, pathPrefix: pathname }
  } catch {
    return null
  }
}

function hexToRaw(infoHash: string): Buffer | null {
  const h = normalizeInfoHash(infoHash)
  if (!h || h.length !== 40) return null
  return Buffer.from(h, 'hex')
}

function percentEncode(buf: Buffer): string {
  let out = ''
  for (const b of buf) {
    out += '%' + b.toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}

function bencodeBytes(buf: Buffer, key: string): Buffer | null {
  const prefix = Buffer.from(`${key.length}:${key}`)
  const i = buf.indexOf(prefix)
  if (i < 0) return null
  const rest = buf.subarray(i + prefix.length)
  const colon = rest.indexOf(0x3a) // ':'
  if (colon <= 0) return null
  const n = Number.parseInt(rest.subarray(0, colon).toString('ascii'), 10)
  if (!Number.isFinite(n) || n < 0 || colon + 1 + n > rest.length) return null
  return rest.subarray(colon + 1, colon + 1 + n)
}

function uniquePeerIPs(peers4: Buffer | null, peers6: Buffer | null, skipPort: number): number {
  const seen = new Set<string>()
  if (peers4) {
    for (let i = 0; i + 6 <= peers4.length; i += 6) {
      const port = (peers4[i + 4]! << 8) | peers4[i + 5]!
      if (skipPort > 0 && port === skipPort) continue
      seen.add(peers4.subarray(i, i + 4).toString('hex'))
    }
  }
  if (peers6) {
    for (let i = 0; i + 18 <= peers6.length; i += 18) {
      const port = (peers6[i + 16]! << 8) | peers6[i + 17]!
      if (skipPort > 0 && port === skipPort) continue
      seen.add(peers6.subarray(i, i + 16).toString('hex'))
    }
  }
  return seen.size
}

/** Raw HTTP(S) GET that preserves binary percent-encoding in the path/query. */
function httpGetRaw(
  parts: { protocol: 'http:' | 'https:'; hostname: string; port: number },
  pathAndQuery: string
): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const lib = parts.protocol === 'https:' ? https : http
    const req = lib.request(
      {
        protocol: parts.protocol,
        hostname: parts.hostname,
        port: parts.port,
        path: pathAndQuery,
        method: 'GET',
        timeout: TIMEOUT_MS
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)))
        res.on('end', () => {
          if ((res.statusCode ?? 0) !== 200) {
            console.warn('[p2p] tracker announce HTTP', res.statusCode, pathAndQuery.slice(0, 80))
            resolve(null)
            return
          }
          resolve(Buffer.concat(chunks))
        })
      }
    )
    req.on('error', (err) => {
      console.warn('[p2p] tracker announce error', err.message)
      resolve(null)
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.end()
  })
}

/** Unique peer IPs currently returned by tracker announce (excludes our observer). */
export async function fetchActiveSeedersFromTracker(infoHash: string): Promise<number | null> {
  const parts = announceParts()
  const raw = hexToRaw(infoHash)
  if (!parts || !raw) return null
  if (Buffer.byteLength(OBSERVER_PEER_ID, 'ascii') !== 20) {
    console.error('[p2p] OBSERVER_PEER_ID must be 20 bytes')
    return null
  }

  const q =
    `info_hash=${percentEncode(raw)}` +
    `&peer_id=${percentEncode(Buffer.from(OBSERVER_PEER_ID, 'ascii'))}` +
    `&port=${OBSERVER_PORT}` +
    `&uploaded=0&downloaded=0&left=1&compact=1&numwant=200`

  const path = `${parts.pathPrefix}?${q}`
  const body = await httpGetRaw(parts, path)
  // Always try to deregister the observer.
  void httpGetRaw(parts, `${path}&event=stopped`)

  if (!body) return null
  const v4 = bencodeBytes(body, 'peers')
  const v6 = bencodeBytes(body, 'peers6')
  // Empty compact list is a valid "0 peers" answer.
  if (!v4 && !v6) {
    // Failure dict often has 'failure reason' and no peers key.
    if (body.includes(Buffer.from('failure reason'))) {
      console.warn('[p2p] tracker announce failure', body.subarray(0, 200).toString('utf8'))
      return null
    }
    return 0
  }
  return uniquePeerIPs(v4, v6, OBSERVER_PORT)
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  async function worker(): Promise<void> {
    while (i < items.length) {
      const idx = i++
      out[idx] = await fn(items[idx]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, () => worker()))
  return out
}

/** Overlay live tracker peer counts onto discovery packages (tab enter / refresh). */
export async function enrichPackagesWithLiveSwarm(
  items: PackageMetadata[]
): Promise<PackageMetadata[]> {
  if (!items.length) return items
  const counts = await mapPool(items, POOL, async (pkg) => {
    if (!pkg.infoHash) return null
    try {
      return await fetchActiveSeedersFromTracker(pkg.infoHash)
    } catch (error) {
      console.warn('[p2p] live swarm probe failed', pkg.infoHash, error)
      return null
    }
  })
  return items.map((pkg, idx) => {
    const n = counts[idx]
    return {
      ...pkg,
      activeSeeders: n,
      seeders: n,
      leechers: null
    }
  })
}
