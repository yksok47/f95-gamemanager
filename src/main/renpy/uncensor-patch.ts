import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'path'
import { extractArchive, listArchiveEntries } from '../extract'
import { isArchivePath, sanitizeSegment } from '../fs-utils'
import { childPath, listDirents, pathExists, toFsPath } from '../win-path'

const JUNK_NAMES = new Set(['__macosx', '.ds_store', 'thumbs.db', 'desktop.ini'])
const SKIP_DIRS = new Set([
  '__macosx',
  'lib',
  'renpy',
  'cache',
  '__pycache__',
  'tmp',
  'temp',
  'node_modules',
  '.uninstall'
])
const KEEP_ROOT_DIRS = new Set(['game', 'renpy', 'lib'])
const UNINSTALL_DIR = '.uninstall'
const BACKUP_SUFFIX = '.f95bak'
const MANIFEST_NAME = 'instructions.json'

export type UncensorPatchPlan =
  | { mode: 'merge-game'; sourceGameDir: string }
  | { mode: 'scripts'; files: Array<{ absolute: string; relative: string }> }

export type UncensorUninstallManifest = {
  version: 1
  patchId: string
  hash: string
  filename: string
  installedAt: number
  /** Relative paths under `/game` that the patch added (delete on uninstall). */
  remove: string[]
  /** Relative paths under `/game` that were overwritten (restore from backup/). */
  restore: string[]
}

export type UncensorPatchMeta = {
  patchId: string
  hash: string
  filename: string
}

export function isRenpyScriptPath(filePath: string): boolean {
  return /\.rpyc?$/i.test(filePath)
}

function isJunkName(name: string): boolean {
  const lower = name.toLowerCase()
  return JUNK_NAMES.has(lower) || lower.startsWith('._')
}

function normalizeEntry(entry: string): string {
  return entry.replace(/\\/g, '/').replace(/^\/+/, '')
}

/** Peel single-folder wrappers the same way extract does, for archive-entry inspection. */
export function unwrapArchiveEntries(entries: string[]): string[] {
  let paths = entries
    .map(normalizeEntry)
    .filter((entry) => {
      if (!entry || entry.endsWith('/')) return false
      const base = entry.split('/').pop() || ''
      return !isJunkName(base)
    })

  for (;;) {
    const tops = new Set(
      paths
        .map((path) => path.split('/')[0]?.toLowerCase())
        .filter((name): name is string => Boolean(name))
    )
    if (tops.size !== 1) break
    const only = [...tops][0]
    if (KEEP_ROOT_DIRS.has(only)) break
    const next = paths
      .map((path) => path.split('/').slice(1).join('/'))
      .filter(Boolean)
    if (!next.length) break
    paths = next
  }
  return paths
}

/** True when archive/file contents look like a supported Ren'Py uncensor layout. */
export function entriesSuggestUncensorInstall(entries: string[]): boolean {
  const paths = unwrapArchiveEntries(entries)
  if (!paths.length) return false
  if (paths.some((path) => path.split('/')[0]?.toLowerCase() === 'game')) return true
  return paths.some((path) => isRenpyScriptPath(path))
}

export async function isUncensorPatchInstallable(sourcePath: string): Promise<boolean> {
  if (!sourcePath || !pathExists(sourcePath)) return false
  if (isRenpyScriptPath(sourcePath) && !isArchivePath(sourcePath)) return true
  if (!isArchivePath(sourcePath)) return false
  try {
    const entries = await listArchiveEntries(sourcePath)
    return entriesSuggestUncensorInstall(entries)
  } catch {
    return false
  }
}

