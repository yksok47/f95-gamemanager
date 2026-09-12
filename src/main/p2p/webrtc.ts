type WrtcImplementation = Record<string, unknown>

export type WebRtcStatus = {
  ok: boolean
  message: string
}

let installation: Promise<WebRtcStatus> | null = null

/**
 * WebTorrent reads globalThis.WRTC while its module is evaluated. Set the
 * Node-native implementation first so its WebSocket tracker creates direct
 * WebRTC data channels instead of silently falling back to TCP peers.
 */
export function installNativeWebRtc(): Promise<WebRtcStatus> {
  if (installation) return installation
  installation = (async () => {
    try {
      const module = await import('webrtc-polyfill')
      const candidate = (module as unknown as { default?: unknown }).default ?? module
      const wrtc = candidate as WrtcImplementation
      if (typeof wrtc.RTCPeerConnection !== 'function') {
        throw new Error('webrtc-polyfill did not provide RTCPeerConnection')
      }
      ;(globalThis as typeof globalThis & { WRTC?: WrtcImplementation }).WRTC = wrtc
      return { ok: true, message: 'native node-datachannel' }
    } catch (error) {
      installation = null
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })()
  return installation
}
