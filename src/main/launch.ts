import { dirname } from 'path'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { supportedEngineId } from '@shared/engines'
import {
  compareLaunchCandidates,
  hostPlatformOf,
  isLaunchCandidate
} from './launch-detect'
import { makePathExecutable } from './unix-exec'
import {
  childPath,
  isDosShortName,
  listDirents,
  pathExists,
  resolveLongPath,
  stripNamespace
} from './win-path'

const execFileAsync = promisify(execFile)

function listDirs(root: string): string[] {
  return listDirents(root)
    .filter((entry) => entry.isDirectory())
    .map((entry) => childPath(root, entry.name))
}

function collectLaunchables(dir: string): string[] {
  const platform = hostPlatformOf()
  return listDirents(dir).flatMap((entry) => {
    const kind = entry.isDirectory() ? 'dir' : entry.isFile() ? 'file' : null
    if (!kind) return []
    if (!isLaunchCandidate(entry.name, kind, platform)) return []
    return [childPath(dir, entry.name)]
  })
}

function findNamedDirs(root: string, name: string, maxDepth = 6): string[] {
  const found: string[] = []
  const skip = new Set(['lib', 'renpy', 'cache', '__pycache__', 'tmp', 'temp', 'node_modules'])

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return
    for (const child of listDirs(dir)) {
      const base = child.split(/[/\\]/).pop() || ''
      if (base.toLowerCase() === name) found.push(child)
      if (skip.has(base.toLowerCase()) || /\.app$/i.test(base)) continue
      walk(child, depth + 1)
    }
  }

  walk(root, 0)
  return found
}

function rankLaunchables(candidates: Iterable<string>): string | null {
  const ranked = [...candidates].sort((a, b) =>
    compareLaunchCandidates(a, b, hostPlatformOf(), process.arch, isDosShortName)
  )
  const picked = ranked[0]
  return picked ? resolveLongPath(picked) : null
}

function hasRenpyScripts(dir: string): boolean {
  const entries = listDirents(dir)
  if (entries.some((entry) => entry.isFile() && /\.rpy[cb]?$/i.test(entry.name))) return true
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const inner = listDirents(childPath(dir, entry.name))
    if (inner.some((item) => item.isFile() && /\.rpy[cb]?$/i.test(item.name))) return true
  }
  return false
}

export function findRenpyGameRoot(installPath: string): string | null {
  if (!installPath || !pathExists(installPath)) return null
  const gameDirs = findNamedDirs(installPath, 'game')
  for (const gameDir of gameDirs) {
    const root = dirname(gameDir)
    if (pathExists(childPath(root, 'renpy')) || pathExists(childPath(root, 'lib'))) {
      return resolveLongPath(root)
    }
  }
  if (pathExists(childPath(installPath, 'game'))) return resolveLongPath(installPath)
  return null
}

function isRpgMakerWww(www: string): boolean {
  const js = childPath(www, 'js')
  if (
    pathExists(childPath(js, 'rpg_core.js')) ||
    pathExists(childPath(js, 'rmmz_core.js')) ||
    pathExists(childPath(js, 'rpg_managers.js')) ||
    pathExists(childPath(js, 'plugins.js'))
  ) {
    return true
  }
  return pathExists(childPath(www, 'index.html')) && (pathExists(js) || pathExists(childPath(www, 'data')))
}

export function findRpgMakerWww(installPath: string): string | null {
  if (!installPath || !pathExists(installPath)) return null
  if (isRpgMakerWww(installPath)) return resolveLongPath(installPath)
  const wwwDirs = findNamedDirs(installPath, 'www')
  for (const www of wwwDirs) {
    if (isRpgMakerWww(www)) return resolveLongPath(www)
  }
  return null
}

export function rpgMakerSaveDirFromWww(www: string): string {
  return childPath(www, 'save')
}

export function detectEngineFromInstall(installPath: string): string {
  if (!installPath || !pathExists(installPath)) return ''
  if (findNamedDirs(installPath, 'renpy').length) return "Ren'Py"
  if (findNamedDirs(installPath, 'game').some(hasRenpyScripts)) return "Ren'Py"
  if (findRpgMakerWww(installPath)) return 'RPG Maker'
  return ''
}

export function findRenpyExecutable(installPath: string): string | null {
  const gameDirs = findNamedDirs(installPath, 'game')
  const candidates = new Set<string>()
  for (const gameDir of gameDirs) {
    for (const file of collectLaunchables(dirname(gameDir))) candidates.add(file)
  }
  if (!candidates.size) {
    for (const file of collectLaunchables(installPath)) candidates.add(file)
  }
  return rankLaunchables(candidates)
}

