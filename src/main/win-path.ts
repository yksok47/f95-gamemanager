import { existsSync, realpathSync, readdirSync, type Dirent } from 'fs'
import { dirname, join, resolve, toNamespacedPath } from 'path'
import { spawnSync } from 'child_process'

const DOS_SHORT = /^[^.]{1,8}~\d+(\.[^.]{0,3})?$/i

export function isWindows(): boolean {
  return process.platform === 'win32'
}

export function stripNamespace(filePath: string): string {
  let value = filePath.replace(/\//g, isWindows() ? '\\' : '/')
  if (/^\\\\\?\\UNC\\/i.test(value)) return `\\${value.slice(7)}`
  if (value.startsWith('\\\\?\\') || value.startsWith('\\??\\')) return value.slice(4)
  return value
}

export function toFsPath(filePath: string): string {
  if (!filePath) return filePath
  const resolved = resolve(filePath)
  return isWindows() ? toNamespacedPath(resolved) : resolved
}

export function pathExists(filePath: string): boolean {
  if (!filePath) return false
  try {
    return existsSync(toFsPath(filePath))
  } catch {
    return false
  }
}

export function listDirents(dir: string): Dirent[] {
  try {
    return readdirSync(toFsPath(dir), { withFileTypes: true })
  } catch {
    return []
  }
}

export function childPath(dir: string, name: string): string {
  return join(stripNamespace(resolve(dir)), name)
}

export function isDosShortName(filePath: string): boolean {
  const base = filePath.split(/[/\\]/).pop() || ''
  return DOS_SHORT.test(base)
}

export function resolveLongPath(filePath: string): string {
  if (!filePath) return filePath
  try {
    return stripNamespace(realpathSync.native(toFsPath(filePath)))
  } catch {
    try {
      return stripNamespace(realpathSync(toFsPath(filePath)))
    } catch {
      return stripNamespace(resolve(filePath))
    }
  }
}

export function resolveShortPath(filePath: string): string {
  const longPath = resolveLongPath(filePath)
  if (!isWindows() || !longPath) return longPath
  try {
    const quoted = longPath.replace(/"/g, '')
    const result = spawnSync(
      process.env.ComSpec || 'cmd.exe',
      ['/d', '/s', '/c', `for %I in ("${quoted}") do @echo %~sI`],
      { encoding: 'utf8', windowsHide: true, timeout: 4000 }
    )
    const line = (result.stdout || '')
      .split(/\r?\n/)
      .map((row) => row.trim())
      .filter(Boolean)
      .at(-1)
    if (line && pathExists(line)) return line
  } catch {
    // Keep the long path and let the caller use a namespaced launch.
  }
  return longPath
}

export function launchTarget(executablePath: string): { file: string; cwd: string } {
  const longFile = resolveLongPath(executablePath)
  const longCwd = dirname(longFile)
  if (!isWindows()) return { file: longFile, cwd: longCwd }

  const shortFile = resolveShortPath(longFile)
  const shortCwd = resolveShortPath(longCwd)
  const useShort =
    shortFile.length < 260 &&
    shortCwd.length < 260 &&
    pathExists(shortFile)

  return {
    file: useShort ? shortFile : toFsPath(longFile),
    cwd: shortCwd.length < 260 ? shortCwd : longCwd
  }
}