/** Shallowest `game` directories under root (depth-first discovery, then shortest path first). */
export function findPatchGameDirs(root: string, maxDepth = 6): string[] {
  const found: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return
    for (const entry of listDirents(dir)) {
      if (!entry.isDirectory() || isJunkName(entry.name)) continue
      const full = childPath(dir, entry.name)
      if (entry.name.toLowerCase() === 'game') {
        found.push(full)
        continue
      }
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
      walk(full, depth + 1)
    }
  }

  if (pathExists(root)) walk(root, 0)
  return found.sort((a, b) => a.length - b.length || a.localeCompare(b))
}

export function findRenpyScripts(root: string, maxDepth = 8): string[] {
  const found: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return
    for (const entry of listDirents(dir)) {
      if (isJunkName(entry.name)) continue
      const full = childPath(dir, entry.name)
      if (entry.isFile() && isRenpyScriptPath(entry.name)) {
        found.push(full)
        continue
      }
      if (!entry.isDirectory()) continue
      if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
      walk(full, depth + 1)
    }
  }

  if (pathExists(root)) walk(root, 0)
  return found.sort((a, b) => a.localeCompare(b))
}

function isInsideOrEqual(target: string, root: string): boolean {
  const resolved = resolve(target).toLowerCase()
  const base = resolve(root).toLowerCase()
  return resolved === base || resolved.startsWith(base + sep)
}

function commonDirectory(paths: string[]): string {
  if (!paths.length) return ''
  let common = dirname(paths[0])
  for (const filePath of paths.slice(1)) {
    let dir = dirname(filePath)
    while (!isInsideOrEqual(dir, common)) {
      const parent = dirname(common)
      if (parent === common) return common
      common = parent
    }
  }
  return common
}

function toGameRelative(path: string): string {
  return path.split(/[/\\]/).join(sep)
}

/** Decide how to apply an extracted (or staged) patch tree into the installed game `/game` folder. */
export function planUncensorPatch(extractedRoot: string): UncensorPatchPlan {
  const gameDirs = findPatchGameDirs(extractedRoot)
  if (gameDirs[0]) {
    return { mode: 'merge-game', sourceGameDir: gameDirs[0] }
  }

  const scripts = findRenpyScripts(extractedRoot)
  if (!scripts.length) {
    throw new Error('No .rpy/.rpyc files or game folder found in that uncensor patch.')
  }

  const root = commonDirectory(scripts)
  return {
    mode: 'scripts',
    files: scripts.map((absolute) => ({
      absolute,
      relative: relative(root, absolute).split(/[/\\]/).join(sep) || basename(absolute)
    }))
  }
}

async function collectMergeFiles(source: string, prefix = ''): Promise<Array<{ absolute: string; relative: string }>> {
  const out: Array<{ absolute: string; relative: string }> = []
  const entries = await readdir(toFsPath(source), { withFileTypes: true })
  for (const entry of entries) {
    if (isJunkName(entry.name)) continue
    if (entry.name.toLowerCase() === UNINSTALL_DIR) continue
    const from = join(source, entry.name)
    const relativePath = prefix ? join(prefix, entry.name) : entry.name
    if (entry.isDirectory()) {
      out.push(...(await collectMergeFiles(from, relativePath)))
      continue
    }
    if (!entry.isFile()) continue
    out.push({ absolute: from, relative: relativePath })
  }
  return out
}

function planFiles(plan: UncensorPatchPlan): Array<{ absolute: string; relative: string }> {
  if (plan.mode === 'scripts') return plan.files
  // merge-game collected async — caller uses collectMergeFiles
  return []
}

function uninstallSlotName(meta: UncensorPatchMeta): string {
  const fromHash = sanitizeSegment(meta.hash || '').slice(0, 24)
  if (fromHash && fromHash !== 'untitled') return fromHash
  return sanitizeSegment(meta.patchId || 'patch')
}

export function getUncensorUninstallSlot(meta: UncensorPatchMeta): string {
  return uninstallSlotName(meta)
}

function gameRelPath(relativePath: string): string {
  return relativePath.split(/[/\\]/).filter(Boolean).join(sep)
}

