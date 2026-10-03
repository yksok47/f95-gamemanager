import { availableParallelism, cpus } from 'os'

export type WeightedPath = {
  path: string
  size: number
}

export function cpuCount(): number {
  try {
    if (typeof availableParallelism === 'function') return Math.max(1, availableParallelism())
  } catch {
    // fall through
  }
  return Math.max(1, cpus()?.length || 1)
}

/** How many RPA processes to run at once, and how many reader threads each should use. */
export function extractParallelism(
  archiveCount: number,
  cpus = cpuCount()
): { archives: number; threads: number } {
  const archives = Math.max(1, Math.min(archiveCount, Math.min(4, cpus)))
  const threads = Math.max(1, Math.min(12, Math.ceil(cpus / archives)))
  return { archives, threads }
}

export function decompileWorkerCount(fileCount: number, cpus = cpuCount()): number {
  if (fileCount <= 0) return 0
  return Math.min(fileCount, Math.max(1, cpus - 1))
}

export function extractTimeoutMs(size: number): number {
  const mb = Math.max(1, size / (1024 * 1024))
  return Math.min(40 * 60_000, Math.max(180_000, Math.round(mb * 500)))
}

export function decompileTimeoutMs(fileCount: number): number {
  return Math.min(45 * 60_000, Math.max(120_000, 20_000 * Math.max(1, fileCount)))
}

export function rpyPathFromRpyc(rpycPath: string): string {
  return rpycPath.replace(/\.rpymc$/i, '.rpym').replace(/\.rpyc$/i, '.rpy')
}

export function partitionByWeight<T>(
  items: readonly T[],
  parts: number,
  weightOf: (item: T) => number
): T[][] {
  if (!items.length) return []
  const n = Math.max(1, Math.min(Math.floor(parts) || 1, items.length))
  const bins = Array.from({ length: n }, () => ({ items: [] as T[], weight: 0 }))
  const sorted = [...items].sort((a, b) => weightOf(b) - weightOf(a))
  for (const item of sorted) {
    let best = bins[0]
    for (const bin of bins) {
      if (bin.weight < best.weight) best = bin
    }
    best.items.push(item)
    best.weight += Math.max(1, weightOf(item) || 0)
  }
  return bins.map((bin) => bin.items).filter((chunk) => chunk.length > 0)
}

export function countDecompileStarts(chunk: string): { count: number; lastLabel: string | null } {
  const re = /^Decompiling (.+?) to /gm
  let count = 0
  let lastLabel: string | null = null
  let match: RegExpExecArray | null
  while ((match = re.exec(chunk))) {
    count += 1
    const source = match[1].replace(/\\/g, '/')
    lastLabel = source.slice(source.lastIndexOf('/') + 1) || source
  }
  return { count, lastLabel }
}
