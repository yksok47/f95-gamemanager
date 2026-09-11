/**
 * Register ESM compat hooks before dynamic import("webtorrent").
 * App-owned shim - does not permanently patch node_modules.
 * Idempotent; safe to call every ensureClient().
 */

import { existsSync } from 'node:fs'
import { register } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

let registered = false
let registerError: string | null = null

function candidateLoaderPaths(): string[] {
  // electron-vite main bundle lands in out/main; shims copied beside it.
  // Dev/source fallbacks keep register working before a fresh build.
  return [
    path.join(__dirname, 'shims', 'webtorrent-compat-loader.mjs'),
    path.join(__dirname, '..', '..', 'src', 'main', 'p2p', 'shims', 'webtorrent-compat-loader.mjs'),
    path.join(process.cwd(), 'src', 'main', 'p2p', 'shims', 'webtorrent-compat-loader.mjs')
  ]
}

export function getWebtorrentCompatRegisterError(): string | null {
  return registerError
}

export function registerWebtorrentCompat(): void {
  if (registered) return
  registered = true
  try {
    const loaderPath = candidateLoaderPaths().find((p) => existsSync(p))
    if (!loaderPath) {
      registerError = 'webtorrent compat loader not found (expected src/main/p2p/shims or out/main/shims)'
      console.warn("[p2p/webtorrent-compat]", registerError)
      return
    }
    const parentURL = pathToFileURL(__filename).href
    register(pathToFileURL(loaderPath).href, parentURL)
    console.info('[p2p/webtorrent-compat] registered JS-fallback loader', loaderPath)
  } catch (error) {
    registerError = error instanceof Error ? error.message : String(error)
    console.warn('[p2p/webtorrent-compat] register failed', registerError)
  }
}
