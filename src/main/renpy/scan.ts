import { stat } from 'fs/promises'
import { join } from 'path'
import type { RenpyArchiveFile, RenpyScriptStatus } from '@shared/types'
import { yieldToEventLoop } from '../disk-usage'
import {
  childPath,
  listDirentsAsync,
  pathExistsAsync,
  resolveLongPathAsync,
  toFsPath
} from '../win-path'
import { findGamePython } from './runtime'
import { isRenpyToolScript } from './tools'

const SKIP_DIRS = new Set(['lib', 'renpy', 'cache', '__pycache__', 'tmp', 'temp', 'decompiler', '.f95-unren', '.f95-unren-old', '.uninstall'])
const YIELD_EVERY = 64

export function gameDirFromRoot(gameRoot: string): string {
  return childPath(gameRoot, 'game')
}

export async function findNamedFiles(root: string, name: string, maxDepth = 8): Promise<string[]> {
  const found: string[] = []
  const target = name.toLowerCase()
  let ops = 0

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    for (const entry of await listDirentsAsync(dir)) {
      const full = childPath(dir, entry.name)
      ops += 1
      if (ops >= YIELD_EVERY) {
        ops = 0
        await yieldToEventLoop()
      }
      if (entry.isFile() && entry.name.toLowerCase() === target) {
        found.push(full)
        continue
      }
      if (!entry.isDirectory()) continue
      if (SKIP_DIRS.has(entry.name.toLowerCase()) || entry.name.toLowerCase() === 'tl') continue
      await walk(full, depth + 1)
    }
  }

  if (await pathExistsAsync(root)) await walk(root, 0)
  return found.sort((a, b) => a.length - b.length)
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(toFsPath(filePath))).size
  } catch {
    return 0
  }
}

export async function scanScripts(gameRoot: string): Promise<RenpyScriptStatus> {
  const gameDir = gameDirFromRoot(gameRoot)
  const rpaFiles: RenpyArchiveFile[] = []
  let rpycCount = 0
  let rpyCount = 0
  let rpycWithoutRpy = 0
  const rpycNames = new Set<string>()
  const rpyNames = new Set<string>()
  let ops = 0

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return
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
      const lower = entry.name.toLowerCase()
      if (lower.endsWith('.rpa')) {
        rpaFiles.push({ name: entry.name, path: await resolveLongPathAsync(full), size: await fileSize(full) })
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

  if (await pathExistsAsync(gameDir)) await walk(gameDir, 0)
  for (const key of rpycNames) {
    if (!rpyNames.has(key)) rpycWithoutRpy += 1
  }

  rpaFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  return {
    gameRoot: await resolveLongPathAsync(gameRoot),
    gameDir: await resolveLongPathAsync(gameDir),
    pythonPath: findGamePython(gameRoot),
    rpaCount: rpaFiles.length,
    rpaBytes: rpaFiles.reduce((sum, file) => sum + file.size, 0),
    rpaFiles,
    rpycCount,
    rpyCount,
    rpycWithoutRpy,
    optionsRpy: (await findNamedFiles(gameDir, 'options.rpy')).length > 0,
    optionsRpyc: (await findNamedFiles(gameDir, 'options.rpyc')).length > 0,
    packed: rpaFiles.length > 0,
    unpacked: rpyCount + rpycCount > 0,
    compiled: rpycWithoutRpy > 0,
    alreadyUnpacked: rpyCount + rpycCount > 0,
    alreadyDecompiled: rpyCount > 0 && rpycWithoutRpy === 0,
    needsUnpack: rpaFiles.length > 0 && rpyCount + rpycCount === 0,
    needsDecompile: rpycWithoutRpy > 0
  }
}

export async function listRpaFiles(gameRoot: string): Promise<RenpyArchiveFile[]> {
  return (await scanScripts(gameRoot)).rpaFiles
}

export async function listRpycNeedingDecompile(gameRoot: string): Promise<string[]> {
  const gameDir = gameDirFromRoot(gameRoot)
  const pending: string[] = []
  let ops = 0

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 8) return
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
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.rpyc')) continue
      if (/^un\.rpyc$/i.test(entry.name) || isRenpyToolScript(entry.name.replace(/c$/i, ''))) continue
      const rpy = full.replace(/\.rpyc$/i, '.rpy')
      if (!(await pathExistsAsync(rpy))) pending.push(await resolveLongPathAsync(full))
    }
  }

  if (await pathExistsAsync(gameDir)) await walk(gameDir, 0)
  return pending
}
