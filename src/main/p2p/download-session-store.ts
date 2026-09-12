/**
 * Persist in-flight P2P downloads (and quarantine) so pause/mid-download
 * survives app restart. Seeds live in p2p-torrent-map.json instead.
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { isInFlightP2pState, type P2pTransferState } from '@shared/p2p'
import { getAppPaths } from '../paths'

export type PersistedP2pDownload = {
  id: string
  contentHash?: string
  infoHash?: string | null
  path?: string
  savePath?: string
  filePath?: string
  state: Extract<
    P2pTransferState,
    'connecting' | 'downloading' | 'checking' | 'paused' | 'quarantined' | 'error'
  >
  downloaded: number
  uploaded: number
  length: number
  progress: number
  gameName?: string
  gameVersion?: string | null
  f95ThreadId?: number | null
  f95ThreadUrl?: string | null
  normalizedName?: string
  error?: string
  updatedAt: number
}

export type P2pDownloadSessionStore = {
  version: 1
  transfers: PersistedP2pDownload[]
}

const PERSISTABLE_STATES = new Set<P2pTransferState>([
  'connecting',
  'downloading',
  'checking',
  'paused',
  'quarantined',
  'error'
])

function empty(): P2pDownloadSessionStore {
  return { version: 1, transfers: [] }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function normalizeP2pDownloadSession(value: unknown): P2pDownloadSessionStore {
  if (!value || typeof value !== 'object') return empty()
  const raw = value as Partial<P2pDownloadSessionStore>
  const transfers: PersistedP2pDownload[] = []
  if (!Array.isArray(raw.transfers)) return empty()
  for (const item of raw.transfers) {
    if (!item || typeof item !== 'object') continue
    const e = item as Partial<PersistedP2pDownload>
    if (typeof e.id !== 'string' || !e.id) continue
    if (e.id.startsWith('seed:')) continue
    const state = typeof e.state === 'string' && PERSISTABLE_STATES.has(e.state) ? e.state : null
    if (!state || !isInFlightP2pState(state)) continue
    transfers.push({
      id: e.id,
      contentHash: asOptionalString(e.contentHash)?.toLowerCase(),
      infoHash: typeof e.infoHash === 'string' ? e.infoHash : e.infoHash === null ? null : undefined,
      path: asOptionalString(e.path),
      savePath: asOptionalString(e.savePath),
      filePath: asOptionalString(e.filePath),
      state,
      downloaded: asOptionalNumber(e.downloaded) ?? 0,
      uploaded: asOptionalNumber(e.uploaded) ?? 0,
      length: asOptionalNumber(e.length) ?? 0,
      progress: asOptionalNumber(e.progress) ?? 0,
      gameName: asOptionalString(e.gameName),
      gameVersion: typeof e.gameVersion === 'string' ? e.gameVersion : e.gameVersion === null ? null : undefined,
      f95ThreadId: asOptionalNumber(e.f95ThreadId) ?? (e.f95ThreadId === null ? null : undefined),
      f95ThreadUrl: asOptionalString(e.f95ThreadUrl) ?? (e.f95ThreadUrl === null ? null : undefined),
      normalizedName: asOptionalString(e.normalizedName),
      error: asOptionalString(e.error),
      updatedAt: asOptionalNumber(e.updatedAt) ?? Date.now()
    })
  }
  return { version: 1, transfers }
}

export async function loadP2pDownloadSession(): Promise<PersistedP2pDownload[]> {
  try {
    const raw = await readFile(getAppPaths().p2pDownloadsFile, 'utf8')
    return normalizeP2pDownloadSession(JSON.parse(raw)).transfers
  } catch {
    return []
  }
}

export async function persistP2pDownloadSession(transfers: PersistedP2pDownload[]): Promise<void> {
  const file = getAppPaths().p2pDownloadsFile
  await mkdir(dirname(file), { recursive: true })
  const store: P2pDownloadSessionStore = {
    version: 1,
    transfers: normalizeP2pDownloadSession({ version: 1, transfers }).transfers
  }
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8')
}
