/**
 * Register ESM compat hooks before dynamic import("webtorrent").
 * App-owned shim - does not permanently patch node_modules.
 * Idempotent; safe to call every ensureClient().
 *
 * Native node-datachannel is required for WebRTC ICE hole-punching.
 * The stub is used only when the native addon cannot load (wrong ABI /
 * missing VS Build Tools rebuild) so TCP+HTTP announce still works.
 */

import { existsSync } from 'node:fs'
import { createRequire, register } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

let registered = false
let registerError: string | null = null
let nativeStatus: { ok: boolean; message: string } | null = null

function candidateLoaderPaths(): string[] {
  // electron-vite main bundle lands in out/main; shims copied beside it.
  // Dev/source fallbacks keep register working before a fresh build.
  return [
    path.join(__dirname, 'shims', 'webtorrent-compat-loader.mjs'),
    path.join(__dirname, '..', '..', 'src', 'main', 'p2p', 'shims', 'webtorrent-compat-loader.mjs'),
    path.join(process.cwd(), 'src', 'main', 'p2p', 'shims', 'webtorrent-compat-loader.mjs')
  ]
}

function requireNodeDatachannel(): unknown {
  const bases = [
    path.join(process.cwd(), 'package.json'),
    path.join(__dirname, '../../package.json'),
    path.join(__dirname, '../../../../package.json')
  ]
  let last: unknown
  for (const base of bases) {
    try {
      return createRequire(base)('node-datachannel')
    } catch (error) {
      last = error
    }
  }
  throw last instanceof Error ? last : new Error('node-datachannel not found')
}

/** Probe native WebRTC. Safe to call before registerWebtorrentCompat(). */
export function probeNativeWebRtc(): { ok: boolean; message: string } {
  if (nativeStatus) return nativeStatus
  try {
    const ndc = requireNodeDatachannel() as { PeerConnection?: unknown }
    if (typeof ndc?.PeerConnection !== 'function') {
      nativeStatus = { ok: false, message: 'node-datachannel loaded without PeerConnection' }
      return nativeStatus
    }
    nativeStatus = { ok: true, message: 'native node-datachannel' }
    return nativeStatus
  } catch (error) {
    // N-API prebuild may exist even if createRequire path fails in some layouts.
    const candidates = [
      path.join(process.cwd(), 'node_modules/node-datachannel/build/Release/node_datachannel.node'),
      path.join(__dirname, '../../../node_modules/node-datachannel/build/Release/node_datachannel.node')
    ]
    if (candidates.some((c) => existsSync(c))) {
      nativeStatus = {
        ok: true,
        message: 'node-datachannel.node present (require path quirk; loader will use native)'
      }
      return nativeStatus
    }
    nativeStatus = {
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    }
    return nativeStatus
  }
}

export function getWebtorrentCompatRegisterError(): string | null {
  return registerError
}

export function registerWebtorrentCompat(): void {
  if (registered) return
  registered = true
  const native = probeNativeWebRtc()
  // Loader reads this: '0' = use real node-datachannel (hole punch), else stub.
  process.env.P2P_NDC_STUB = native.ok ? '0' : '1'
  console.info(
    '[p2p/webtorrent-compat] WebRTC',
    native.ok ? 'native (ICE hole-punch)' : 'stub (TCP only, no hole-punch)',
    native.message
  )
  try {
    const loaderPath = candidateLoaderPaths().find((p) => existsSync(p))
    if (!loaderPath) {
      registerError = 'webtorrent compat loader not found (expected src/main/p2p/shims or out/main/shims)'
      console.warn('[p2p/webtorrent-compat]', registerError)
      return
    }
    const parentURL = pathToFileURL(__filename).href
    register(pathToFileURL(loaderPath).href, parentURL)
    console.info('[p2p/webtorrent-compat] registered loader', loaderPath)
  } catch (error) {
    registerError = error instanceof Error ? error.message : String(error)
    console.warn('[p2p/webtorrent-compat] register failed', registerError)
  }
}
