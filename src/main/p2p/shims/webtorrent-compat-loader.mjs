/**
 * ESM loader hook (node:module register) for WebTorrent JS-fallback:
 * 1) Resolve node-datachannel ? app-owned stub (no native .node required)
 * 2) Make uint8-util arr2hex accept already-hex infoHash strings
 *    (parse-torrent@11 + magnet paths; WT 2.8.x still calls arr2hex)
 * 3) Harden webtorrent/lib/torrent.js debug-id if older builds call
 *    arr2hex(parsedTorrent.infoHash) without infoHashBuffer.
 *
 * Prefer this over permanently patching node_modules.
 */
const STUB = new URL('./node-datachannel-stub.mjs', import.meta.url).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'node-datachannel' || specifier.startsWith('node-datachannel/')) {
    return { shortCircuit: true, url: STUB }
  }
  return nextResolve(specifier, context)
}

const ARR2HEX_NODE =
  /export const arr2hex = \(data\) => Buffer\.from\(data\.buffer, data\.byteOffset, data\.byteLength\)\.toString\('hex'\);/

const ARR2HEX_PATCH = `export const arr2hex = (data) => {
  // parse-torrent@11 / magnets may already supply hex; WebTorrent still calls arr2hex
  if (typeof data === 'string') {
    if (/^[a-f0-9]+$/i.test(data)) return data.toLowerCase()
    throw new TypeError('arr2hex: expected Uint8Array or hex string')
  }
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('hex')
};`

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context)
  if (result.format !== 'module' || typeof result.source !== 'string') return result

  const normalized = url.replace(/\\/g, '/')

  if (/webtorrent[/\\]lib[/\\]torrent\.js/.test(normalized)) {
    const patched = result.source.replaceAll(
      'arr2hex(parsedTorrent.infoHash)',
      'arr2hex(parsedTorrent.infoHashBuffer || parsedTorrent.infoHash)'
    )
    if (patched !== result.source) {
      return { ...result, source: patched, shortCircuit: true }
    }
  }

  if (/uint8-util[/\\](?:dist[/\\]src[/\\])?node\.js/.test(normalized)) {
    if (ARR2HEX_NODE.test(result.source)) {
      return {
        ...result,
        source: result.source.replace(ARR2HEX_NODE, ARR2HEX_PATCH),
        shortCircuit: true
      }
    }
  }

  return result
}
