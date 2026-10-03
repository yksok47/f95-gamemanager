import { compareHtmlEntries, isHtmlFileName, isHtmlSkipDir, scoreHtmlEntry } from '../launch-detect'
import { childPath, listDirents, pathExists, resolveLongPath } from '../win-path'

function childRel(root: string, rel: string): string {
  return rel.split(/[/\\]/).filter(Boolean).reduce((dir, part) => childPath(dir, part), root)
}

export function findHtmlEntry(installPath: string, maxDepth = 4): string | null {
  if (!installPath || !pathExists(installPath)) return null
  const found: string[] = []

  function walk(dir: string, depth: number, rel: string): void {
    if (depth > maxDepth) return
    for (const entry of listDirents(dir)) {
      if (entry.isFile() && isHtmlFileName(entry.name)) {
        found.push(rel ? `${rel}/${entry.name}` : entry.name)
        continue
      }
      if (!entry.isDirectory() || isHtmlSkipDir(entry.name)) continue
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name
      walk(childPath(dir, entry.name), depth + 1, nextRel)
    }
  }

  walk(installPath, 0, '')
  if (!found.length) return null
  const picked = [...found].sort(compareHtmlEntries)[0]
  if (!picked || scoreHtmlEntry(picked) < 0) return null
  return resolveLongPath(childRel(installPath, picked))
}
