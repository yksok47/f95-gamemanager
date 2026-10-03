import { describe, expect, test } from 'bun:test'
import {
  countDecompileStarts,
  decompileTimeoutMs,
  decompileWorkerCount,
  extractParallelism,
  extractTimeoutMs,
  partitionByWeight,
  rpyPathFromRpyc
} from './unren-work'

describe('extractParallelism', () => {
  test('keeps a single archive on all threads', () => {
    expect(extractParallelism(1, 8)).toEqual({ archives: 1, threads: 8 })
  })

  test('splits cores across a few archives', () => {
    expect(extractParallelism(8, 8)).toEqual({ archives: 4, threads: 2 })
    expect(extractParallelism(2, 8)).toEqual({ archives: 2, threads: 4 })
  })
})

describe('decompileWorkerCount', () => {
  test('leaves a core for the UI and never exceeds file count', () => {
    expect(decompileWorkerCount(100, 8)).toBe(7)
    expect(decompileWorkerCount(2, 16)).toBe(2)
    expect(decompileWorkerCount(0, 8)).toBe(0)
  })
})

describe('timeouts', () => {
  test('grow with archive size and file count, with floors and caps', () => {
    expect(extractTimeoutMs(0)).toBe(180_000)
    expect(extractTimeoutMs(400 * 1024 * 1024)).toBe(200_000)
    expect(extractTimeoutMs(80 * 1024 * 1024 * 1024)).toBe(40 * 60_000)
    expect(decompileTimeoutMs(1)).toBe(120_000)
    expect(decompileTimeoutMs(10)).toBe(200_000)
    expect(decompileTimeoutMs(10_000)).toBe(45 * 60_000)
  })
})

describe('partitionByWeight', () => {
  test('spreads large files across workers', () => {
    const files = [
      { path: 'a', size: 100 },
      { path: 'b', size: 90 },
      { path: 'c', size: 10 },
      { path: 'd', size: 9 }
    ]
    const parts = partitionByWeight(files, 2, (file) => file.size)
    expect(parts).toHaveLength(2)
    expect(parts[0].map((file) => file.path).sort()).toEqual(['a', 'd'])
    expect(parts[1].map((file) => file.path).sort()).toEqual(['b', 'c'])
  })

  test('drops empty bins and handles tiny lists', () => {
    expect(partitionByWeight([], 4, () => 1)).toEqual([])
    expect(partitionByWeight(['only'], 8, () => 1)).toEqual([['only']])
  })
})

describe('rpyPathFromRpyc', () => {
  test('maps compiled script extensions', () => {
    expect(rpyPathFromRpyc('game/script.rpyc')).toBe('game/script.rpy')
    expect(rpyPathFromRpyc('game/mod.RPYC')).toBe('game/mod.rpy')
    expect(rpyPathFromRpyc('game/lib.rpymc')).toBe('game/lib.rpym')
  })
})

describe('countDecompileStarts', () => {
  test('counts unrpyc progress lines', () => {
    const text = 'Decompiling C:\\game\\a.rpyc to C:\\game\\a.rpy...\nother\nDecompiling /game/b.rpyc to /game/b.rpy...\n'
    expect(countDecompileStarts(text)).toEqual({ count: 2, lastLabel: 'b.rpyc' })
  })
})
