/**
 * Discover local archives for torrent-map + seed-all stubs.
 * Sources: game-files archivePath (preferred; already hashed) and downloadsDir scan.
 * Does NOT import/run webtorrent — callers decide when to seed.
 */

import { readdir, stat } from 'fs/promises'
import { join } from 'path'
import { isContentHash, normalizePackageFilename } from '@shared/content-address'
import { listGameFiles } from '../game-files-store'
import { getSettings } from '../settings-store'
import { listTorrentMapEntries, upsertTorrentMapEntry } from './torrent-map-store'

const ARCHIVE_EXT = /\.(zip|rar|7z|tar|gz|bz2|xz)$/i

export type LocalPackageCandidate = {
  path: string
  contentHash: string | null
  normalizedName: string
  sizeBytes: number
  gameName?: string
  f95ThreadId?: number | null
  f95ThreadUrl?: string | null
}

function pushUnique(
  byPath: Map<string, LocalPackageCandidate>,
  candidate: LocalPackageCandidate
): void {
  const key = candidate.path.replace(/\\/g, '/').toLowerCase()
  const prev = byPath.get(key)
  if (!prev) {
    byPath.set(key, candidate)
    return
  }
  // Prefer entry that already has a content hash
  if (!prev.contentHash && candidate.contentHash) byPath.set(key, candidate)
}

/** Collect seedable archive paths from library records + downloads folder. */
export async function discoverLocalPackageCandidates(): Promise<LocalPackageCandidate[]> {
  const byPath = new Map<string, LocalPackageCandidate>()
  const settings = await getSettings()

  try {
    const files = await listGameFiles()
    for (const file of files) {
      if (!file.archivePath) continue
      let sizeBytes = file.size || 0
      try {
        const st = await stat(file.archivePath)
        if (!st.isFile()) continue
        sizeBytes = st.size
      } catch {
        continue
      }
      const hash = typeof file.hash === 'string' && isContentHash(file.hash) ? file.hash.toLowerCase() : null
      pushUnique(byPath, {
        path: file.archivePath,
        contentHash: hash,
        normalizedName: normalizePackageFilename(file.filename || file.archivePath),
        sizeBytes,
        gameName: file.title,
        f95ThreadId: file.threadId || null,
        f95ThreadUrl: file.threadUrl || null
      })
    }
  } catch (error) {
    console.warn('[p2p] listGameFiles for local packages failed', error)
  }

  // Also scan downloadsDir for archive files not yet in game-files
  try {
    const names = await readdir(settings.downloadsDir)
    for (const name of names) {
      if (!ARCHIVE_EXT.test(name)) continue
      const full = join(settings.downloadsDir, name)
      try {
        const st = await stat(full)
        if (!st.isFile()) continue
        pushUnique(byPath, {
          path: full,
          contentHash: null,
          normalizedName: normalizePackageFilename(name),
          sizeBytes: st.size
        })
      } catch {
        // skip
      }
    }
  } catch (error) {
    console.warn('[p2p] downloadsDir scan failed', error)
  }

  // libraryDir itself holds installs, not archives — skipped on purpose
  void settings.libraryDir

  return [...byPath.values()]
}

/**
 * Upsert torrent-map rows for discovered archives that already have contentHash.
 * Unhashed downloads are returned as skipped (hashing deferred until seed/path work).
 */
export async function syncLocalPackagesIntoTorrentMap(): Promise<{
  upserted: number
  skippedUnhashed: number
  candidates: number
}> {
  const candidates = await discoverLocalPackageCandidates()
  let upserted = 0
  let skippedUnhashed = 0
  const existing = await listTorrentMapEntries()
  const byPath = new Map(existing.map((e) => [e.path.replace(/\\/g, '/').toLowerCase(), e]))

  for (const c of candidates) {
    if (!c.contentHash) {
      skippedUnhashed += 1
      continue
    }
    const prev = byPath.get(c.path.replace(/\\/g, '/').toLowerCase())
    await upsertTorrentMapEntry({
      contentHash: c.contentHash,
      infoHash: prev?.infoHash ?? null,
      path: c.path,
      normalizedName: c.normalizedName,
      sizeBytes: c.sizeBytes,
      gameName: c.gameName ?? prev?.gameName,
      f95ThreadId: c.f95ThreadId ?? prev?.f95ThreadId ?? null,
      f95ThreadUrl: c.f95ThreadUrl ?? prev?.f95ThreadUrl ?? null
    })
    upserted += 1
  }

  return { upserted, skippedUnhashed, candidates: candidates.length }
}