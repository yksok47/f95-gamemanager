import { P2P_ENV_DEFAULTS } from '@shared/p2p'
import { getMetadataBaseUrlSync, getTrackerAnnounceUrlSync } from '../settings-store'

function readEnv(key: keyof typeof P2P_ENV_DEFAULTS): string {
  const raw = process.env[key]
  if (typeof raw === 'string' && raw.trim()) return raw.trim()
  return P2P_ENV_DEFAULTS[key]
}

/** Prefer IPv4 loopback — Electron/Node fetch to `localhost` can hit ::1 while Docker only served IPv4 historically. */
function preferLoopback(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname === 'localhost') {
      u.hostname = '127.0.0.1'
      return u.toString().replace(/\/$/, '')
    }
  } catch {
    /* keep original */
  }
  return url.replace(/\/$/, '')
}

/**
 * Tracker compose URLs.
 * Prefer Settings (user-editable) when loaded; else process.env; else localhost stubs.
 */
export function getP2pEnv(): {
  trackerAnnounceUrl: string
  metadataBaseUrl: string
  trackerAnnounceUdpUrl: string
} {
  return {
    trackerAnnounceUrl: preferLoopback(getTrackerAnnounceUrlSync() || readEnv('TRACKER_ANNOUNCE_URL')),
    metadataBaseUrl: preferLoopback(getMetadataBaseUrlSync() || readEnv('METADATA_BASE_URL')),
    trackerAnnounceUdpUrl: preferLoopback(readEnv('TRACKER_ANNOUNCE_UDP_URL'))
  }
}

/** Announce list for WebTorrent (HTTP + optional UDP). */
export function getAnnounceList(): string[] {
  const { trackerAnnounceUrl, trackerAnnounceUdpUrl } = getP2pEnv()
  const list = [trackerAnnounceUrl]
  // Skip UDP on loopback only — local Docker opentracker is often TCP-only; production UDP is fine.
  if (trackerAnnounceUdpUrl) {
    try {
      const host = new URL(trackerAnnounceUrl).hostname
      const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
      if (!loopback) list.push(trackerAnnounceUdpUrl)
    } catch {
      list.push(trackerAnnounceUdpUrl)
    }
  }
  return list
}


/** Public STUN servers for WebRTC ICE / NAT hole-punching (no user port forwards). */
export function getIceServers(): Array<{ urls: string | string[] }> {
  const fromEnv = process.env.P2P_STUN_URLS?.split(',').map((s) => s.trim()).filter(Boolean)
  const urls = fromEnv?.length
    ? fromEnv
    : [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun.cloudflare.com:3478'
      ]
  return urls.map((u) => ({ urls: u }))
}
