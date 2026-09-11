/**
 * Thin REST client for METADATA_BASE_URL (Tracker metadata-api).
 * Swarm announce is NOT here — WebTorrent → TRACKER_ANNOUNCE_URL (opentracker).
 *
 * Routes (locked with Tracker API.md):
 *   GET  /health
 *   POST /api/v1/packages
 *   GET  /api/v1/packages/{contentHash}
 *   GET  /api/v1/packages — per-thread browse/search (paginated)
 *       REQUIRED: f95ThreadId — bare GET → 400
 *       optional within thread: contentHash, infoHash, normalizedName, q,
 *              includeFlagged (default true), sort=updated|popularity, limit/offset
 *       response: { items, limit, offset, total }
 *   POST /api/v1/packages/{contentHash}/seeders
 *   POST /api/v1/packages/{contentHash}/flags
 * No metadata POST /announce. Popularity = uniqueSeederPubkeyCount.
 * Discovery is per-thread (f95ThreadId) — not global browse, not F95 download-link rows.
 */

import { normalizeInfoHash } from '@shared/content-address'
import type { FlagPackagePayload, MetadataHealth, PackageFlag, PackageListQuery, PackageListResponse, PackageMetadata, PackageStats } from '@shared/p2p'
import type { ShareClaimPostBody } from './share-claim'
import { getP2pEnv } from './env'

const API_PREFIX = '/api/v1'

type ApiFlags = { broken?: boolean; harmful?: boolean }

