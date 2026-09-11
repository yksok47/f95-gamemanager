/**
 * P2P controller — gates all network/torrent work behind settings.p2pEnabled (OFF by default).
 * When enabled: intent is seed all local packages (wired via torrent map + library paths).
 */

import { normalizePackageFilename } from '@shared/content-address'
import type {
  PackageFlagKind,
  PackageMetadata,
  P2pDownloadOptionStub,
  P2pIdentityPublic,
  P2pTransferProgress
} from '@shared/p2p'
import { getSettings } from '../settings-store'
import { hashFile } from '../hash'
import { getP2pIdentity, signShareClaim, signMessageBytes } from './identity'
import { getAnnounceList, getP2pEnv } from './env'
import {
  flagPackage,
  findPackagesByName,
  getPackage,
  getPackageStats,
  metadataHealth,
  registerPackage
} from './metadata-client'
import {
  destroyWebTorrent,
  listP2pProgress,
  onP2pProgress,
  p2pAddMagnet,
  p2pRemove,
  p2pSeedPath
} from './webtorrent-service'
import {
  getTorrentMapEntry,
  listTorrentMapEntries,
  upsertTorrentMapEntry
} from './torrent-map-store'
import { syncLocalPackagesIntoTorrentMap } from './local-packages'
import { stat } from 'fs/promises'

async function requireEnabled(): Promise<void> {
  const settings = await getSettings()
  if (!settings.p2pEnabled) {
    throw new Error('P2P is disabled. Enable torrenting in Settings to continue.')
  }
}

export async function p2pStatus(): Promise<{
  enabled: boolean
  identity: P2pIdentityPublic | null
  env: ReturnType<typeof getP2pEnv>
  announceList: string[]
  transfers: P2pTransferProgress[]
  metadata: Awaited<ReturnType<typeof metadataHealth>>
}> {
  const settings = await getSettings()
  const enabled = Boolean(settings.p2pEnabled)
  return {
    enabled,
    identity: enabled ? await getP2pIdentity() : null,
    env: getP2pEnv(),
    announceList: getAnnounceList(),
    transfers: listP2pProgress(),
    metadata: enabled ? await metadataHealth() : { ok: false, message: 'p2p disabled' }
  }
}

export async function p2pAdd(magnetOrPath: string, contentHash?: string): Promise<P2pTransferProgress> {
  await requireEnabled()
  if (magnetOrPath.startsWith('magnet:')) {
    return p2pAddMagnet(magnetOrPath, { contentHash })
  }
  return p2pSeedPath(magnetOrPath, { contentHash })
}

export async function p2pSeed(filePath: string, meta?: {
  contentHash?: string
  gameName?: string
  f95ThreadId?: number | null
  f95ThreadUrl?: string | null
}): Promise<P2pTransferProgress> {
  await requireEnabled()
  const st = await stat(filePath)
  const contentHash = meta?.contentHash ?? (await hashFile(filePath))
  const normalizedName = normalizePackageFilename(filePath)
  const progress = await p2pSeedPath(filePath, { contentHash })
  await upsertTorrentMapEntry({
    contentHash,
    infoHash: progress.infoHash ?? null,
    path: filePath,
    normalizedName,
    sizeBytes: st.size,
    gameName: meta?.gameName,
    f95ThreadId: meta?.f95ThreadId ?? null,
    f95ThreadUrl: meta?.f95ThreadUrl ?? null
  })
  // Register with metadata (soft-fail)
  try {
    const claim = await signShareClaim(
      {
        contentHash,
        infoHash: progress.infoHash,
        normalizedName
      },
      {
        gameName: meta?.gameName,
        f95ThreadId: meta?.f95ThreadId,
        f95ThreadUrl: meta?.f95ThreadUrl,
        sizeBytes: st.size
      }
    )
    await registerPackage(claim)
  } catch (error) {
    console.warn('[p2p] metadata register failed', error)
  }
  return progress
}