function findGenericExecutable(installPath: string, maxDepth = 3): string | null {
  const candidates = new Set<string>()
  const skip = new Set(['lib', 'renpy', 'cache', '__pycache__', 'tmp', 'temp'])

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return
    for (const file of collectLaunchables(dir)) candidates.add(file)
    for (const child of listDirs(dir)) {
      const base = child.split(/[/\\]/).pop() || ''
      if (skip.has(base.toLowerCase()) || /\.app$/i.test(base)) continue
      walk(child, depth + 1)
    }
  }

  walk(installPath, 0)
  return rankLaunchables(candidates)
}

export function detectExecutable(installPath: string, engine: string): string | null {
  if (!installPath || !pathExists(installPath)) return null
  const id = supportedEngineId(engine)
  if (id === 'renpy' || !engine || detectEngineFromInstall(installPath) === "Ren'Py") {
    const found = findRenpyExecutable(installPath)
    if (found) return found
  }
  return findGenericExecutable(installPath)
}

function pickerFilters(): OpenDialogOptions['filters'] {
  if (process.platform === 'win32') {
    return [
      { name: 'Executables', extensions: ['exe'] },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  if (process.platform === 'darwin') {
    return [
      { name: 'Applications', extensions: ['app', 'sh', 'command'] },
      { name: 'All files', extensions: ['*'] }
    ]
  }
  return [
    { name: 'Executables', extensions: ['sh', 'x86_64', 'x86', 'arm64'] },
    { name: 'All files', extensions: ['*'] }
  ]
}

export async function pickExecutable(
  installPath: string,
  parent?: BrowserWindow | null
): Promise<string | null> {
  if (!installPath || !pathExists(installPath)) {
    throw new Error('That game is not installed.')
  }
  const options: OpenDialogOptions = {
    title: 'Choose game executable',
    defaultPath: installPath,
    filters: pickerFilters(),
    properties: ['openFile']
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || !result.filePaths[0]) return null
  return resolveLongPath(result.filePaths[0])
}

function powershellLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function startWindowsProcess(file: string, cwd: string): Promise<number> {
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8',
    `$file = ${powershellLiteral(file)}`,
    `$cwd = ${powershellLiteral(cwd)}`,
    '$p = Start-Process -LiteralPath $file -WorkingDirectory $cwd -WindowStyle Normal -PassThru',
    'if (-not $p) { throw "The game did not start." }',
    'Write-Output $p.Id'
  ].join('; ')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, timeout: 15_000, encoding: 'utf8' }
  )
  const pid = Number((stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1))
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error('The game did not start.')
  }
  return pid
}

function resolveMacAppExecutable(appPath: string): string | null {
  const macosDir = childPath(childPath(appPath, 'Contents'), 'MacOS')
  const inner = listDirents(macosDir).filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
  if (!inner.length) return null
  return childPath(macosDir, inner[0].name)
}

function resolveLaunchTarget(executablePath: string): { file: string; cwd: string } {
  const file = stripNamespace(resolveLongPath(executablePath))
  if (process.platform === 'darwin' && /\.app$/i.test(file)) {
    const inner = resolveMacAppExecutable(file)
    if (inner) return { file: inner, cwd: dirname(file) }
  }
  return { file, cwd: dirname(file) }
}

function spawnDetached(file: string, cwd: string): number {
  const script = process.platform !== 'win32' && /\.(sh|command)$/i.test(file)
  const child = script
    ? spawn('/bin/sh', [file], { cwd, detached: true, stdio: 'ignore' })
    : spawn(file, [], { cwd, detached: true, stdio: 'ignore', windowsHide: false })
  if (!child.pid) {
    throw new Error('The game did not start.')
  }
  child.unref()
  return child.pid
}

export async function launchExecutable(executablePath: string): Promise<{ pid: number }> {
  const target = resolveLaunchTarget(executablePath)
  if (!pathExists(target.file)) {
    throw new Error('The selected executable is missing.')
  }
  await makePathExecutable(target.file)
  if (process.platform === 'win32') {
    try {
      return { pid: await startWindowsProcess(target.file, target.cwd) }
    } catch (error) {
      console.warn('Start-Process launch failed, falling back to spawn', error)
    }
  }
  return { pid: spawnDetached(target.file, target.cwd) }
}
