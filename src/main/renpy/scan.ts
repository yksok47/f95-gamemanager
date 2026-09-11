import { statSync } from 'fs'
import { join } from 'path'
import type { RenpyArchiveFile, RenpyScriptStatus } from '@shared/types'
import { childPath, listDirents, pathExists, resolveLongPath, toFsPath } from '../win-path'
import { findGamePython } from './runtime'
import { isRenpyToolScript } from './tools'

const SKIP_DIRS = new Set(['lib', 'renpy', 'cache', '__pycache__', 'tmp', 'temp', 'decompiler', '.f95-unren', '.f95-unren-old'])

export function gameDirFromRoot(gameRoot: string): string {
  return childPath(gameRoot, 'game')
}

export function findNamedFiles(root: string, name: string, maxDepth = 8): string[] {
  const found: string[] = []
  const target = name.toLowerCase()

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return
    for (const entry of listDirents(dir)) {
      const full = childPath(dir, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === target) {
        found.push(full)
        continue
      }
      if (!entry.isDirectory()) continue
      if (SKIP_DIRS.has(entry.name.toLowerCase()) || entry.name.toLowerCase() === 'tl') continue
      walk(full, depth + 1)
    }
  }

  if (pathExists(root)) walk(root, 0)
  return found.sort((a, b) => a.length - b.length)
}

function fileSize(filePath: string): number {
  try {
    return statSync(toFsPath(filePath)).size
  } catch {
    return 0
  }
}

export function scanScripts(gameRoot: string): RenpyScriptStatus {
  const gameDir = gameDirFromRoot(gameRoot)
  const rpaFiles: RenpyArchiveFile[] = []
  let rpycCount = 0
  let rpyCount = 0
  let rpycWithoutRpy = 0
  const rpycNames = new Set<string>()
  const rpyNames = new Set<string>()

  function walk(dir: string, depth: number): void {
    if (depth > 8) return
    for (const entry of listDirents(dir)) {
      const full = childPath(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const lower = entry.name.toLowerCase()
      if (lower.endsWith('.rpa')) {
        rpaFiles.push({ name: entry.name, path: resolveLongPath(full), size: fileSize(full) })
      } else if (lower.endsWith('.rpyc')) {
        if (lower === 'un.rpyc' || isRenpyToolScript(lower.replace(/c$/, ''))) continue
        rpycCount += 1
        rpycNames.add(join(dir, lower.slice(0, -5)).toLowerCase())
      } else if (lower.endsWith('.rpy')) {
        if (isRenpyToolScript(entry.name)) continue
        rpyCount += 1
        rpyNames.add(join(dir, lower.slice(0, -4)).toLowerCase())
      }
    }
  }

  if (pathExists(gameDir)) walk(gameDir, 0)
  for (const key of rpycNames) {
    if (!rpyNames.has(key)) rpycWithoutRpy += 1
  }

  rpaFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return {
    gameRoot: resolveLongPath(gameRoot),
    gameDir: resolveLongPath(gameDir),
    pythonPath: findGamePython(gameRoot),
    rpaCount: rpaFiles.length,
    rpaBytes: rpaFiles.reduce((sum, file) => sum + file.size, 0),
    rpaFiles,
    rpycCount,
    rpyCount,
    rpycWithoutRpy,
    optionsRpy: findNamedFiles(gameDir, 'options.rpy').length > 0,
    optionsRpyc: findNamedFiles(gameDir, 'options.rpyc').length > 0,
    packed: rpaFiles.length > 0,
    unpacked: rpyCount + rpycCount > 0,
    compiled: rpycWithoutRpy > 0,
    alreadyUnpacked: rpyCount + rpycCount > 0,
    alreadyDecompiled: rpyCount > 0 && rpycWithoutRpy === 0,
    needsUnpack: rpaFiles.length > 0 && rpyCount + rpycCount === 0,
    needsDecompile: rpycWithoutRpy > 0
  }
}

export function listRpaFiles(gameRoot: string): RenpyArchiveFile[] {
  return scanScripts(gameRoot).rpaFiles
}

export function listRpycNeedingDecompile(gameRoot: string): string[] {
  const gameDir = gameDirFromRoot(gameRoot)
  const pending: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > 8) return
    for (const entry of listDirents(dir)) {
      const full = childPath(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.rpyc')) continue
      if (/^un\.rpyc$/i.test(entry.name) || isRenpyToolScript(entry.name.replace(/c$/i, ''))) continue
      const rpy = full.replace(/\.rpyc$/i, '.rpy')
      if (!pathExists(rpy)) pending.push(resolveLongPath(full))
    }
  }

  if (pathExists(gameDir)) walk(gameDir, 0)
  return pending
}