export async function p2pRemoveTransfer(id: string): Promise<void> {
  await requireEnabled()
  await p2pRemove(id)
}

export function subscribeP2pProgress(listener: (items: P2pTransferProgress[]) => void): () => void {
  return onP2pProgress(listener)
}

export async function p2pListProgress(): Promise<P2pTransferProgress[]> {
  return listP2pProgress()
}

/**
 * When P2P turns on: sync library/download archives into torrent map, then seed.
 * WebTorrent load is best-effort — native rebuild may be missing; errors are collected.
 */
export async function seedAllLocalPackages(): Promise<{
  started: number
  errors: string[]
  mapped: number
  skippedUnhashed: number
  candidates: number
}> {
  await requireEnabled()
  const sync = await syncLocalPackagesIntoTorrentMap()
  const entries = await listTorrentMapEntries()
  let started = 0
  const errors: string[] = []
  for (const entry of entries) {
    try {
      await p2pSeed(entry.path, {
        contentHash: entry.contentHash,
        gameName: entry.gameName,
        f95ThreadId: entry.f95ThreadId,
        f95ThreadUrl: entry.f95ThreadUrl
      })
      started += 1
    } catch (error) {
      errors.push(`${entry.contentHash}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return {
    started,
    errors,
    mapped: sync.upserted,
    skippedUnhashed: sync.skippedUnhashed,
    candidates: sync.candidates
  }
}

export async function onP2pEnabledChanged(enabled: boolean): Promise<void> {
  if (!enabled) {
    await destroyWebTorrent()
    return
  }
  await getP2pIdentity()
  // Intent: seed all local packages (best-effort)
  void seedAllLocalPackages().catch((error) => console.warn('[p2p] seedAll failed', error))
}

export async function lookupPackageMeta(contentHash: string): Promise<PackageMetadata | null> {
  return getPackage(contentHash)
}

export async function lookupPackagesByFilename(filename: string): Promise<PackageMetadata[]> {
  return findPackagesByName(normalizePackageFilename(filename))
}

export async function flagPackageAs(
  contentHash: string,
  kind: PackageFlagKind,
  note?: string
): Promise<PackageMetadata> {
  await requireEnabled()
  const identity = await getP2pIdentity()
  const ts = Math.floor(Date.now() / 1000)
  const message = [
    'f95-gm:flag:v1',
    `contentHash=${contentHash.trim().toLowerCase()}`,
    `kind=${kind}`,
    `ts=${ts}`
  ].join('\n')
  const { signature } = await signMessageBytes(message)
  return flagPackage(contentHash, {
    kind,
    seederPubkey: identity.seederPubkey,
    note,
    signature
  })
}

/** UI placeholder options — stub counts clearly marked until metadata is live */
export async function stubDownloadOptions(filename: string): Promise<P2pDownloadOptionStub[]> {
  const normalizedName = normalizePackageFilename(filename)
  const remote = await findPackagesByName(normalizedName).catch(() => [])
  if (remote.length) {
    return remote.map((pkg) => ({
      contentHash: pkg.contentHash,
      normalizedName: pkg.normalizedName,
      label: pkg.gameName || pkg.normalizedName,
      uniqueSeederPubkeyCount: pkg.uniqueSeederPubkeyCount,
      flags: pkg.flags,
      stub: false
    }))
  }
  return [
    {
      contentHash: null,
      normalizedName,
      label: `${normalizedName || filename} (P2P stub)`,
      uniqueSeederPubkeyCount: 3,
      flags: [],
      stub: true
    }
  ]
}

export async function getCachedOrHash(filePath: string): Promise<string> {
  // Prefer map lookup by path
  const entries = await listTorrentMapEntries()
  const hit = entries.find((e) => e.path === filePath)
  if (hit) return hit.contentHash
  return hashFile(filePath)
}

export { getTorrentMapEntry, getPackageStats }