async function readManifest(uninstallRoot: string): Promise<UncensorUninstallManifest | null> {
  const file = join(uninstallRoot, MANIFEST_NAME)
  if (!pathExists(file)) return null
  try {
    const raw = JSON.parse(await readFile(toFsPath(file), 'utf8')) as Partial<UncensorUninstallManifest>
    return {
      version: 1,
      patchId: String(raw.patchId || ''),
      hash: String(raw.hash || ''),
      filename: String(raw.filename || ''),
      installedAt: Number(raw.installedAt) || 0,
      remove: Array.isArray(raw.remove) ? raw.remove.map(String) : [],
      restore: Array.isArray(raw.restore) ? raw.restore.map(String) : []
    }
  } catch {
    return null
  }
}

async function findUninstallRoot(
  targetGameDir: string,
  match: { patchId?: string; hash?: string; uninstallSlot?: string }
): Promise<string | null> {
  const root = join(targetGameDir, UNINSTALL_DIR)
  if (!pathExists(root)) return null

  if (match.uninstallSlot) {
    const slot = join(root, match.uninstallSlot)
    if (pathExists(join(slot, MANIFEST_NAME))) return slot
  }

  const expected = uninstallSlotName({
    patchId: match.patchId || '',
    hash: match.hash || '',
    filename: ''
  })
  const byName = join(root, expected)
  if (pathExists(join(byName, MANIFEST_NAME))) return byName

  for (const entry of listDirents(root)) {
    if (!entry.isDirectory()) continue
    const slot = childPath(root, entry.name)
    const manifest = await readManifest(slot)
    if (!manifest) continue
    if (match.hash && manifest.hash && match.hash === manifest.hash) return slot
    if (match.patchId && manifest.patchId && match.patchId === manifest.patchId) return slot
  }
  return null
}

/**
 * Reverse an applied uncensor patch using `game/.uninstall/<slot>/instructions.json`
 * and the backed-up conflicting files. Does not require the original patch archive.
 */
export async function removeUncensorPatchFromGameDir(
  targetGameDir: string,
  match: { patchId?: string; hash?: string; uninstallSlot?: string }
): Promise<UncensorUninstallManifest> {
  const uninstallRoot = await findUninstallRoot(targetGameDir, match)
  if (!uninstallRoot) {
    throw new Error('No uninstall instructions were found for that uncensor patch.')
  }
  const manifest = await readManifest(uninstallRoot)
  if (!manifest) {
    throw new Error('The uncensor uninstall instructions are missing or unreadable.')
  }

  const backupRoot = join(uninstallRoot, 'backup')

  for (const relative of manifest.restore) {
    const rel = gameRelPath(relative)
    const dest = join(targetGameDir, rel)
    const backup = join(backupRoot, `${rel}${BACKUP_SUFFIX}`)
    if (!pathExists(backup)) {
      throw new Error(`Missing backup for ${relative}; refusing to uninstall.`)
    }
    await mkdir(toFsPath(dirname(dest)), { recursive: true })
    await copyFile(toFsPath(backup), toFsPath(dest))
  }

  for (const relative of manifest.remove) {
    const dest = join(targetGameDir, gameRelPath(relative))
    if (!pathExists(dest)) continue
    await rm(toFsPath(dest), { force: true })
  }

  await rm(toFsPath(uninstallRoot), { recursive: true, force: true })

  const parent = join(targetGameDir, UNINSTALL_DIR)
  try {
    const leftover = await readdir(toFsPath(parent))
    if (!leftover.length) await rm(toFsPath(parent), { recursive: true, force: true })
  } catch {
    // parent already gone
  }

  return manifest
}


