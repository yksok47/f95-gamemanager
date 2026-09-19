import { P2P_ENV_DEFAULTS } from '@shared/p2p'
import { getMetadataBaseUrlSync, getTrackerWebRtcUrlSync } from '../settings-store'

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

function isWsTracker(url: string): boolean {
  return url.startsWith('ws://') || url.startsWith('wss://')
}

/**
 * Tracker / metadata URLs.
 * Hardcoded in P2P_ENV_DEFAULTS (override only via process.env).
 */
export function getP2pEnv(): {
  metadataBaseUrl: string
  trackerWebRtcUrl: string
} {
  const webrtc = preferLoopback(getTrackerWebRtcUrlSync() || readEnv('TRACKER_WEBRTC_URL'))
  return {
    metadataBaseUrl: preferLoopback(getMetadataBaseUrlSync() || readEnv('METADATA_BASE_URL')),
    trackerWebRtcUrl: isWsTracker(webrtc) ? webrtc : ''
  }
}

/** Announce list for WebTorrent (WebSocket only). */
export function getAnnounceList(): string[] {
  const { trackerWebRtcUrl } = getP2pEnv()
  return trackerWebRtcUrl ? [trackerWebRtcUrl] : []
}

/** HTTP /stats on the same host as the WebSocket tracker (upgrade + health). */
export function getTrackerStatsUrl(): string {
  const ws = getP2pEnv().trackerWebRtcUrl
  if (!ws) return ''
  try {
    const u = new URL(ws)
    u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:'
    u.pathname = '/stats'
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return ''
  }
}

export type IceServer = {
  urls: string | string[]
}

/** STUN discovers public candidate addresses; payloads stay on the direct WebRTC channel. */
export function getStunServers(): IceServer[] {
  const fromEnv = process.env.P2P_STUN_URLS?.split(',').map((s) => s.trim()).filter(Boolean)
  const stunUrls = fromEnv?.length
    ? fromEnv
    : [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun.cloudflare.com:3478'
      ]
  return stunUrls.map((urls) => ({ urls }))
}
