import { P2P_ENV_DEFAULTS } from '@shared/p2p'

function readEnv(key: keyof typeof P2P_ENV_DEFAULTS): string {
  const raw = process.env[key]
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return P2P_ENV_DEFAULTS[key]
}

/** Tracker compose URLs — exact env key names. Localhost defaults for stubs. */
export function getP2pEnv(): {
  trackerAnnounceUrl: string
  metadataBaseUrl: string
  trackerAnnounceUdpUrl: string
} {
  return {
    trackerAnnounceUrl: readEnv('TRACKER_ANNOUNCE_URL'),
    metadataBaseUrl: readEnv('METADATA_BASE_URL'),
    trackerAnnounceUdpUrl: readEnv('TRACKER_ANNOUNCE_UDP_URL')
  }
}

/** Announce list for WebTorrent (HTTP + optional UDP). */
export function getAnnounceList(): string[] {
  const { trackerAnnounceUrl, trackerAnnounceUdpUrl } = getP2pEnv()
  const list = [trackerAnnounceUrl]
  if (trackerAnnounceUdpUrl) list.push(trackerAnnounceUdpUrl)
  return list
}
