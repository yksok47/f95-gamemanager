/**
 * Minimal node-datachannel stub so webrtc-polyfill ? webtorrent can import
 * without the native .node binary.
 *
 * Interim JS-fallback until Electron @electron/rebuild has VS Build Tools /
 * a working node_datachannel.node. TCP + HTTP announce (seed/magnet) does not
 * need WebRTC PeerConnection at runtime; constructing one throws clearly.
 */
class PeerConnection {
  constructor() {
    throw new Error(
      'node-datachannel stub: WebRTC unavailable (JS-fallback until native rebuild)'
    )
  }
}
class RtcpReceivingSession {}
class Video {}
class Audio {}
function cleanup() {}
function preload() {}
function initLogger() {}
function getLibraryVersion() { return 'stub-0.0.0' }
function setSctpSettings() {}

export {
  PeerConnection,
  RtcpReceivingSession,
  Video,
  Audio,
  cleanup,
  preload,
  initLogger,
  getLibraryVersion,
  setSctpSettings
}
export default {
  PeerConnection,
  RtcpReceivingSession,
  Video,
  Audio,
  cleanup,
  preload,
  initLogger,
  getLibraryVersion,
  setSctpSettings
}