type ApiPackage = {
  contentHash: string
  infoHash?: string | null
  normalizedName: string
  gameName?: string
  f95ThreadId?: string | number | null
  f95ThreadUrl?: string | null
  flags?: ApiFlags | PackageFlag[]
  uniqueSeederPubkeyCount?: number
  sizeBytes?: number
  updatedAt?: string
  createdAt?: string
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function flagsFromApi(raw: ApiPackage['flags'], contentHash: string): PackageFlag[] {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  const out: PackageFlag[] = []
  const createdAt = new Date().toISOString()
  if (raw.broken) {
    out.push({ kind: 'broken', seederPubkey: '', createdAt, note: `contentHash=${contentHash}` })
  }
  if (raw.harmful) {
    out.push({ kind: 'harmful', seederPubkey: '', createdAt, note: `contentHash=${contentHash}` })
  }
  return out
}

function parseThreadId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toPackageMetadata(pkg: ApiPackage): PackageMetadata {
  return {
    contentHash: String(pkg.contentHash || '').toLowerCase(),
    infoHash: normalizeInfoHash(pkg.infoHash),
    normalizedName: pkg.normalizedName || '',
    gameName: pkg.gameName || pkg.normalizedName || '',
    f95ThreadId: parseThreadId(pkg.f95ThreadId),
    f95ThreadUrl: pkg.f95ThreadUrl ? String(pkg.f95ThreadUrl) : null,
    uniqueSeederPubkeyCount: Number(pkg.uniqueSeederPubkeyCount) || 0,
    flags: flagsFromApi(pkg.flags, String(pkg.contentHash || '')),
    sizeBytes: pkg.sizeBytes,
    updatedAt: pkg.updatedAt || pkg.createdAt
  }
}

function claimBodyForApi(claim: ShareClaimPostBody): Record<string, unknown> {
  return {
    contentHash: claim.contentHash,
    infoHash: normalizeInfoHash(claim.infoHash) ?? '',
    normalizedName: claim.normalizedName,
    seederPubkey: claim.seederPubkey,
    ts: claim.ts,
    signature: claim.signature,
    gameName: claim.gameName ?? '',
    f95ThreadId: claim.f95ThreadId == null || claim.f95ThreadId === '' ? '' : String(claim.f95ThreadId),
    f95ThreadUrl: claim.f95ThreadUrl ?? ''
  }
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

/** POST /api/v1/packages — share-claim v1 (only when P2P enabled; caller gates) */
export async function registerPackage(claim: ShareClaimPostBody): Promise<PackageMetadata> {
  const pkg = await request<ApiPackage>('POST', `${API_PREFIX}/packages`, claimBodyForApi(claim))
  return toPackageMetadata(pkg)
}

export async function getPackage(contentHash: string): Promise<PackageMetadata | null> {
  try {
    const pkg = await request<ApiPackage>(
      'GET',
      `${API_PREFIX}/packages/${encodeURIComponent(contentHash)}`
    )
    return toPackageMetadata(pkg)
  } catch {
    return null
  }
}

export async function findPackagesByName(
  normalizedName: string,
  f95ThreadId: number | string
): Promise<PackageMetadata[]> {
  try {
    const res = await listPackages({ f95ThreadId, normalizedName, limit: 100, offset: 0 })
    return res.items
  } catch {
    return []
  }
}

function appendQuery(params: URLSearchParams, key: string, value: unknown): void {
  if (value === undefined || value === null) return
  if (typeof value === 'string' && !value.trim()) return
  params.set(key, String(value))
}

function requireThreadId(query: PackageListQuery): string {
  const raw = query.f95ThreadId
  if (raw === undefined || raw === null || String(raw).trim() === '') {
    throw new Error('f95ThreadId is required for GET /api/v1/packages (Tracker API)')
  }
  return String(raw).trim()
}

/**
 * Per-thread browse/search of the metadata package catalog.
 * Requires f95ThreadId (live API returns 400 without it).
 */
export async function listPackages(query: PackageListQuery): Promise<PackageListResponse> {
  const f95ThreadId = requireThreadId(query)
  const params = new URLSearchParams()
  appendQuery(params, 'f95ThreadId', f95ThreadId)
  appendQuery(params, 'contentHash', query.contentHash)
  appendQuery(params, 'infoHash', normalizeInfoHash(query.infoHash) ?? undefined)
  appendQuery(params, 'normalizedName', query.normalizedName)
  appendQuery(params, 'q', query.q)
  if (query.includeFlagged !== undefined) {
    params.set('includeFlagged', query.includeFlagged ? 'true' : 'false')
  }
  appendQuery(params, 'sort', query.sort)
  appendQuery(params, 'limit', query.limit)
  appendQuery(params, 'offset', query.offset)
  const qs = params.toString()
  const path = qs ? `${API_PREFIX}/packages?${qs}` : `${API_PREFIX}/packages`
  const raw = await request<
    | PackageListResponse
    | { items?: ApiPackage[]; limit?: number; offset?: number; total?: number }
    | ApiPackage[]
  >('GET', path)
  if (Array.isArray(raw)) {
    const items = raw.map(toPackageMetadata)
    return { items, limit: items.length, offset: 0, total: items.length }
  }
  const items = Array.isArray(raw.items) ? raw.items.map(toPackageMetadata) : []
  const limit = typeof raw.limit === 'number' ? raw.limit : query.limit ?? items.length
  const offset = typeof raw.offset === 'number' ? raw.offset : query.offset ?? 0
  const total = typeof raw.total === 'number' ? raw.total : items.length
  return { items, limit, offset, total }
}

/** Stats endpoint is not on metadata-api v1 yet — derive from package row when present. */
export async function getPackageStats(contentHash: string): Promise<PackageStats | null> {
  const pkg = await getPackage(contentHash)
  if (!pkg) return null
  return {
    contentHash: pkg.contentHash,
    infoHash: pkg.infoHash,
    uniqueSeederPubkeyCount: pkg.uniqueSeederPubkeyCount
  }
}

export async function flagPackage(contentHash: string, payload: FlagPackagePayload): Promise<PackageMetadata> {
  const body = {
    seederPubkey: payload.seederPubkey,
    flags: [payload.kind],
    note: payload.note ?? ''
  }
  const pkg = await request<ApiPackage>(
    'POST',
    `${API_PREFIX}/packages/${encodeURIComponent(contentHash)}/flags`,
    body
  )
  return toPackageMetadata(pkg)
}