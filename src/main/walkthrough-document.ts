import { relative } from 'path'
import { extractArchive, listArchiveEntries } from './extract'
import { isArchivePath, isWalkthroughDocumentPath } from './fs-utils'
import { unwrapArchiveEntries } from './renpy/uncensor-patch'
import { childPath, listDirents, pathExists } from './win-path'

const JUNK_NAMES = new Set(['__macosx', '.ds_store', 'thumbs.db', 'desktop.ini'])
const GUIDE_NAME = /walkthrough|walk[\s._-]?thru|\bguide\b|\bfaq\b/i
const EXT_RANK: Record<string, number> = {
  '.pdf': 0,
  '.docx': 1,
  '.doc': 2,
  '.odt': 3,
  '.rtf': 4,
  '.epub': 5,
  '.html': 6,
  '.htm': 6,
  '.md': 7,
  '.markdown': 7,
  '.txt': 8
}

function isJunkName(name: string): boolean {
  const lower = name.toLowerCase()
  return JUNK_NAMES.has(lower) || lower.startsWith('._')
}

function documentExt(filePath: string): string {
  const base = filePath.split(/[/\\]/).pop() || ''
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot).toLowerCase() : ''
}

/** True when archive contents include a viewable walkthrough document. */
export function entriesSuggestWalkthroughDocument(entries: string[]): boolean {
  return unwrapArchiveEntries(entries).some((path) => isWalkthroughDocumentPath(path))
}

/**
 * Ranked document paths to open. Prefers names like walkthrough/guide, then
 * pdf/doc over txt. Same-rank ties are all returned.
 */
export function pickWalkthroughDocumentEntries(entries: string[]): string[] {
  const docs = unwrapArchiveEntries(entries).filter((path) => isWalkthroughDocumentPath(path))
  if (!docs.length) return []
  const ranked = docs.map((path) => {
    const base = path.split('/').pop() || path
    const nameScore = GUIDE_NAME.test(base) ? 0 : 1
    const extScore = EXT_RANK[documentExt(base)] ?? 9
    const depth = path.split('/').length
    return { path, nameScore, extScore, depth }
  })
  ranked.sort(
    (a, b) =>
      a.nameScore - b.nameScore ||
      a.extScore - b.extScore ||
      a.depth - b.depth ||
      a.path.localeCompare(b.path)
  )
  const best = ranked[0]
  return ranked
    .filter((item) => item.nameScore === best.nameScore && item.extScore === best.extScore)
    .map((item) => item.path)
}

export function findWalkthroughDocuments(root: string, maxDepth = 8): string[] {
  const found: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return
    for (const entry of listDirents(dir)) {
      if (isJunkName(entry.name)) continue
      const full = childPath(dir, entry.name)
      if (entry.isFile() && isWalkthroughDocumentPath(entry.name)) {
        found.push(full)
        continue
      }
      if (!entry.isDirectory()) continue
      walk(full, depth + 1)
    }
  }

  if (pathExists(root)) walk(root, 0)
  return found.sort((a, b) => a.localeCompare(b))
}

export async function isWalkthroughDocumentOpenable(sourcePath: string): Promise<boolean> {
  if (!sourcePath || !pathExists(sourcePath)) return false
  if (isWalkthroughDocumentPath(sourcePath) && !isArchivePath(sourcePath)) return true
  if (!isArchivePath(sourcePath)) return false
  try {
    const entries = await listArchiveEntries(sourcePath)
    return entriesSuggestWalkthroughDocument(entries)
  } catch {
    return false
  }
}

/** Pick document files already extracted under dest, using the same ranking as archives. */
export function pickExtractedWalkthroughDocuments(destDir: string): string[] {
  const abs = findWalkthroughDocuments(destDir)
  if (!abs.length) return []
  const rel = abs.map((filePath) => relative(destDir, filePath).replace(/\\/g, '/'))
  const picked = new Set(pickWalkthroughDocumentEntries(rel).map((path) => path.toLowerCase()))
  return abs.filter((_, index) => picked.has(rel[index].toLowerCase()))
}

export async function extractWalkthroughDocuments(
  archivePath: string,
  destDir: string
): Promise<string[]> {
  await extractArchive(archivePath, destDir)
  return pickExtractedWalkthroughDocuments(destDir)
}
