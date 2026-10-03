import { readdir, readFile, rm, writeFile } from 'fs/promises'
import { isAbsolute, join, relative } from 'path'
import { yieldToEventLoop } from '../disk-usage'
import { pathIsInside } from '../processes'
import { childPath, listDirentsAsync, pathExistsAsync, stripNamespace, toFsPath } from '../win-path'
import { gameDirFromRoot, scanScriptsWithPending } from './scan'
import type { UnRenExtractMode } from '@shared/types'

export const UNREN_FILES_NAME = '.f95-unren-files.json'
const SCRIPT_REL_RE = /\.(rpy|rpyc|rpym|rpymc)$/i

export type UnRenTrackedKind = 'extract' | 'decompile'

export type UnRenTrackedFiles = {
  version: 1
  extract: string[]
  decompile: string[]
  extractLocked: boolean
  decompileLocked: boolean
  extractMode: UnRenExtractMode | null
}

export type UnRenTrackedCounts = {
  extract: number
  decompile: number
  extractLocked: boolean
  decompileLocked: boolean
  extractMode: UnRenExtractMode | null
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
  return {
    version: 1,
    extract: [],
    decompile: [],
    extractLocked: false,
    decompileLocked: false,
    extractMode: null
  }
}

export function emptyTrackedCounts(): UnRenTrackedCounts {
  return { extract: 0, decompile: 0, extractLocked: false, decompileLocked: false, extractMode: null }
}

export function isScriptRel(rel: string): boolean {
  const base = rel.split(/[/\\]/).pop() || ''
  return SCRIPT_REL_RE.test(base)
}

export function parseExtractMode(value: unknown): UnRenExtractMode | null {
  return value === 'all' || value === 'scripts' ? value : null
}

export function inferExtractMode(files: string[]): UnRenExtractMode | null {
  if (!files.length) return null
  return files.some((rel) => !isScriptRel(rel)) ? 'all' : 'scripts'
}

export function resolveExtractMode(files: UnRenTrackedFiles): UnRenExtractMode | null {
  return coalesceExtractMode(files.extractMode, files.extract)
}

export function coalesceExtractMode(
  mode: UnRenExtractMode | null,
  rels: string[]
): UnRenExtractMode | null {
  if (!rels.length) return null
  if (mode === 'all' || inferExtractMode(rels) === 'all') return 'all'
  return mode ?? inferExtractMode(rels)
}

function lockKey(kind: UnRenTrackedKind): 'extractLocked' | 'decompileLocked' {
  return kind === 'extract' ? 'extractLocked' : 'decompileLocked'
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
  const record = raw as {
    extract?: unknown
    decompile?: unknown
    extractLocked?: unknown
    decompileLocked?: unknown
    extractMode?: unknown
  }
  next.extract = normalizeRels(record.extract)
  next.decompile = normalizeRels(record.decompile)
  next.extractLocked = Boolean(record.extractLocked)
  next.decompileLocked = Boolean(record.decompileLocked)
  next.extractMode = coalesceExtractMode(parseExtractMode(record.extractMode), next.extract)
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
  return {
    extract: files.extract.length,
    decompile: files.decompile.length,
    extractLocked: files.extractLocked,
    decompileLocked: files.decompileLocked,
    extractMode: resolveExtractMode(files)
  }
}

export function retractBlockedReason(
  files: UnRenTrackedFiles,
  kind: UnRenTrackedKind,
  sources: { archiveCount: number; compiledWithRpy: number }
): string | null {
  if (kind === 'extract') {
    if (!files.extract.length) return null
    if (files.extractLocked || sources.archiveCount <= 0) {
      return 'Cannot remove extracted files after the archives have been deleted.'
    }
    return null
  }
  if (!files.decompile.length) return null
  if (files.decompileLocked || sources.compiledWithRpy <= 0) {
    return 'Cannot remove decompiled scripts after the compiled scripts have been deleted.'
  }
  return null
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
    if (raw.length > 32_000) await yieldToEventLoop()
    return parseTrackedFiles(JSON.parse(raw) as unknown)
  } catch {
    return emptyTracked()
  }
}

