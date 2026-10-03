import { stat } from 'fs/promises'
import { join } from 'path'
import type { RenpyArchiveFile, RenpyScriptStatus } from '@shared/types'
import type { WeightedPath } from './unren-work'
import { mapLimit, yieldToEventLoop } from '../disk-usage'
import {
  childPath,
  listDirentsAsync,
  pathExistsAsync,
  resolveLongPathAsync,
  toFsPath
} from '../win-path'
import { findGamePython } from './runtime'
import { isRenpyToolScript } from './tools'

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
/** Media folders almost never contain .rpa/.rpy/.rpyc, but they dominate extracted installs. */
const SKIP_ASSET_DIRS = new Set([
  'images',
  'image',
  'img',
  'audio',
  'music',
  'sound',
  'sounds',
  'sfx',
  'bgm',
  'bgs',
  'voice',
  'voices',
  'video',
  'videos',
  'movie',
  'movies',
  'fonts',
  'font',
  'gui',
  'saves'
])
const YIELD_EVERY = 256

function skipDir(name: string, skipTranslations: boolean): boolean {
  const lower = name.toLowerCase()
  if (SKIP_DIRS.has(lower) || SKIP_ASSET_DIRS.has(lower)) return true
  return skipTranslations && lower === 'tl'
}

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
      if (skipDir(entry.name, true)) continue
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

export type ScriptScan = {
  status: RenpyScriptStatus
  pendingRpyc: WeightedPath[]
  compiledWithRpy: string[]
}

type FoundArchive = { name: string; path: string }
type FoundRpyc = { path: string; stem: string }

async function scanGameScripts(gameRoot: string, collectPending: boolean): Promise<ScriptScan> {
  const gameDir = gameDirFromRoot(gameRoot)
  const rpaFound: FoundArchive[] = []
  const rpycFiles: FoundRpyc[] = []
  const rpycStems: string[] = []
  let rpycCount = 0
  let rpyCount = 0
  let optionsRpy = false
  let optionsRpyc = false
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
        if (skipDir(entry.name, false)) continue
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const lower = entry.name.toLowerCase()
      if (lower === 'options.rpy') optionsRpy = true
      else if (lower === 'options.rpyc') optionsRpyc = true
      if (lower.endsWith('.rpa')) {
        rpaFound.push({ name: entry.name, path: full })
      } else if (lower.endsWith('.rpyc')) {
        if (lower === 'un.rpyc' || isRenpyToolScript(lower.replace(/c$/, ''))) continue
        rpycCount += 1
        const stem = join(dir, lower.slice(0, -5)).toLowerCase()
        if (collectPending) rpycFiles.push({ path: full, stem })
        else rpycStems.push(stem)
      } else if (lower.endsWith('.rpy')) {
        if (isRenpyToolScript(entry.name)) continue
        rpyCount += 1
        rpyNames.add(join(dir, lower.slice(0, -4)).toLowerCase())
      }
    }
  }

  if (await pathExistsAsync(gameDir)) await walk(gameDir, 0)

  const rpaFiles = await mapLimit(rpaFound, 8, async (file) => ({
    name: file.name,
    path: await resolveLongPathAsync(file.path),
    size: await fileSize(file.path)
  }))
  rpaFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

  const pendingRpyc: WeightedPath[] = []
  const compiledWithRpy: string[] = []
  let rpycWithoutRpy = 0
  if (collectPending) {
    const resolved = await mapLimit(rpycFiles, 16, async (file) => {
      const path = await resolveLongPathAsync(file.path)
      if (rpyNames.has(file.stem)) return { kind: 'compiled' as const, path }
      return { kind: 'pending' as const, path, size: await fileSize(file.path) }
    })
    for (const item of resolved) {
      if (item.kind === 'compiled') compiledWithRpy.push(item.path)
      else pendingRpyc.push({ path: item.path, size: item.size })
    }
    rpycWithoutRpy = pendingRpyc.length
  } else {
    for (const stem of rpycStems) {
      if (!rpyNames.has(stem)) rpycWithoutRpy += 1
    }
  }

  return {
    status: {
      gameRoot: await resolveLongPathAsync(gameRoot),
      gameDir: await resolveLongPathAsync(gameDir),
      pythonPath: findGamePython(gameRoot),
      rpaCount: rpaFiles.length,
      rpaBytes: rpaFiles.reduce((sum, file) => sum + file.size, 0),
      rpaFiles,
      rpycCount,
      rpyCount,
      rpycWithoutRpy,
      optionsRpy,
      optionsRpyc,
      packed: rpaFiles.length > 0,
      unpacked: rpyCount + rpycCount > 0,
      compiled: rpycWithoutRpy > 0,
      alreadyUnpacked: rpyCount + rpycCount > 0,
      alreadyDecompiled: rpyCount > 0 && rpycWithoutRpy === 0,
      needsUnpack: rpaFiles.length > 0 && rpyCount + rpycCount === 0,
      needsDecompile: rpycWithoutRpy > 0
    },
    pendingRpyc,
    compiledWithRpy
  }
}

export async function scanScripts(gameRoot: string): Promise<RenpyScriptStatus> {
  return (await scanGameScripts(gameRoot, false)).status
}

export async function scanScriptsWithPending(gameRoot: string): Promise<ScriptScan> {
  return scanGameScripts(gameRoot, true)
}

export async function listRpaFiles(gameRoot: string): Promise<RenpyArchiveFile[]> {
  return (await scanScripts(gameRoot)).rpaFiles
}

export async function listRpycNeedingDecompile(gameRoot: string): Promise<string[]> {
  return (await scanScriptsWithPending(gameRoot)).pendingRpyc.map((file) => file.path)
}
