import { chmodSync } from 'fs'
import { chmod, readdir } from 'fs/promises'
import { join } from 'path'
import { toFsPath } from './win-path'

const SKIP_DIRS = /^(cache|__pycache__|__macosx|\.git)$/i
const EXEC_NAME = /(\.sh|\.command|\.x86_64|\.x86|\.arm64|\.aarch64)$/i
const PYTHON_NAME = /^python(\d+(\.\d+)?)?w?(\.exe)?$/i

export function makePathExecutableSync(filePath: string): void {
  if (process.platform === 'win32' || !filePath) return
  try {
    chmodSync(toFsPath(filePath), 0o755)
  } catch {
    // Missing file or a filesystem that does not allow chmod.
  }
}

export async function makePathExecutable(filePath: string): Promise<void> {
  if (process.platform === 'win32' || !filePath) return
  await chmod(toFsPath(filePath), 0o755).catch(() => undefined)
}

export async function markExtractedExecutables(root: string, maxDepth = 6): Promise<void> {
  if (process.platform === 'win32' || !root) return

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return
    let entries
    try {
      entries = await readdir(toFsPath(dir), { withFileTypes: true })
    } catch {
      return
    }
    const underLib = dir.replace(/\\/g, '/').toLowerCase().includes('/lib/')
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.test(entry.name)) continue
        if (/\.app$/i.test(entry.name)) {
          await walk(join(full, 'Contents', 'MacOS'), depth + 1)
          continue
        }
        await walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      const name = entry.name
      if (
        EXEC_NAME.test(name) ||
        PYTHON_NAME.test(name) ||
        ((depth <= 2 || underLib) && !name.includes('.'))
      ) {
        await makePathExecutable(full)
      }
    }
  }

  await walk(root, 0)
}
