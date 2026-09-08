import { execFile } from 'child_process'
import { promisify } from 'util'
import { stripNamespace } from './win-path'

const execFileAsync = promisify(execFile)

export type ProcessExe = {
  pid: number
  path: string
}

function normalizePath(value: string): string {
  return stripNamespace(value).replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

export function pathIsInside(root: string, filePath: string): boolean {
  if (!root || !filePath) return false
  const parent = normalizePath(root)
  const child = normalizePath(filePath)
  return child === parent || child.startsWith(`${parent}\\`)
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

export async function listProcessExecutables(): Promise<ProcessExe[]> {
  if (process.platform !== 'win32') return []
  try {
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
  } catch {
    return []
  }
}

export async function processesUnder(root: string): Promise<ProcessExe[]> {
  const list = await listProcessExecutables()
  return list.filter((item) => pathIsInside(root, item.path))
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
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Already gone.
  }
}

export async function killProcessesUnder(root: string): Promise<void> {
  const found = await processesUnder(root)
  for (const item of found) {
    await killProcessTree(item.pid)
  }
}