async function writeUninstallBundle(
  targetGameDir: string,
  meta: UncensorPatchMeta,
  files: Array<{ absolute: string; relative: string }>
): Promise<{ filesCopied: number; uninstallDir: string; uninstallSlot: string }> {
  const slot = uninstallSlotName(meta)
  const uninstallRoot = join(targetGameDir, UNINSTALL_DIR, slot)
  const backupRoot = join(uninstallRoot, 'backup')
  await mkdir(toFsPath(backupRoot), { recursive: true })

  const remove: string[] = []
  const restore: string[] = []

  for (const file of files) {
    const relativePath = toGameRelative(file.relative)
    const dest = join(targetGameDir, relativePath)
    // Never write into our own uninstall tree.
    if (relativePath.split(/[/\\]/)[0]?.toLowerCase() === UNINSTALL_DIR) continue

    if (pathExists(dest)) {
      const backupDest = join(backupRoot, `${relativePath}${BACKUP_SUFFIX}`)
      await mkdir(toFsPath(dirname(backupDest)), { recursive: true })
      await copyFile(toFsPath(dest), toFsPath(backupDest))
      restore.push(relativePath.split(/[/\\]/).join('/'))
    } else {
      remove.push(relativePath.split(/[/\\]/).join('/'))
    }

    await mkdir(toFsPath(dirname(dest)), { recursive: true })
    await copyFile(toFsPath(file.absolute), toFsPath(dest))
  }

  const manifest: UncensorUninstallManifest = {
    version: 1,
    patchId: meta.patchId,
    hash: meta.hash,
    filename: meta.filename,
    installedAt: Date.now(),
    remove: [...new Set(remove)].sort(),
    restore: [...new Set(restore)].sort()
  }
  await writeFile(toFsPath(join(uninstallRoot, MANIFEST_NAME)), JSON.stringify(manifest, null, 2), 'utf8')

  return { filesCopied: files.length, uninstallDir: uninstallRoot, uninstallSlot: slot }
}

/**
 * Best-effort apply of a Ren'Py uncensor patch into an installed game's `/game` directory.
 * Writes `game/.uninstall/<slot>/` with instructions + backups of overwritten files.
 */
export async function applyUncensorPatchToGameDir(
  sourcePath: string,
  targetGameDir: string,
  tempParentDir: string,
  meta: UncensorPatchMeta,
  onProgress?: (percent: number) => void
): Promise<{ filesCopied: number; uninstallDir: string; uninstallSlot: string }> {
  if (!sourcePath || !pathExists(sourcePath)) {
    throw new Error('The uncensor patch file is missing from disk.')
  }
  if (!targetGameDir) {
    throw new Error('The game folder is missing.')
  }

  onProgress?.(2)
  await mkdir(toFsPath(targetGameDir), { recursive: true })

  if (isRenpyScriptPath(sourcePath) && !isArchivePath(sourcePath)) {
    const files = [{ absolute: sourcePath, relative: basename(sourcePath) }]
    const result = await writeUninstallBundle(targetGameDir, meta, files)
    onProgress?.(100)
    return result
  }

  if (!isArchivePath(sourcePath)) {
    throw new Error('Uncensor patches must be a .rpy/.rpyc file or a zip/7z/rar archive.')
  }

  await mkdir(toFsPath(tempParentDir), { recursive: true })
  const tempDir = await mkdtemp(toFsPath(join(tempParentDir, 'uncensor-')))
  try {
    await extractArchive(sourcePath, tempDir, (percent) => {
      onProgress?.(Math.max(2, Math.min(85, Math.round(percent * 0.85))))
    })
    onProgress?.(88)
    const plan = planUncensorPatch(tempDir)
    const files =
      plan.mode === 'merge-game'
        ? await collectMergeFiles(plan.sourceGameDir)
        : planFiles(plan)
    if (!files.length) {
      throw new Error('Nothing was copied from that uncensor patch.')
    }
    onProgress?.(92)
    const result = await writeUninstallBundle(targetGameDir, meta, files)
    onProgress?.(100)
    return result
  } finally {
    await rm(toFsPath(tempDir), { recursive: true, force: true }).catch(() => undefined)
  }
}
