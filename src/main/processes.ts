import { execFile } from 'child_process'
import { readdir, readFile, readlink } from 'fs/promises'
import { isAbsolute, relative, resolve } from 'path'
import { promisify } from 'util'
import { stripNamespace } from './win-path'

const execFileAsync = promisify(execFile)

export type ProcessExe = {
  pid: number
  path: string
  cwd?: string
}

function normalizePath(value: string): string {
  const resolved = resolve(stripNamespace(value))
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

export function pathIsInside(root: string, filePath: string): boolean {
  if (!root || !filePath) return false
  const parent = normalizePath(root)
  const child = normalizePath(filePath)
  if (child === parent) return true
  const rel = relative(parent, child)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function pidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function parsePsProcesses(stdout: string): ProcessExe[] {
  return stdout.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^(\d+)\s+(.*)$/)
    if (!match) return []
    const pid = Number(match[1])
    const command = match[2].trim()
    if (!Number.isInteger(pid) || pid <= 0 || !command || command.startsWith('[')) return []
    const path = command.startsWith('/') || /^[A-Za-z]:[\\/]/.test(command)
      ? (command.match(/^("([^"]+)"|\S+)/)?.[2] || command.match(/^\S+/)?.[0] || command)
      : command
    return [{ pid, path }]
  })
}

async function listLinuxProcesses(): Promise<ProcessExe[]> {
  const names = await readdir('/proc').catch(() => [] as string[])
  const found: ProcessExe[] = []
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue
    const pid = Number(name)
    if (!Number.isInteger(pid) || pid <= 0) continue
    const exe = await readlink(`/proc/${pid}/exe`).catch(() => '')
    const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => '')
    const path = exe.replace(/ \(deleted\)$/, '')
    if (!path && !cwd) continue
    found.push({ pid, path: path || cwd, cwd: cwd || undefined })
  }
  return found
}

async function listMacCwdByPid(): Promise<Map<number, string>> {
  const cwdByPid = new Map<number, string>()
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', '-a', '-d', 'cwd', '-F', 'pn'], {
      timeout: 12_000,
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024
    })
    let pid = 0
    for (const line of stdout.split(/\r?\n/)) {
      if (line.startsWith('p')) {
        pid = Number(line.slice(1))
        continue
      }
      if (line.startsWith('n') && pid > 0) {
        cwdByPid.set(pid, line.slice(1))
      }
    }
  } catch {
    // lsof is optional; ps still gives the command path.
  }
  return cwdByPid
}

async function listMacProcesses(): Promise<ProcessExe[]> {
  const [{ stdout }, cwdByPid] = await Promise.all([
    execFileAsync('ps', ['-ax', '-o', 'pid=', '-o', 'command='], {
      timeout: 12_000,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024
    }),
    listMacCwdByPid()
  ])
  return parsePsProcesses(stdout).map((item) => ({
    ...item,
    cwd: cwdByPid.get(item.pid)
  }))
}

async function listWindowsProcesses(): Promise<ProcessExe[]> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        '$ErrorActionPreference = "SilentlyContinue"',
        '[Console]::OutputEncoding = [Text.UTF8Encoding]::UTF8',
        'Get-CimInstance Win32_Process -Property ProcessId,ExecutablePath |',
        'Where-Object { $_.ExecutablePath } |',
        'ForEach-Object { "{0}`t{1}" -f $_.ProcessId, $_.ExecutablePath }'
      ].join(' ')
    ],
    { windowsHide: true, timeout: 12_000, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  )
  return stdout.split(/\r?\n/).flatMap((line) => {
    const tab = line.indexOf('\t')
    if (tab < 0) return []
    const pid = Number(line.slice(0, tab))
    const path = line.slice(tab + 1).trim()
    if (!Number.isInteger(pid) || pid <= 0 || !path) return []
    return [{ pid, path }]
  })
}

export async function listProcessExecutables(): Promise<ProcessExe[]> {
  try {
    if (process.platform === 'win32') return await listWindowsProcesses()
    if (process.platform === 'linux') return await listLinuxProcesses()
    if (process.platform === 'darwin') return await listMacProcesses()
    return []
  } catch {
    return []
  }
}

function isOwnPid(pid: number): boolean {
  return pid === process.pid || (typeof process.ppid === 'number' && pid === process.ppid)
}

export async function processesUnder(root: string): Promise<ProcessExe[]> {
  const list = await listProcessExecutables()
  return list.filter(
    (item) =>
      !isOwnPid(item.pid) &&
      (pathIsInside(root, item.path) || (item.cwd ? pathIsInside(root, item.cwd) : false))
  )
}

async function listChildPids(pid: number): Promise<number[]> {
  if (process.platform === 'linux') {
    const names = await readdir('/proc').catch(() => [] as string[])
    const children: number[] = []
    for (const name of names) {
      if (!/^\d+$/.test(name)) continue
      const child = Number(name)
      if (child === pid) continue
      try {
        const status = await readFile(`/proc/${child}/status`, 'utf8')
        const match = status.match(/^PPid:\s*(\d+)/m)
        if (match && Number(match[1]) === pid) children.push(child)
      } catch {
        // Process vanished or is unreadable.
      }
    }
    return children
  }
  try {
    const { stdout } = await execFileAsync('pgrep', ['-P', String(pid)], {
      encoding: 'utf8',
      timeout: 4000
    })
    return stdout
      .split(/\s+/)
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0)
  } catch {
    return []
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    // Already gone.
  }
  try {
    process.kill(-pid, signal)
  } catch {
    // Not a process-group leader, or already gone.
  }
}

async function killUnixTree(pid: number): Promise<void> {
  const children = await listChildPids(pid)
  for (const child of children) {
    await killUnixTree(child)
  }
  signalPid(pid, 'SIGTERM')
  await delay(400)
  if (pidAlive(pid)) signalPid(pid, 'SIGKILL')
}

export async function killProcessTree(pid: number): Promise<void> {
  if (!pidAlive(pid)) return
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 8000
    }).catch(() => undefined)
    return
  }
  await killUnixTree(pid)
}

export async function killProcessesUnder(root: string): Promise<void> {
  const found = await processesUnder(root)
  for (const item of found) {
    await killProcessTree(item.pid)
  }
}
