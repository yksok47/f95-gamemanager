import { rm, stat } from 'fs/promises'
import { childPath, listDirents, pathExists, toFsPath } from '../win-path'

const SAVE_FILE_RE = /\.(rpgsave|rmmzsave)$/i

export function isRpgMakerSaveName(name: string): boolean {
  return SAVE_FILE_RE.test(name)
}

export function listRpgMakerSaveNames(dir: string): string[] {
  if (!pathExists(dir)) return []
  return listDirents(dir)
    .filter((entry) => entry.isFile() && isRpgMakerSaveName(entry.name))
    .map((entry) => entry.name)
}

export async function rpgMakerSaveFileBytes(dir: string | null | undefined): Promise<number> {
  if (!dir || !pathExists(dir)) return 0
  let total = 0
  for (const name of listRpgMakerSaveNames(dir)) {
    try {
      total += (await stat(toFsPath(childPath(dir, name)))).size
    } catch {
      // Skip files that disappear while we scan.
    }
  }
  return total
}

async function emptyDirectory(dir: string): Promise<void> {
  for (const entry of listDirents(dir)) {
    if (entry.name === '.' || entry.name === '..') continue
    await rm(toFsPath(childPath(dir, entry.name)), { recursive: true, force: true })
  }
}

/** Remove in-game save files and delete the managed backup folder. */
export async function wipeRpgMakerSaveDirs(
  gameSavePath: string | null | undefined,
  backupPath: string
): Promise<void> {
  if (gameSavePath && pathExists(gameSavePath)) await emptyDirectory(gameSavePath)
  if (backupPath && pathExists(backupPath)) {
    await rm(toFsPath(backupPath), { recursive: true, force: true })
  }
}
