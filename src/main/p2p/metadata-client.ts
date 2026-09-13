/**
 * Thin REST client for METADATA_BASE_URL (Tracker metadata-api).
 * Swarm announce is NOT here — WebTorrent → TRACKER_WEBRTC_URL (WebSocket tracker).
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
import type {
  FlagPackagePayload,
  MetadataHealth,
  PackageFlag,
  PackageInstallTags,
  PackageListQuery,
  PackageListResponse,
  PackageMetadata,
  PackageStats,
  PackageVersionWeight
} from '@shared/p2p'
import type { ShareClaimPostBody } from './share-claim'
import { getP2pEnv } from './env'
import { metadataFetch } from './metadata-tls-fetch'
import { appendFile } from 'fs/promises'
import { join } from 'path'
import { getAppPaths } from '../paths'
import { getMetadataApiEnabledSync } from '../settings-store'

const API_PREFIX = '/api/v1'

export class MetadataApiDisabledError extends Error {
  constructor() {
    super('Metadata API is disabled. Enable it in Settings → General.')
    this.name = 'MetadataApiDisabledError'
  }
}

export function isMetadataApiEnabled(): boolean {
  return getMetadataApiEnabledSync()
}

type ApiFlags = { broken?: boolean; harmful?: boolean }

type ApiPackage = {
  contentHash: string
  infoHash?: string | null
  normalizedName: string
  gameName?: string
  gameVersion?: string | null
  f95ThreadId?: string | number | null
  f95ThreadUrl?: string | null
  flags?: ApiFlags | PackageFlag[]
  flagCounts?: { broken?: number; harmful?: number }
  uniqueSeederPubkeyCount?: number
  seeders?: number | null
  leechers?: number | null
  activeSeeders?: number | null
  listenAddrs?: string[] | null
  installCount?: number
  completed?: number
  sizeBytes?: number
  updatedAt?: string
  createdAt?: string
  consensus?: {
    os?: number[]
    contentKind?: number
    version?: string
    versionId?: number
  } | null
  versions?: Array<{ id?: number; name?: string; weight?: number }>
}

type ApiVersionWeight = { id?: number; name?: string; weight?: number; votes?: number }

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

function flagCountsFromApi(pkg: ApiPackage, flags: PackageFlag[]): { broken: number; harmful: number } {
  const fromApi = pkg.flagCounts
  if (fromApi && typeof fromApi === 'object') {
    return {
      broken: Math.max(0, Number(fromApi.broken) || 0),
      harmful: Math.max(0, Number(fromApi.harmful) || 0)
    }
  }
  // Fall back: count array entries, or treat boolean flags as at least 1.
  let broken = flags.filter((f) => f.kind === 'broken').length
  let harmful = flags.filter((f) => f.kind === 'harmful').length
  if (!Array.isArray(pkg.flags) && pkg.flags && typeof pkg.flags === 'object') {
    if (pkg.flags.broken) broken = Math.max(broken, 1)
    if (pkg.flags.harmful) harmful = Math.max(harmful, 1)
  }
  return { broken, harmful }
}

function parseVersions(raw: unknown): PackageVersionWeight[] {
  if (!Array.isArray(raw)) return []
  const out: PackageVersionWeight[] = []
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue
    const r = row as ApiVersionWeight
    const id = Number(r.id)
    const name = String(r.name || '').trim()
    const weight = Math.max(1, Math.min(10, Math.round(Number(r.weight) || 1)))
    const votesRaw = Number(r.votes)
    const votes = Number.isFinite(votesRaw) && votesRaw >= 0 ? Math.floor(votesRaw) : undefined
    if (!Number.isFinite(id) || !name) continue
    out.push(votes == null ? { id, name, weight } : { id, name, weight, votes })
  }
  return out
}

function parseConsensus(raw: ApiPackage['consensus']): PackageMetadata['consensus'] {
  if (!raw || typeof raw !== 'object') return null
  const contentKind = Number(raw.contentKind)
  if (!Number.isFinite(contentKind)) return null
  const version = String(raw.version || '').trim()
  const versionIdRaw = Number(raw.versionId)
  const versionId = Number.isFinite(versionIdRaw) ? versionIdRaw : 0
  const os = Array.isArray(raw.os)
    ? [...new Set(raw.os.map((n) => Number(n)).filter((n) => Number.isFinite(n)))].sort((a, b) => a - b)
    : []
  return { os, contentKind, version, versionId }
}

function toPackageMetadata(pkg: ApiPackage, versions?: PackageVersionWeight[]): PackageMetadata {
  const flags = flagsFromApi(pkg.flags, String(pkg.contentHash || ''))
  const installRaw = pkg.installCount ?? pkg.completed
  const fromPkg = parseVersions(pkg.versions)
  return {
    contentHash: String(pkg.contentHash || '').toLowerCase(),
    infoHash: normalizeInfoHash(pkg.infoHash),
    normalizedName: pkg.normalizedName || '',
    gameName: pkg.gameName || pkg.normalizedName || '',
    gameVersion: pkg.gameVersion ? String(pkg.gameVersion) : null,
    f95ThreadId: parseThreadId(pkg.f95ThreadId),
    f95ThreadUrl: pkg.f95ThreadUrl ? String(pkg.f95ThreadUrl) : null,
    uniqueSeederPubkeyCount: Number(pkg.uniqueSeederPubkeyCount) || 0,
    seeders: pkg.seeders == null ? null : Number(pkg.seeders) || 0,
    leechers: pkg.leechers == null ? null : Number(pkg.leechers) || 0,
    activeSeeders: pkg.activeSeeders == null ? null : Number(pkg.activeSeeders) || 0,
    installCount: installRaw == null ? 0 : Math.max(0, Number(installRaw) || 0),
    flagCounts: flagCountsFromApi(pkg, flags),
    flags,
    sizeBytes: pkg.sizeBytes,
    createdAt: pkg.createdAt || undefined,
    updatedAt: pkg.updatedAt || pkg.createdAt,
    listenAddrs: Array.isArray(pkg.listenAddrs)
      ? pkg.listenAddrs.map((a) => String(a)).filter(Boolean).slice(0, 8)
      : undefined,
    consensus: parseConsensus(pkg.consensus),
    versions: versions ?? (fromPkg.length ? fromPkg : undefined)
  }
}

function claimBodyForApi(claim: ShareClaimPostBody): Record<string, unknown> {
  const body: Record<string, unknown> = {
    contentHash: claim.contentHash,
    infoHash: normalizeInfoHash(claim.infoHash) ?? '',
    normalizedName: claim.normalizedName,
    seederPubkey: claim.seederPubkey,
    ts: claim.ts,
    signature: claim.signature,
    gameName: claim.gameName ?? '',
    gameVersion: claim.gameVersion?.trim() ? claim.gameVersion.trim() : undefined,
    f95ThreadId: claim.f95ThreadId == null || claim.f95ThreadId === '' ? '' : String(claim.f95ThreadId),
    f95ThreadUrl: claim.f95ThreadUrl ?? '',
    sizeBytes: typeof claim.sizeBytes === 'number' && claim.sizeBytes > 0 ? claim.sizeBytes : undefined
  }
  if (Array.isArray(claim.listenAddrs)) {
    body.listenAddrs = claim.listenAddrs.map((a) => String(a)).filter(Boolean).slice(0, 8)
  }
  return body
}

const METADATA_FETCH_TIMEOUT_MS = 12_000

async function appendDiscoveryLog(line: string): Promise<void> {
  try {
    const file = join(getAppPaths().userData, 'p2p-discovery.log')
    await appendFile(file, `${new Date().toISOString()} ${line}\n`, 'utf8')
  } catch {
    /* ignore log failures */
  }
}


