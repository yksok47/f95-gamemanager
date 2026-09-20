import { readdir, stat } from 'fs/promises'
import { childPath, pathExists, toFsPath } from './win-path'

const STAT_BATCH = 24
const YIELD_EVERY = 240

export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (!items.length) return []
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (true) {
      const index = next++
      if (index >= items.length) return
      results[index] = await fn(items[index], index)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => worker())
  )
  return results
}

export async function fileBytes(filePath: string): Promise<number> {
  if (!filePath) return 0
  try {
    const info = await stat(toFsPath(filePath))
    if (info.isFile()) return info.size
    if (info.isDirectory()) return await folderBytes(filePath)
  } catch {
    return 0
  }
  return 0
}

async function fileSize(filePath: string): Promise<number> {
  try {
    return (await stat(toFsPath(filePath))).size
  } catch {
    return 0
  }
}

/** Recursive folder size that yields so install/scan work does not freeze the UI. */
export async function folderBytes(dir: string): Promise<number> {
  if (!dir || !pathExists(dir)) return 0
  let total = 0
  let ops = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop() as string
    let entries
    try {
      entries = await readdir(toFsPath(current), { withFileTypes: true })
    } catch {
      continue
    }
    const files: string[] = []
    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..') continue
      const full = childPath(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (!entry.isFile()) continue
      files.push(full)
    }
    for (let offset = 0; offset < files.length; offset += STAT_BATCH) {
      const batch = files.slice(offset, offset + STAT_BATCH)
      const sizes = await Promise.all(batch.map((full) => fileSize(full)))
      for (const size of sizes) total += size
      ops += batch.length
      if (ops >= YIELD_EVERY) {
        ops = 0
        await yieldToEventLoop()
      }
    }
  }
  return total
}
