import { cp, mkdir, rename, rm } from 'fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'
import { isPathInside, isSamePath, pathKey } from './extra-library-dirs'
import { sanitizeSegment } from './fs-utils'
import { listDirents, pathExists, toFsPath } from './win-path'

/** Canonical install folder: `{libraryDir}/{title}/{version}`. */
export function expectedInstallPath(libraryDir: string, title: string, version: string): string {
  return join(
    resolve(libraryDir),
    sanitizeSegment(title),
    sanitizeSegment(version || 'unknown')
  )
}

export function installLayoutMatches(installPath: string, expectedPath: string): boolean {
  if (!installPath || !expectedPath) return false
  return isSamePath(installPath, expectedPath)
}

/** Rewrite `value` when it is `fromRoot` or a file inside it. */
export function rebasePath(value: string, fromRoot: string, toRoot: string): string {
  if (!value || !fromRoot || !toRoot) return value
  const resolved = resolve(value)
  const from = resolve(fromRoot)
  if (!isPathInside(resolved, from)) return value
  const rel = relative(from, resolved)
  return rel ? resolve(toRoot, rel) : resolve(toRoot)
}

/** Leave relative values (Ren'Py folder names) untouched. */
export function rebaseAbsolutePath(
  value: string | null | undefined,
  fromRoot: string,
  toRoot: string
): string | null | undefined {
  if (value == null || value === '') return value
  if (!isAbsolute(value)) return value
  return rebasePath(value, fromRoot, toRoot)
}

async function renameOrCopy(from: string, to: string): Promise<void> {
  await mkdir(toFsPath(dirname(to)), { recursive: true })
  try {
    await rename(toFsPath(from), toFsPath(to))
  } catch {
    await cp(toFsPath(from), toFsPath(to), { recursive: true, force: true })
    await rm(toFsPath(from), { recursive: true, force: true })
  }
}

function siblingStagingPath(target: string): string {
  const parent = dirname(target)
  const base = basename(target)
  for (let i = 0; i < 50; i++) {
    const name = `${base}.relocating${i ? `-${i}` : ''}`
    const candidate = join(parent, name)
    if (!pathExists(candidate)) return candidate
  }
  throw new Error('Could not create a temporary folder for the move.')
}

function destOccupied(dest: string): boolean {
  return pathExists(dest) && listDirents(dest).length > 0
}

/**
 * Move an extracted game folder onto the canonical `{title}/{version}` path.
 * Handles a version folder that still needs to be created inside the current
 * root, and a game root nested one level too deep under the destination.
 */
export async function moveInstallDirectory(source: string, dest: string): Promise<void> {
  const src = resolve(source)
  const dst = resolve(dest)
  if (isSamePath(src, dst)) return
  if (!pathExists(src)) throw new Error('That install folder is missing.')
  if (isSamePath(src, dirname(src))) throw new Error('Refusing to move a drive root.')

  const destInsideSource = isPathInside(dst, src) && !isSamePath(dst, src)
  const sourceInsideDest = isPathInside(src, dst) && !isSamePath(dst, src)

  if (destInsideSource) {
    await mkdir(toFsPath(dst), { recursive: true })
    for (const entry of listDirents(src)) {
      const from = join(src, entry.name)
      if (isSamePath(from, dst) || isPathInside(dst, from)) continue
      const to = join(dst, entry.name)
      if (pathExists(to)) throw new Error('The destination folder already has files.')
      await renameOrCopy(from, to)
    }
    return
  }

  if (sourceInsideDest) {
    const staging = siblingStagingPath(dst)
    await renameOrCopy(src, staging)
    if (destOccupied(dst)) {
      await renameOrCopy(staging, src)
      throw new Error('The destination folder already has files.')
    }
    if (pathExists(dst)) await rm(toFsPath(dst), { recursive: true, force: true })
    await renameOrCopy(staging, dst)
    return
  }

  if (pathExists(dst)) {
    if (destOccupied(dst)) throw new Error('The destination folder already exists.')
    await rm(toFsPath(dst), { recursive: true, force: true })
  }
  await renameOrCopy(src, dst)
}

export function pathChanged(before: string, after: string): boolean {
  return pathKey(before) !== pathKey(after)
}
