import { statSync } from 'fs'
import { childPath, listDirents, pathExists, toFsPath } from './win-path'

function fileSize(filePath: string): number {
  try {
    return statSync(toFsPath(filePath)).size
  } catch {
    return 0
  }
}

export function fileBytes(filePath: string): number {
  if (!filePath || !pathExists(filePath)) return 0
  try {
    const info = statSync(toFsPath(filePath))
    if (info.isFile()) return info.size
    if (info.isDirectory()) return folderBytes(filePath)
  } catch {
    return 0
  }
  return 0
}

export function folderBytes(dir: string): number {
  if (!dir || !pathExists(dir)) return 0
  let total = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop() as string
    for (const entry of listDirents(current)) {
      if (entry.name === '.' || entry.name === '..') continue
      const full = childPath(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (entry.isFile()) total += fileSize(full)
    }
  }
  return total
}
