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

export type PackageMetadata = {
  contentHash: string
  infoHash?: string | null
  normalizedName: string
  gameName: string
  f95ThreadId: number | null
  f95ThreadUrl: string | null
  uniqueSeederPubkeyCount: number
  flags: PackageFlag[]
  peers?: P2pPeer[]
  sizeBytes?: number
  updatedAt?: string
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
  f95ThreadId?: number | null
  f95ThreadUrl?: string | null
  updatedAt: number
}

export type TorrentMapStore = {
  version: 1
  entries: Record<string, TorrentMapEntry>
}

export type P2pTransferState = 'idle' | 'checking' | 'downloading' | 'seeding' | 'paused' | 'error'

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

/**
 * Env keys locked from Tracker compose (localhost defaults for stubs):
 *   TRACKER_ANNOUNCE_URL=http://localhost:6969/announce
 *   METADATA_BASE_URL=http://localhost:8080
 *   optional udp://localhost:6969/announce
 */
export const P2P_ENV_KEYS = {
  TRACKER_ANNOUNCE_URL: 'TRACKER_ANNOUNCE_URL',
  METADATA_BASE_URL: 'METADATA_BASE_URL',
  TRACKER_ANNOUNCE_UDP_URL: 'TRACKER_ANNOUNCE_UDP_URL'
} as const

export const P2P_ENV_DEFAULTS = {
  TRACKER_ANNOUNCE_URL: 'http://localhost:6969/announce',
  METADATA_BASE_URL: 'http://localhost:8080',
  TRACKER_ANNOUNCE_UDP_URL: 'udp://localhost:6969/announce'
} as const
