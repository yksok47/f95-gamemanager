/**
 * P2P types — dual-hash + split tracker/metadata.
 *
 * contentHash = SHA-256 of file bytes (content-address / matching)
 * infoHash    = WebTorrent/BT SHA-1 of torrent info (swarm key)
 *
 * Swarm announce → WebSocket tracker via TRACKER_WEBRTC_URL (WebTorrent announce list).
 * Metadata REST → METADATA_BASE_URL/api/v1 (infoHash↔game/thread, flags, unique seeder pubkeys).
 * Popularity = unique verified Ed25519 seeder pubkeys. Never send F95 credentials.
 */

import {
  CONTENT_KIND_BY_ID,
  contentKindAllowsOs,
  contentKindAllowsVersion,
  contentKindRequiresOs,
  contentKindRequiresVersion,
  OS_KIND_BY_ID,
  VERSION_NAME_MAX_LEN
} from './types'

export type PackageFlagKind = 'broken' | 'harmful'

export type PackageFlag = {
  kind: PackageFlagKind
  seederPubkey: string
  createdAt: string
  note?: string
}

export type P2pPeer = {
  peerId: string
  ip: string
  port: number
  protocol?: string
}

export type PackageFlagCounts = {
  broken: number
  harmful: number
}

/** Consensus metadata from vote aggregation (numeric wire enums). */
export type PackageConsensus = {
  os: number[]
  contentKind: number
  version: string
  versionId: number
}

export type PackageVersionWeight = {
  id: number
  name: string
  weight: number
  votes?: number
}

export type PackageInstallTags = {
  os: number[]
  contentKind: number
  version: string
}

/** Validate and normalize install tags from the approve form (strips fields the kind forbids). */
export function normalizePackageInstallTags(tags: PackageInstallTags): PackageInstallTags {
  const contentKind = Number(tags.contentKind)
  if (!Number.isFinite(contentKind) || !(contentKind in CONTENT_KIND_BY_ID)) {
    throw new Error('contentKind is required')
  }

  let os: number[] = []
  if (contentKindAllowsOs(contentKind)) {
    os = [...new Set(tags.os.map((n) => Number(n)).filter((n) => Number.isFinite(n)))].sort(
      (a, b) => a - b
    )
    if (contentKindRequiresOs(contentKind) && os.length === 0) {
      throw new Error('at least one OS is required')
    }
    for (const id of os) {
      if (!(id in OS_KIND_BY_ID)) {
        throw new Error(`invalid OS id: ${id}`)
      }
    }
  }

  let version = ''
  if (contentKindAllowsVersion(contentKind)) {
    version = String(tags.version || '')
      .trim()
      .replace(/\s+/g, ' ')
    if (contentKindRequiresVersion(contentKind) && !version) {
      throw new Error('version is required')
    }
    if (version && [...version].length > VERSION_NAME_MAX_LEN) {
      throw new Error(`version must be at most ${VERSION_NAME_MAX_LEN} characters`)
    }
  }

  return { os, contentKind, version }
}

export type PackageMetadata = {
  contentHash: string
  infoHash?: string | null
  normalizedName: string
  gameName: string
  gameVersion?: string | null
  f95ThreadId: number | null
  f95ThreadUrl: string | null
  uniqueSeederPubkeyCount: number
  /** Live swarm seeders from the WebSocket tracker scrape. */
  seeders?: number | null
  leechers?: number | null
  /** Currently-active seeders from the tracker scrape. */
  activeSeeders?: number | null
  /** Unique clients that reported an install/approve. */
  installCount?: number
  /** Per-kind unique flag report counts (preferred over boolean flags). */
  flagCounts?: PackageFlagCounts
  flags: PackageFlag[]
  peers?: P2pPeer[]
  sizeBytes?: number
  /** Server clock when the package was first registered (trustworthy upload time). */
  createdAt?: string
  updatedAt?: string
  /** Reachable seeder endpoints (LAN/Tailscale) from metadata; dial these under hairpin NAT. */
  listenAddrs?: string[]
  /** Most-voted tags for this file (from metadata API). */
  consensus?: PackageConsensus | null
  /** Thread-scoped version list (present on GET one / list responses). */
  versions?: PackageVersionWeight[]
}

