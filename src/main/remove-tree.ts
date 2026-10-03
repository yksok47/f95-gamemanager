import { execFile } from 'node:child_process'
import { rm, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { pathExists, resolveShortPath, stripNamespace, toFsPath } from './win-path'

const execFileAsync = promisify(execFile)

const RM_OPTS = { recursive: true, force: true, maxRetries: 8, retryDelay: 100 } as const
const DRIVE_ROOT = /^[a-zA-Z]:\\?$/

function directoryPath(target: string): string {
  return stripNamespace(resolve(target)).replace(/[/\\]+$/, '')
}

function assertNotDriveRoot(dir: string): void {
  if (!dir || DRIVE_ROOT.test(dir) || dir === '\\' || dir === '/') {
    throw new Error('Refusing to delete a drive root.')
  }
}

async function removeDirWindows(target: string): Promise<void> {
  let dir = directoryPath(target)
  if (dir.length >= 240) dir = directoryPath(resolveShortPath(target))
  const quoted = dir.replace(/"/g, '')
  const comspec = process.env.ComSpec || 'cmd.exe'
  await execFileAsync(comspec, ['/d', '/s', '/c', `rd /s /q "${quoted}"`], {
    windowsHide: true,
    windowsVerbatimArguments: true
  })
}

/** Fast recursive delete. On Windows, `rd /s /q` beats Node/rimraf for huge trees. */
export async function removeTree(target: string): Promise<void> {
  if (!target || !pathExists(target)) return

  let isDir = false
  try {
    isDir = (await stat(toFsPath(target))).isDirectory()
  } catch {
    return
  }
  if (isDir) assertNotDriveRoot(directoryPath(target))

  if (isDir && process.platform === 'win32') {
    try {
      await removeDirWindows(target)
    } catch {
      // Locked files, long paths, and cmd failures fall through to fs.rm.
    }
  }

  if (pathExists(target)) await rm(toFsPath(target), RM_OPTS)
}
