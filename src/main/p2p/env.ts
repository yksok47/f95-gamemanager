import { P2P_ENV_DEFAULTS } from '@shared/p2p'
import {
  getMetadataBaseUrlSync,
  getTrackerAnnounceUrlSync,
  getTrackerWebRtcUrlSync,
  getTurnConfigSync
} from '../settings-store'

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
 * Tracker compose URLs.
 * Prefer Settings (user-editable) when loaded; else process.env; else localhost stubs.
 */
export function getP2pEnv(): {
  trackerAnnounceUrl: string
  metadataBaseUrl: string
  trackerAnnounceUdpUrl: string
  trackerWebRtcUrl: string
} {
  const webrtc = preferLoopback(getTrackerWebRtcUrlSync() || readEnv('TRACKER_WEBRTC_URL'))
  return {
    trackerAnnounceUrl: preferLoopback(getTrackerAnnounceUrlSync() || readEnv('TRACKER_ANNOUNCE_URL')),
    metadataBaseUrl: preferLoopback(getMetadataBaseUrlSync() || readEnv('METADATA_BASE_URL')),
    trackerAnnounceUdpUrl: preferLoopback(readEnv('TRACKER_ANNOUNCE_UDP_URL')),
    trackerWebRtcUrl: isWsTracker(webrtc) ? webrtc : ''
  }
}

/** Announce list for WebTorrent (HTTP + optional UDP + optional WebSocket for ICE). */
export function getAnnounceList(): string[] {
  const { trackerAnnounceUrl, trackerAnnounceUdpUrl, trackerWebRtcUrl } = getP2pEnv()
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
  if (trackerWebRtcUrl) list.push(trackerWebRtcUrl)
  return list
}

export type IceServer = {
  urls: string | string[]
  username?: string
  credential?: string
}

/** STUN for WebRTC ICE hole-punching. Optional TURN from Settings (last resort; not used for LAN). */
export function getIceServers(): IceServer[] {
  const fromEnv = process.env.P2P_STUN_URLS?.split(',').map((s) => s.trim()).filter(Boolean)
  const stunUrls = fromEnv?.length
    ? fromEnv
    : [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun.cloudflare.com:3478'
      ]
  const servers: IceServer[] = stunUrls.map((u) => ({ urls: u }))
  // Prefer local Settings; fall back to process.env. Never ship credentials in git defaults.
  const fromSettings = getTurnConfigSync()
  const turnUrls = (fromSettings.urls || process.env.P2P_TURN_URLS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const username = (fromSettings.username || process.env.P2P_TURN_USERNAME || '').trim()
  const credential = (fromSettings.credential || process.env.P2P_TURN_CREDENTIAL || '').trim()
  for (const urls of turnUrls) {
    servers.push(username ? { urls, username, credential } : { urls })
  }
  return servers
}

