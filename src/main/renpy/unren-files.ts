import { readdir, readFile, rm, writeFile } from 'fs/promises'
import { isAbsolute, join, relative } from 'path'
import { yieldToEventLoop } from '../disk-usage'
import { pathIsInside } from '../processes'
import { childPath, listDirentsAsync, pathExistsAsync, stripNamespace, toFsPath } from '../win-path'
import { gameDirFromRoot } from './scan'

export const UNREN_FILES_NAME = '.f95-unren-files.json'

export type UnRenTrackedKind = 'extract' | 'decompile'

export type UnRenTrackedFiles = {
  version: 1
  extract: string[]
  decompile: string[]
}

export type UnRenTrackedCounts = {
  extract: number
  decompile: number
}

const SKIP_DIRS = new Set([
  'lib',
  'renpy',
  'cache',
  '__pycache__',
  'tmp',
  'temp',
  'decompiler',
  '.f95-unren',
  '.f95-unren-old',
  '.uninstall'
])
const SKIP_FILE_RE = /\.rp[au]$/i
const YIELD_EVERY = 64

function emptyTracked(): UnRenTrackedFiles {
  return { version: 1, extract: [], decompile: [] }
}

export function trackedFilesPath(gameRoot: string): string {
  return join(stripNamespace(gameRoot), UNREN_FILES_NAME)
}

export function toPosixRel(from: string, to: string): string | null {
  const rel = relative(stripNamespace(from), stripNamespace(to))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return rel.split(/[/\\]/).join('/')
}

export function shouldTrackRel(rel: string): boolean {
  const base = rel.split('/').pop() || ''
  if (!base || base === UNREN_FILES_NAME) return false
  if (SKIP_FILE_RE.test(base)) return false
  return true
}

export function parseTrackedFiles(raw: unknown): UnRenTrackedFiles {
  const next = emptyTracked()
  if (!raw || typeof raw !== 'object') return next
  const record = raw as { extract?: unknown; decompile?: unknown }
  next.extract = normalizeRels(record.extract)
  next.decompile = normalizeRels(record.decompile)
  return next
}

export function mergeTracked(existing: string[], added: string[]): string[] {
  const set = new Set(existing)
  for (const rel of added) {
    const norm = rel.split(/[/\\]/).join('/')
    if (shouldTrackRel(norm)) set.add(norm)
  }
  return [...set].sort()
}

export function diffNewRels(before: Set<string>, after: Set<string>): string[] {
  const added: string[] = []
  for (const rel of after) {
    if (!before.has(rel) && shouldTrackRel(rel)) added.push(rel)
  }
  return added.sort()
}

export function trackedCounts(files: UnRenTrackedFiles): UnRenTrackedCounts {
  return { extract: files.extract.length, decompile: files.decompile.length }
}

function normalizeRels(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return mergeTracked(
    [],
    value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  )
}

export async function readTrackedFiles(gameRoot: string): Promise<UnRenTrackedFiles> {
  try {
    const raw = await readFile(toFsPath(trackedFilesPath(gameRoot)), 'utf8')
    return parseTrackedFiles(JSON.parse(raw) as unknown)
  } catch {
    return emptyTracked()
  }
}

export async function writeTrackedFiles(gameRoot: string, files: UnRenTrackedFiles): Promise<void> {
  const next: UnRenTrackedFiles = {
    version: 1,
    extract: mergeTracked([], files.extract),
    decompile: mergeTracked([], files.decompile)
  }
  if (!next.extract.length && !next.decompile.length) {
    await rm(toFsPath(trackedFilesPath(gameRoot)), { force: true })
    return
  }
  await writeFile(toFsPath(trackedFilesPath(gameRoot)), `${JSON.stringify(next, null, 2)}\n`, 'utf8')
}

export async function addTrackedFiles(
  gameRoot: string,
  kind: UnRenTrackedKind,
  added: string[]
): Promise<UnRenTrackedFiles> {
  const current = await readTrackedFiles(gameRoot)
  current[kind] = mergeTracked(current[kind], added)
  await writeTrackedFiles(gameRoot, current)
  return current
}

export async function snapshotGameRels(gameDir: string): Promise<Set<string>> {
  const found = new Set<string>()
  let ops = 0

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 24) return
    for (const entry of await listDirentsAsync(dir)) {
      const full = childPath(dir, entry.name)
      ops += 1
      if (ops >= YIELD_EVERY) {
        ops = 0
        await yieldToEventLoop()
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const rel = toPosixRel(gameDir, full)
      if (rel && shouldTrackRel(rel)) found.add(rel)
    }
  }

  if (await pathExistsAsync(gameDir)) await walk(stripNamespace(gameDir), 0)
  return found
}

export async function recordNewGameFiles(
  gameRoot: string,
  kind: UnRenTrackedKind,
  before: Set<string>
): Promise<string[]> {
  const after = await snapshotGameRels(gameDirFromRoot(gameRoot))
  const added = diffNewRels(before, after)
  if (added.length) await addTrackedFiles(gameRoot, kind, added)
  for (const rel of added) before.add(rel)
  return added
}

export async function getTrackedCounts(gameRoot: string): Promise<UnRenTrackedCounts> {
  return trackedCounts(await readTrackedFiles(gameRoot))
}

function parentRels(rel: string): string[] {
  const parts = rel.split('/').filter(Boolean)
  parts.pop()
  const dirs: string[] = []
  while (parts.length) {
    dirs.push(parts.join('/'))
    parts.pop()
  }
  return dirs
}

async function pruneEmptyDirs(gameDir: string, rels: string[]): Promise<void> {
  const dirs = new Set<string>()
  for (const rel of rels) {
    for (const dir of parentRels(rel)) dirs.add(dir)
  }
  const ordered = [...dirs].sort((a, b) => b.split('/').length - a.split('/').length)
  for (const rel of ordered) {
    const full = join(gameDir, ...rel.split('/'))
    if (!pathIsInside(gameDir, full)) continue
    try {
      const entries = await readdir(toFsPath(full))
      if (!entries.length) await rm(toFsPath(full), { recursive: false })
    } catch {
      // already gone or not empty
    }
  }
}

export async function retractTrackedFiles(
  gameRoot: string,
  kind: UnRenTrackedKind
): Promise<{ removed: number; remaining: UnRenTrackedFiles }> {
  const root = stripNamespace(gameRoot)
  const gameDir = gameDirFromRoot(root)
  const current = await readTrackedFiles(root)
  const rels = current[kind]
  const leftover: string[] = []
  const removedRels: string[] = []
  let removed = 0
  let ops = 0
  for (const rel of rels) {
    ops += 1
    if (ops >= YIELD_EVERY) {
      ops = 0
      await yieldToEventLoop()
    }
    const full = join(gameDir, ...rel.split('/').filter(Boolean))
    if (!pathIsInside(gameDir, full)) continue
    if (!(await pathExistsAsync(full))) continue
    try {
      await rm(toFsPath(full), { force: true })
      removed += 1
      removedRels.push(rel)
    } catch {
      leftover.push(rel)
    }
  }
  await pruneEmptyDirs(gameDir, removedRels)
  current[kind] = leftover
  await writeTrackedFiles(root, current)
  return { removed, remaining: current }
}
