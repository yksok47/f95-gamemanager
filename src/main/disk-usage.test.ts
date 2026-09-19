import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import { fileBytes, folderBytes, mapLimit } from './disk-usage'

describe('mapLimit', () => {
  test('preserves order with a concurrency cap', async () => {
    const seen: number[] = []
    const result = await mapLimit([3, 2, 1], 2, async (value) => {
      seen.push(value)
      await new Promise((resolve) => setTimeout(resolve, value * 5))
      return value * 10
    })
    expect(result).toEqual([30, 20, 10])
    expect(seen).toHaveLength(3)
  })
})

describe('folderBytes', () => {
  test('returns 0 for a missing path', async () => {
    expect(await folderBytes(join(tmpdir(), `missing-storage-${Date.now()}`))).toBe(0)
    expect(await fileBytes('')).toBe(0)
  })

  test('sums nested files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'storage-scan-'))
    try {
      await writeFile(join(root, 'a.txt'), '12345')
      await mkdir(join(root, 'nested'))
      await writeFile(join(root, 'nested', 'b.txt'), 'abcdefghij')
      expect(await folderBytes(root)).toBe(15)
      expect(await fileBytes(join(root, 'a.txt'))).toBe(5)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
