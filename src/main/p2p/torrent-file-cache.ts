/**
 * Persist WebTorrent .torrent buffers so reseeds skip create-torrent hashing.
 * Keyed by contentHash (library SHA-256 of the package bytes).
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join } from 'path'
import { getAppPaths } from '../paths'

function torrentPath(contentHash: string): string {
  const hash = contentHash.trim().toLowerCase()
  return join(getAppPaths().p2pTorrentsDir, `${hash}.torrent`)
}

export async function loadCachedTorrentFile(contentHash: string): Promise<Buffer | null> {
  const hash = contentHash.trim().toLowerCase()
  if (!hash) return null
  try {
    return await readFile(torrentPath(hash))
  } catch {
    return null
  }
}

export async function saveCachedTorrentFile(contentHash: string, torrentFile: Buffer | Uint8Array): Promise<void> {
  const hash = contentHash.trim().toLowerCase()
  if (!hash || !torrentFile?.length) return
  const dir = getAppPaths().p2pTorrentsDir
  await mkdir(dir, { recursive: true })
  await writeFile(torrentPath(hash), Buffer.from(torrentFile))
}