async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (!getMetadataApiEnabledSync()) {
    throw new MetadataApiDisabledError()
  }
  const { metadataBaseUrl } = getP2pEnv()
  const url = joinUrl(metadataBaseUrl, path)
  const init: RequestInit = {
    method,
    headers: body
      ? { 'content-type': 'application/json', accept: 'application/json' }
      : { accept: 'application/json' },
    signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS)
  }
  if (body !== undefined) init.body = JSON.stringify(body)
  let res: Response
  try {
    res = await metadataFetch(url, init)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`metadata ${method} ${url} failed: ${reason}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`metadata ${method} ${path} → ${res.status} ${text.slice(0, 200)}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export async function metadataHealth(): Promise<MetadataHealth> {
  if (!getMetadataApiEnabledSync()) {
    return { ok: false, message: 'metadata API disabled' }
  }
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
    return toPackageMetadata(pkg, parseVersions(pkg.versions))
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
  console.info('[p2p-metadata] GET', path, 'base=', getP2pEnv().metadataBaseUrl)
  void appendDiscoveryLog(`GET ${path} base=${getP2pEnv().metadataBaseUrl}`)
  const raw = await request<
    | PackageListResponse
    | { items?: ApiPackage[]; versions?: ApiVersionWeight[]; limit?: number; offset?: number; total?: number }
    | ApiPackage[]
  >('GET', path)
  if (Array.isArray(raw)) {
    const items = raw.map((p) => toPackageMetadata(p))
    return { items, versions: [], limit: items.length, offset: 0, total: items.length }
  }
  const versions = parseVersions(raw.versions)
  const items = Array.isArray(raw.items) ? raw.items.map((p) => toPackageMetadata(p, versions)) : []
  const limit = typeof raw.limit === 'number' ? raw.limit : query.limit ?? items.length
  const offset = typeof raw.offset === 'number' ? raw.offset : query.offset ?? 0
  const total = typeof raw.total === 'number' ? raw.total : items.length
  console.info('[p2p-metadata] listPackages thread=%s items=%s total=%s', f95ThreadId, items.length, total)
  void appendDiscoveryLog(`listPackages thread=${f95ThreadId} items=${items.length} total=${total}`)
  return { items, versions, limit, offset, total }
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

/** Refresh seeder row (e.g. listenAddrs) without a full package create. */
export async function upsertPackageSeeder(
  contentHash: string,
  payload: { seederPubkey: string; ts: number; signature: string; listenAddrs?: string[] }
): Promise<void> {
  const hash = contentHash.trim().toLowerCase()
  if (!hash) return
  const body: Record<string, unknown> = {
    seederPubkey: payload.seederPubkey,
    ts: payload.ts,
    signature: payload.signature
  }
  if (Array.isArray(payload.listenAddrs)) {
    body.listenAddrs = payload.listenAddrs.map((a) => String(a)).filter(Boolean).slice(0, 8)
  }
  await request('POST', `${API_PREFIX}/packages/${encodeURIComponent(hash)}/seeders`, body)
}

/** Build the exact UTF-8 install claim clients sign (with or without tags). */
export function buildInstallClaimMessage(
  contentHash: string,
  ts: number,
  tags?: PackageInstallTags | null
): string {
  const hash = contentHash.trim().toLowerCase()
  if (tags) {
    const os = [...new Set(tags.os.map((n) => Number(n)).filter((n) => Number.isFinite(n)))]
      .sort((a, b) => a - b)
      .join(',')
    const version = String(tags.version || '').trim().replace(/\s+/g, ' ')
    return [
      'f95-gm:install:v1',
      `contentHash=${hash}`,
      `os=${os}`,
      `contentKind=${Number(tags.contentKind)}`,
      `version=${version}`,
      `ts=${ts}`
    ].join('\n')
  }
  return ['f95-gm:install:v1', `contentHash=${hash}`, `ts=${ts}`].join('\n')
}

/** Best-effort install signal after Approve. Soft-fails if Tracker has no endpoint yet. */
export async function reportPackageInstall(
  contentHash: string,
  payload: {
    seederPubkey: string
    ts: number
    signature: string
    tags?: PackageInstallTags | null
  }
): Promise<void> {
  const hash = contentHash.trim().toLowerCase()
  if (!hash) return
  try {
    const body: Record<string, unknown> = {
      seederPubkey: payload.seederPubkey,
      ts: payload.ts,
      signature: payload.signature
    }
    if (payload.tags) {
      body.os = [...new Set(payload.tags.os.map((n) => Number(n)).filter((n) => Number.isFinite(n)))].sort(
        (a, b) => a - b
      )
      body.contentKind = Number(payload.tags.contentKind)
      body.version = String(payload.tags.version || '').trim().replace(/\s+/g, ' ')
    }
    await request('POST', `${API_PREFIX}/packages/${encodeURIComponent(hash)}/installs`, body)
  } catch (error) {
    console.warn('[p2p-metadata] install report failed (Tracker may not support it yet)', error)
  }
}
