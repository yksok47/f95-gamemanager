/**
 * HTTPS fetch for METADATA_BASE_URL that trusts the pinned private CA
 * (resources/certs/metadata-ca.crt). Plain http:// still uses global fetch.
 */

import https from 'node:https'
import { getP2pHttpsAgent } from './p2p-tls'

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {}
  if (headers instanceof Headers) {
    const out: Record<string, string> = {}
    headers.forEach((v, k) => {
      out[k] = v
    })
    return out
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers)
  }
  return { ...headers }
}

/**
 * Drop-in for fetch() used by the metadata client and tracker /stats health.
 * Pins our private CA for https:// URLs.
 */
export function metadataFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return fetch(url, init)
  }

  if (parsed.protocol === 'http:') {
    return fetch(url, init)
  }
  if (parsed.protocol !== 'https:') {
    return fetch(url, init)
  }

  const method = (init.method || 'GET').toUpperCase()
  const headers = headersToRecord(init.headers)
  const body =
    init.body === undefined || init.body === null
      ? undefined
      : typeof init.body === 'string'
        ? Buffer.from(init.body)
        : Buffer.isBuffer(init.body)
          ? init.body
          : Buffer.from(String(init.body))

  if (body && !headers['content-length'] && !headers['Content-Length']) {
    headers['content-length'] = String(body.length)
  }

  return new Promise<Response>((resolve, reject) => {
    const req = https.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        agent: getP2pHttpsAgent()
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const buf = Buffer.concat(chunks)
          const headerInit: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers)) {
            if (v === undefined) continue
            headerInit[k] = Array.isArray(v) ? v.join(', ') : v
          }
          resolve(
            new Response(buf, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage,
              headers: headerInit
            })
          )
        })
      }
    )

    const signal = init.signal
    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error('aborted'))
        reject(signal.reason ?? new Error('aborted'))
        return
      }
      const onAbort = (): void => {
        req.destroy(new Error('aborted'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
      req.on('close', () => signal.removeEventListener('abort', onAbort))
    }

    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}