export async function writeTrackedFiles(gameRoot: string, files: UnRenTrackedFiles): Promise<UnRenTrackedFiles> {
  const extract = mergeTracked([], files.extract)
  const next: UnRenTrackedFiles = {
    version: 1,
    extract,
    decompile: mergeTracked([], files.decompile),
    extractLocked: Boolean(files.extractLocked),
    decompileLocked: Boolean(files.decompileLocked),
    extractMode: coalesceExtractMode(parseExtractMode(files.extractMode), extract)
  }
  if (
    !next.extract.length &&
    !next.decompile.length &&
    !next.extractLocked &&
    !next.decompileLocked
  ) {
    await rm(toFsPath(trackedFilesPath(gameRoot)), { force: true })
    return emptyTracked()
  }
  const payload = `${JSON.stringify(next)}\n`
  if (payload.length > 32_000) await yieldToEventLoop()
  await writeFile(toFsPath(trackedFilesPath(gameRoot)), payload, 'utf8')
  return next
}

export async function addTrackedFiles(
  gameRoot: string,
  kind: UnRenTrackedKind,
  added: string[]
): Promise<UnRenTrackedFiles> {
  const current = await readTrackedFiles(gameRoot)
  current[kind] = mergeTracked(current[kind], added)
  current[lockKey(kind)] = false
  return writeTrackedFiles(gameRoot, current)
}

export async function setExtractMode(
  gameRoot: string,
  mode: UnRenExtractMode
): Promise<UnRenTrackedFiles> {
  const current = await readTrackedFiles(gameRoot)
  if (current.extractMode !== 'all') current.extractMode = mode
  return writeTrackedFiles(gameRoot, current)
}

export async function setTrackedLock(
  gameRoot: string,
  kind: UnRenTrackedKind,
  locked: boolean
): Promise<UnRenTrackedFiles> {
  const current = await readTrackedFiles(gameRoot)
  current[lockKey(kind)] = locked
  return writeTrackedFiles(gameRoot, current)
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

async function deleteListedFiles(gameDir: string, paths: string[]): Promise<number> {
  let removed = 0
  let ops = 0
  for (const filePath of paths) {
    ops += 1
    if (ops >= YIELD_EVERY) {
      ops = 0
      await yieldToEventLoop()
    }
    const full = stripNamespace(filePath)
    if (!pathIsInside(gameDir, full)) continue
    if (!(await pathExistsAsync(full))) continue
    try {
      await rm(toFsPath(full), { force: true })
      removed += 1
    } catch {
      // leave it
    }
  }
  return removed
}

export async function discardSourceFiles(
  gameRoot: string,
  kind: UnRenTrackedKind
): Promise<{ removed: number; remaining: UnRenTrackedFiles }> {
  const root = stripNamespace(gameRoot)
  const gameDir = gameDirFromRoot(root)
  const scanned = await scanScriptsWithPending(root)
  const current = await readTrackedFiles(root)
  if (kind === 'extract') {
    if (!scanned.status.alreadyUnpacked && !current.extract.length) {
      throw new Error('Extract the archives before deleting them.')
    }
    if (resolveExtractMode(current) !== 'all') {
      throw new Error(
        'Archives still hold images and audio. Extract all files first, or leave the archives in place so the game can start quickly.'
      )
    }
    if (!scanned.status.rpaFiles.length && !current.extractLocked) {
      throw new Error('No archives to delete.')
    }
    const removed = await deleteListedFiles(
      gameDir,
      scanned.status.rpaFiles.map((file) => file.path)
    )
    const remaining = await setTrackedLock(root, 'extract', true)
    return { removed, remaining }
  }
  if (!scanned.compiledWithRpy.length && !current.decompile.length && !scanned.status.alreadyDecompiled) {
    throw new Error('Decompile the compiled scripts before deleting them.')
  }
  if (!scanned.compiledWithRpy.length && !current.decompileLocked) {
    throw new Error('No compiled scripts to delete.')
  }
  const removed = await deleteListedFiles(gameDir, scanned.compiledWithRpy)
  const remaining = await setTrackedLock(root, 'decompile', true)
  return { removed, remaining }
}

export async function retractTrackedFiles(
  gameRoot: string,
  kind: UnRenTrackedKind
): Promise<{ removed: number; remaining: UnRenTrackedFiles }> {
  const root = stripNamespace(gameRoot)
  const gameDir = gameDirFromRoot(root)
  const current = await readTrackedFiles(root)
  const scanned = await scanScriptsWithPending(root)
  const blocked = retractBlockedReason(current, kind, {
    archiveCount: scanned.status.rpaCount,
    compiledWithRpy: scanned.compiledWithRpy.length
  })
  if (blocked) throw new Error(blocked)
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
  const remaining = await writeTrackedFiles(root, current)
  return { removed, remaining }
}
