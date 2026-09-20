import { join } from 'path'
import { listDirents, pathExists } from '../win-path'

export type DiscoveredRenpySaveFolder = {
  /** Path relative to the Ren'Py saves root, including a nested publisher folder when present. */
  name: string
  path: string
}

function isDir(entry: { isDirectory(): boolean; name: string }): boolean {
  return entry.isDirectory() && entry.name !== '.' && entry.name !== '..'
}

/** True when this folder is a Ren'Py save directory (has a file named `persistent`). */
export function isRenpySaveFolder(folderPath: string): boolean {
  return listDirents(folderPath).some(
    (entry) => entry.isFile() && entry.name.toLowerCase() === 'persistent'
  )
}

/**
 * List Ren'Py save folders under `root`.
 * Top-level directories without `persistent` are skipped, then scanned one level deeper
 * so layouts like `PTGames/Lunars Chosen Episode 2` are included.
 */
export function discoverRenpySaveFolders(root: string): DiscoveredRenpySaveFolder[] {
  if (!pathExists(root)) return []
  const found: DiscoveredRenpySaveFolder[] = []
  for (const entry of listDirents(root).filter(isDir)) {
    const folderPath = join(root, entry.name)
    if (isRenpySaveFolder(folderPath)) {
      found.push({ name: entry.name, path: folderPath })
      continue
    }
    for (const child of listDirents(folderPath).filter(isDir)) {
      const nestedPath = join(folderPath, child.name)
      if (isRenpySaveFolder(nestedPath)) {
        found.push({ name: join(entry.name, child.name), path: nestedPath })
      }
    }
  }
  return found
}