export type PackageStats = {
  contentHash: string
  infoHash?: string | null
  uniqueSeederPubkeyCount: number
  seeders?: number
  leechers?: number
  completed?: number
}

export type FlagPackagePayload = {
  kind: PackageFlagKind
  seederPubkey: string
  note?: string
  signature?: string
}

export type MetadataHealth = {
  ok: boolean
  version?: string
  message?: string
}

export type TorrentMapEntry = {
  contentHash: string
  infoHash: string | null
  path: string
  normalizedName: string
  sizeBytes: number
  gameName?: string
  gameVersion?: string | null
  f95ThreadId?: number | null
  f95ThreadUrl?: string | null
  updatedAt: number
}

export type TorrentMapStore = {
  version: 1
  entries: Record<string, TorrentMapEntry>
}

export type P2pTransferState =
  | 'idle'
  | 'connecting'
  | 'checking'
  | 'downloading'
  | 'seeding'
  | 'paused'
  | 'quarantined'
  | 'error'

/** In-progress user downloads (not background seeds). */
export function isInFlightP2pState(state: P2pTransferState): boolean {
  return (
    state === 'connecting' ||
    state === 'downloading' ||
    state === 'checking' ||
    state === 'paused' ||
    state === 'quarantined' ||
    state === 'error'
  )
}

export type P2pTransferProgress = {
  id: string
  contentHash?: string
  infoHash?: string | null
  path?: string
  state: P2pTransferState
  downloaded: number
  uploaded: number
  length: number
  downloadSpeed: number
  uploadSpeed: number
  progress: number
  /** Unique remote IPs with an established wire. */
  numPeers: number
  /** Connected peers that are currently transferring data. */
  numActivePeers?: number
  error?: string
  /** Display name for global Downloads / per-game filter */
  gameName?: string
  gameVersion?: string | null
  f95ThreadId?: number | null
  f95ThreadUrl?: string | null
  normalizedName?: string
  /** Consensus tags from metadata (when known for this transfer). */
  consensus?: PackageConsensus | null
}

export type P2pIdentityPublic = {
  /** lowercase hex 64 chars — raw Ed25519 pubkey */
  seederPubkey: string
  createdAt: number
}

export type P2pDownloadOptionStub = {
  contentHash: string | null
  normalizedName: string
  label: string
  uniqueSeederPubkeyCount: number
  flags: PackageFlag[]
  stub: boolean
}

/** GET /api/v1/packages — per-thread discovery (Tracker requires f95ThreadId). */
export type PackageListSort = 'updated' | 'popularity'

export type PackageListQuery = {
  /** Required by live Tracker API — bare /packages without thread → 400 */
  f95ThreadId: number | string
  contentHash?: string
  infoHash?: string
  normalizedName?: string
  /** Substring match on gameName or normalizedName (within thread) */
  q?: string
  /** When false, omit broken|harmful flagged packages. Default true on API. */
  includeFlagged?: boolean
  sort?: PackageListSort
  limit?: number
  offset?: number
}

export type PackageListResponse = {
  items: PackageMetadata[]
  versions: PackageVersionWeight[]
  limit: number
  offset: number
  total: number
}

/**
 * Env keys (production Oracle defaults; override only via process.env):
 *   TRACKER_WEBRTC_URL=wss://130.61.67.157:6969
 *   METADATA_BASE_URL=https://130.61.67.157:6767
 */
export const P2P_ENV_KEYS = {
  METADATA_BASE_URL: 'METADATA_BASE_URL',
  TRACKER_WEBRTC_URL: 'TRACKER_WEBRTC_URL'
} as const

export const P2P_ENV_DEFAULTS = {
  METADATA_BASE_URL: 'https://130.61.67.157:6767',
  TRACKER_WEBRTC_URL: 'wss://130.61.67.157:6969'
} as const
