import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { TorrentMapEntry, TorrentMapStore } from '@shared/p2p'
import { getAppPaths } from '../paths'

let loaded: TorrentMapStore | null = null

function empty(): TorrentMapStore {
  return { version: 1, entries: {} }
}

function normalize(value: unknown): TorrentMapStore {
  if (!value || typeof value !== 'object') return empty()
  const raw = value as Partial<TorrentMapStore>
  const entries: Record<string, TorrentMapEntry> = {}
  if (raw.entries && typeof raw.entries === 'object') {
    for (const [key, item] of Object.entries(raw.entries)) {
      if (!item || typeof item !== 'object') continue
      const e = item as Partial<TorrentMapEntry>
      if (typeof e.contentHash !== 'string' || typeof e.path !== 'string') continue
      entries[key] = {
        contentHash: e.contentHash,
        infoHash: typeof e.infoHash === 'string' ? e.infoHash : null,
        path: e.path,
        normalizedName: typeof e.normalizedName === 'string' ? e.normalizedName : '',
        sizeBytes: typeof e.sizeBytes === 'number' ? e.sizeBytes : 0,
        gameName: typeof e.gameName === 'string' ? e.gameName : undefined,
        f95ThreadId: typeof e.f95ThreadId === 'number' ? e.f95ThreadId : null,
        f95ThreadUrl: typeof e.f95ThreadUrl === 'string' ? e.f95ThreadUrl : null,
        updatedAt: typeof e.updatedAt === 'number' ? e.updatedAt : Date.now()
      }
    }
  }
  return { version: 1, entries }
}

async function readStore(): Promise<TorrentMapStore> {
  if (loaded) return loaded
  try {
    const raw = await readFile(getAppPaths().p2pTorrentMapFile, 'utf8')
    loaded = normalize(JSON.parse(raw))
  } catch {
    loaded = empty()
  }
  return loaded
}

async function writeStore(store: TorrentMapStore): Promise<void> {
  loaded = store
  const file = getAppPaths().p2pTorrentMapFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8')
}

export async function listTorrentMapEntries(): Promise<TorrentMapEntry[]> {
  const store = await readStore()
  return Object.values(store.entries)
}

export async function getTorrentMapEntry(contentHash: string): Promise<TorrentMapEntry | null> {
  const store = await readStore()
  return store.entries[contentHash] ?? null
}

export async function upsertTorrentMapEntry(
  entry: Omit<TorrentMapEntry, 'updatedAt'> & { updatedAt?: number }
): Promise<TorrentMapEntry> {
  const store = await readStore()
  const next: TorrentMapEntry = { ...entry, updatedAt: entry.updatedAt ?? Date.now() }
  store.entries[next.contentHash] = next
  await writeStore(store)
  return next
}

export async function removeTorrentMapEntry(contentHash: string): Promise<void> {
  const store = await readStore()
  delete store.entries[contentHash]
  await writeStore(store)
}
