/**
 * P2P types — dual-hash + split tracker/metadata.
 *
 * contentHash = SHA-256 of file bytes (content-address / matching)
 * infoHash    = WebTorrent/BT SHA-1 of torrent info (swarm key)
 *
 * Swarm announce → opentracker via TRACKER_ANNOUNCE_URL (WebTorrent announce list).
 * Metadata REST → METADATA_BASE_URL/api/v1 (infoHash↔game/thread, flags, unique seeder pubkeys).
 * Popularity = unique verified Ed25519 seeder pubkeys. Never send F95 credentials.
 */

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

export type PackageMetadata = {
  contentHash: string
  infoHash?: string | null
  normalizedName: string
  gameName: string
  gameVersion?: string | null
  f95ThreadId: number | null
  f95ThreadUrl: string | null
  uniqueSeederPubkeyCount: number
  /** Live swarm seeders from tracker scrape when the API provides it. */
  seeders?: number | null
  leechers?: number | null
  /** Unique currently-active seeders (e.g. unique peer IPs); preferred over raw scrape. */
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

export type P2pTransferState = 'idle' | 'checking' | 'downloading' | 'seeding' | 'paused' | 'quarantined' | 'error'

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
  numPeers: number
  error?: string
  /** Display name for global Downloads / per-game filter */
  gameName?: string
  f95ThreadId?: number | null
  normalizedName?: string
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
  limit: number
  offset: number
  total: number
}

/**
 * Env keys (production Oracle defaults; override in Settings → P2P or process.env):
 *   TRACKER_ANNOUNCE_URL=http://130.61.67.157:6969/announce
 *   METADATA_BASE_URL=http://130.61.67.157:6767
 *   optional TRACKER_ANNOUNCE_UDP_URL=udp://130.61.67.157:6969/announce
 *   TRACKER_WEBRTC_URL=ws://130.61.67.157:8000
 */
export const P2P_ENV_KEYS = {
  TRACKER_ANNOUNCE_URL: 'TRACKER_ANNOUNCE_URL',
  METADATA_BASE_URL: 'METADATA_BASE_URL',
  TRACKER_ANNOUNCE_UDP_URL: 'TRACKER_ANNOUNCE_UDP_URL',
  TRACKER_WEBRTC_URL: 'TRACKER_WEBRTC_URL'
} as const

export const P2P_ENV_DEFAULTS = {
  TRACKER_ANNOUNCE_URL: 'http://130.61.67.157:6969/announce',
  METADATA_BASE_URL: 'http://130.61.67.157:6767',
  TRACKER_ANNOUNCE_UDP_URL: 'udp://130.61.67.157:6969/announce',
  /** WebSocket tracker for WebRTC ICE signaling (not opentracker HTTP). */
  TRACKER_WEBRTC_URL: 'ws://130.61.67.157:8000'
} as const
