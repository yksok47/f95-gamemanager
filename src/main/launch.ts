import { dirname } from 'path'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { supportedEngineId } from '@shared/engines'
import {
  childPath,
  isDosShortName,
  listDirents,
  pathExists,
  resolveLongPath,
  stripNamespace
} from './win-path'

const execFileAsync = promisify(execFile)

const SKIP_EXES = /^(pythonw?|uninstall|unins\d*|crashpad|unitycrashhandler|vcredist|dxsetup|crashreporter)/i

function listDirs(root: string): string[] {
  return listDirents(root)
    .filter((entry) => entry.isDirectory())
    .map((entry) => childPath(root, entry.name))
}

function listFiles(root: string): string[] {
  return listDirents(root)
    .filter((entry) => entry.isFile())
    .map((entry) => childPath(root, entry.name))
}

function findNamedDirs(root: string, name: string, maxDepth = 6): string[] {
  const found: string[] = []
  const skip = new Set(['lib', 'renpy', 'cache', '__pycache__', 'tmp', 'temp', 'node_modules'])

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return
    for (const child of listDirs(dir)) {
      const base = child.split(/[/\\]/).pop() || ''
      if (base.toLowerCase() === name) found.push(child)
      if (skip.has(base.toLowerCase())) continue
      walk(child, depth + 1)
    }
  }

  walk(root, 0)
  return found
}

function exeBitScore(filePath: string): number {
  const name = (filePath.split(/[/\\]/).pop() || '').toLowerCase()
  if (/(^|[^a-z])(32|x86|win32|ia32)([^a-z]|$)|32bit|[-_.]32(\.|$)/i.test(name)) return 0
  if (/(^|[^a-z])(64|x64|win64|amd64)([^a-z]|$)|64bit|[-_.]64(\.|$)/i.test(name)) return 2
  return 1
}

function collectExes(dir: string): string[] {
  return listFiles(dir).filter((file) => {
    if (!/\.exe$/i.test(file)) return false
    const name = file.split(/[/\\]/).pop() || ''
    return !SKIP_EXES.test(name)
  })
}

function rankExes(candidates: Iterable<string>): string | null {
  const ranked = [...candidates].sort((a, b) => {
    const dos = Number(isDosShortName(a)) - Number(isDosShortName(b))
    if (dos) return dos
    const score = exeBitScore(b) - exeBitScore(a)
    if (score) return score
    return a.length - b.length
  })
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
    for (const exe of collectExes(dirname(gameDir))) candidates.add(exe)
  }
  if (!candidates.size) {
    for (const exe of collectExes(installPath)) candidates.add(exe)
  }
  return rankExes(candidates)
}

function findGenericExecutable(installPath: string, maxDepth = 3): string | null {
  const candidates = new Set<string>()
  const skip = new Set(['lib', 'renpy', 'cache', '__pycache__', 'tmp', 'temp'])

  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return
    for (const exe of collectExes(dir)) candidates.add(exe)
    for (const child of listDirs(dir)) {
      const base = child.split(/[/\\]/).pop() || ''
      if (skip.has(base.toLowerCase())) continue
      walk(child, depth + 1)
    }
  }

  walk(installPath, 0)
  return rankExes(candidates)
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
    filters: [
      { name: 'Executables', extensions: ['exe'] },
      { name: 'All files', extensions: ['*'] }
    ],
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

function spawnDetached(file: string, cwd: string): number {
  const child = spawn(file, [], {
    cwd,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  })
  if (!child.pid) {
    throw new Error('The game did not start.')
  }
  child.unref()
  return child.pid
}

export async function launchExecutable(executablePath: string): Promise<{ pid: number }> {
  const file = stripNamespace(resolveLongPath(executablePath))
  if (!pathExists(file)) {
    throw new Error('The selected executable is missing.')
  }
  const cwd = dirname(file)
  if (process.platform === 'win32') {
    try {
      return { pid: await startWindowsProcess(file, cwd) }
    } catch (error) {
      console.warn('Start-Process launch failed, falling back to spawn', error)
    }
  }
  return { pid: spawnDetached(file, cwd) }
}
