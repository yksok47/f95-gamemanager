/**
 * Thin REST client for METADATA_BASE_URL.
 * Swarm announce is NOT here — WebTorrent → TRACKER_ANNOUNCE_URL (opentracker).
 */

import type { FlagPackagePayload, MetadataHealth, PackageMetadata, PackageStats } from '@shared/p2p'
import type { ShareClaimPostBody } from './share-claim'
import { getP2pEnv } from './env'

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { metadataBaseUrl } = getP2pEnv()
  const url = joinUrl(metadataBaseUrl, path)
  const init: RequestInit = {
    method,
    headers: body
      ? { 'content-type': 'application/json', accept: 'application/json' }
      : { accept: 'application/json' }
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`metadata ${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export async function metadataHealth(): Promise<MetadataHealth> {
  try {
    return await request<MetadataHealth>('GET', '/health')
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'unreachable' }
  }
}

/** POST /packages — share-claim v1 body (only when P2P enabled; caller gates) */
export async function registerPackage(claim: ShareClaimPostBody): Promise<PackageMetadata> {
  return request<PackageMetadata>('POST', '/packages', claim)
}

export async function getPackage(contentHash: string): Promise<PackageMetadata | null> {
  try {
    return await request<PackageMetadata>('GET', `/packages/${encodeURIComponent(contentHash)}`)
  } catch {
    return null
  }
}

export async function findPackagesByName(normalizedName: string): Promise<PackageMetadata[]> {
  try {
    const q = encodeURIComponent(normalizedName)
    return await request<PackageMetadata[]>('GET', `/packages?normalizedName=${q}`)
  } catch {
    return []
  }
}

export async function getPackageStats(contentHash: string): Promise<PackageStats | null> {
  try {
    return await request<PackageStats>('GET', `/packages/${encodeURIComponent(contentHash)}/stats`)
  } catch {
    return null
  }
}

export async function flagPackage(contentHash: string, payload: FlagPackagePayload): Promise<PackageMetadata> {
  return request<PackageMetadata>('POST', `/packages/${encodeURIComponent(contentHash)}/flags`, payload)
}
