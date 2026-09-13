/**
 * Shared private-CA trust for P2P HTTPS (metadata) and WSS (tracker).
 * Pins resources/certs/metadata-ca.crt from p2p-tracker/certs/ca.crt.
 */

import https from 'node:https'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

let cachedCa: Buffer | undefined
let caLoaded = false
let httpsAgent: https.Agent | undefined

export function resolveP2pCaPath(): string | null {
  const candidates: string[] = []
  if (process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'certs', 'metadata-ca.crt'))
  }
  try {
    candidates.push(join(app.getAppPath(), 'resources', 'certs', 'metadata-ca.crt'))
  } catch {
    /* app not ready */
  }
  candidates.push(
    join(__dirname, '../../resources/certs/metadata-ca.crt'),
    join(process.cwd(), 'resources/certs/metadata-ca.crt')
  )
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return null
}

export function loadP2pCa(): Buffer | undefined {
  if (caLoaded) return cachedCa
  caLoaded = true
  const path = resolveP2pCaPath()
  if (!path) {
    console.warn('[p2p-tls] metadata-ca.crt not found — TLS uses system trust only')
    return undefined
  }
  try {
    cachedCa = readFileSync(path)
    console.info('[p2p-tls] trusting CA', path)
  } catch (error) {
    console.warn('[p2p-tls] failed to read CA', path, error)
  }
  return cachedCa
}

/** https.Agent that trusts the pinned private CA (also used as WSS agent). */
export function getP2pHttpsAgent(): https.Agent {
  if (!httpsAgent) {
    const ca = loadP2pCa()
    httpsAgent = new https.Agent({
      keepAlive: true,
      ...(ca ? { ca } : {})
    })
  }
  return httpsAgent
}
