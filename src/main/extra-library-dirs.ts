import { isAbsolute, resolve, sep } from 'path'

export const EXTRA_LIBRARY_DIR_LIMIT = 20

export function pathKey(value: string): string {
  return resolve(value)
    .replace(/[\\/]+$/, '')
    .toLowerCase()
}

export function isSamePath(left: string, right: string): boolean {
  if (!left || !right) return false
  return pathKey(left) === pathKey(right)
}

export function isPathInside(target: string, root: string): boolean {
  if (!target || !root) return false
  const resolved = pathKey(target)
  const base = pathKey(root)
  if (resolved === base) return true
  return resolved.startsWith(base + sep.toLowerCase())
}

/** Unique absolute folders, dropping nested duplicates so a parent scan covers children. */
export function uniqueScanRoots(dirs: Array<string | null | undefined>): string[] {
  const unique: string[] = []
  const seen = new Set<string>()
  for (const dir of dirs) {
    if (typeof dir !== 'string') continue
    const trimmed = dir.trim()
    if (!trimmed) continue
    const next = resolve(trimmed)
    const key = pathKey(next)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(next)
  }
  return unique.filter(
    (dir) => !unique.some((other) => !isSamePath(dir, other) && isPathInside(dir, other))
  )
}

function normalizeOne(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || !isAbsolute(trimmed)) return null
  return resolve(trimmed)
}

/** Unique absolute folders, skipping blocked defaults and nested duplicates. */
export function normalizeExtraDirs(value: unknown, blocked: string[] = []): string[] {
  const blockedKeys = new Set(blocked.map((dir) => pathKey(dir)).filter(Boolean))
  const dirs: string[] = []
  const seen = new Set<string>()
  for (const item of Array.isArray(value) ? value : []) {
    const next = normalizeOne(item)
    if (!next) continue
    const key = pathKey(next)
    if (seen.has(key) || blockedKeys.has(key)) continue
    if (dirs.some((dir) => isPathInside(next, dir) || isPathInside(dir, next))) continue
    seen.add(key)
    dirs.push(next)
    if (dirs.length >= EXTRA_LIBRARY_DIR_LIMIT) break
  }
  return dirs
}
