import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  addTrackedFiles,
  diffNewRels,
  discardSourceFiles,
  mergeTracked,
  parseTrackedFiles,
  recordNewGameFiles,
  retractBlockedReason,
  retractTrackedFiles,
  shouldTrackRel,
  snapshotGameRels,
  toPosixRel,
  trackedCounts,
  trackedFilesPath
} from './unren-files'

const temps: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'unren-files-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('tracked path helpers', () => {
  test('keeps posix relatives inside the game folder', () => {
    const root = tempDir()
    const game = join(root, 'game')
    expect(toPosixRel(game, join(game, 'images', 'a.png'))).toBe('images/a.png')
    expect(toPosixRel(game, join(root, 'other', 'a.png'))).toBeNull()
  })

  test('does not track archives or the manifest itself', () => {
    expect(shouldTrackRel('archive.rpa')).toBe(false)
    expect(shouldTrackRel('archive.rpu')).toBe(false)
    expect(shouldTrackRel('.f95-unren-files.json')).toBe(false)
    expect(shouldTrackRel('script.rpyc')).toBe(true)
    expect(shouldTrackRel('images/bg.png')).toBe(true)
  })

  test('merges and diffs relative paths', () => {
    expect(mergeTracked(['script.rpyc'], ['images/a.png', 'script.rpyc'])).toEqual([
      'images/a.png',
      'script.rpyc'
    ])
    expect(diffNewRels(new Set(['old.rpyc']), new Set(['old.rpyc', 'new.rpyc', 'archive.rpa']))).toEqual([
      'new.rpyc'
    ])
  })

  test('blocks retract when originals were deleted', () => {
    const extracted = {
      version: 1 as const,
      extract: ['bg.png'],
      decompile: ['script.rpy'],
      extractLocked: true,
      decompileLocked: false
    }
    expect(retractBlockedReason(extracted, 'extract', { archiveCount: 1, compiledWithRpy: 1 })).toBe(
      'Cannot remove extracted files after the archives have been deleted.'
    )
    expect(retractBlockedReason(extracted, 'decompile', { archiveCount: 0, compiledWithRpy: 0 })).toBe(
      'Cannot remove decompiled scripts after the compiled scripts have been deleted.'
    )
    expect(
      retractBlockedReason(
        { ...extracted, extractLocked: false, decompileLocked: false },
        'extract',
        { archiveCount: 2, compiledWithRpy: 0 }
      )
    ).toBeNull()
  })

  test('parses unknown json as empty lists', () => {
    expect(parseTrackedFiles(null)).toEqual({
      version: 1,
      extract: [],
      decompile: [],
      extractLocked: false,
      decompileLocked: false
    })
    expect(parseTrackedFiles({ extract: ['a.rpyc', 'a.rpyc'], decompile: [1, 'b.rpy'] })).toEqual({
      version: 1,
      extract: ['a.rpyc'],
      decompile: ['b.rpy'],
      extractLocked: false,
      decompileLocked: false
    })
    expect(
      parseTrackedFiles({ extract: ['a.png'], extractLocked: true, decompileLocked: 1 })
    ).toEqual({
      version: 1,
      extract: ['a.png'],
      decompile: [],
      extractLocked: true,
      decompileLocked: true
    })
  })
})

describe('tracked file persistence', () => {
  test('snapshots new files, records them, and retracts only those files', async () => {
    const root = tempDir()
    const game = join(root, 'game')
    mkdirSync(join(game, 'images'), { recursive: true })
    writeFileSync(join(game, 'keep.rpy'), 'label start:\n    return\n')
    writeFileSync(join(game, 'archive.rpa'), 'rpa')
    const before = await snapshotGameRels(game)

    writeFileSync(join(game, 'script.rpyc'), 'rpyc')
    writeFileSync(join(game, 'images', 'bg.png'), 'img')
    writeFileSync(join(game, 'archive.rpa'), 'rpa2')
    const added = await recordNewGameFiles(root, 'extract', before)
    expect(added).toEqual(['images/bg.png', 'script.rpyc'])

    await addTrackedFiles(root, 'decompile', ['script.rpy'])
    writeFileSync(join(game, 'script.rpy'), 'label start:\n    return\n')
    expect(trackedCounts(parseTrackedFiles(JSON.parse(readFileSync(trackedFilesPath(root), 'utf8'))))).toEqual({
      extract: 2,
      decompile: 1,
      extractLocked: false,
      decompileLocked: false
    })

    const extracted = await retractTrackedFiles(root, 'extract')
    expect(extracted.removed).toBe(2)
    expect(extracted.remaining).toEqual({
      version: 1,
      extract: [],
      decompile: ['script.rpy'],
      extractLocked: false,
      decompileLocked: false
    })
    expect(readFileSync(join(game, 'keep.rpy'), 'utf8')).toContain('label start')
    expect(readFileSync(join(game, 'archive.rpa'), 'utf8')).toBe('rpa2')
    expect(readFileSync(join(game, 'script.rpy'), 'utf8')).toContain('label start')

    writeFileSync(join(game, 'script.rpyc'), 'rpyc')
    const decompiled = await retractTrackedFiles(root, 'decompile')
    expect(decompiled.removed).toBe(1)
    expect(decompiled.remaining).toEqual({
      version: 1,
      extract: [],
      decompile: [],
      extractLocked: false,
      decompileLocked: false
    })
  })

  test('removes empty folders left behind by retract', async () => {
    const root = tempDir()
    const game = join(root, 'game')
    mkdirSync(join(game, 'images', 'bg'), { recursive: true })
    writeFileSync(join(game, 'archive.rpa'), 'rpa')
    writeFileSync(join(game, 'images', 'bg', 'room.png'), 'img')
    await addTrackedFiles(root, 'extract', ['images/bg/room.png'])
    await retractTrackedFiles(root, 'extract')
    expect(await snapshotGameRels(game)).toEqual(new Set())
    expect(readFileSync(join(game, 'archive.rpa'), 'utf8')).toBe('rpa')
  })

  test('deleting archives locks removal of extracted files', async () => {
    const root = tempDir()
    const game = join(root, 'game')
    mkdirSync(game, { recursive: true })
    writeFileSync(join(game, 'archive.rpa'), 'rpa')
    writeFileSync(join(game, 'script.rpyc'), 'rpyc')
    writeFileSync(join(game, 'bg.png'), 'img')
    await addTrackedFiles(root, 'extract', ['script.rpyc', 'bg.png'])

    const discarded = await discardSourceFiles(root, 'extract')
    expect(discarded.removed).toBe(1)
    expect(discarded.remaining.extractLocked).toBe(true)
    expect(existsSync(join(game, 'archive.rpa'))).toBe(false)
    expect(readFileSync(join(game, 'bg.png'), 'utf8')).toBe('img')

    await expect(retractTrackedFiles(root, 'extract')).rejects.toThrow(
      'Cannot remove extracted files after the archives have been deleted.'
    )
    expect(readFileSync(join(game, 'bg.png'), 'utf8')).toBe('img')
  })

  test('deleting compiled scripts locks removal of decompiled scripts', async () => {
    const root = tempDir()
    const game = join(root, 'game')
    mkdirSync(game, { recursive: true })
    writeFileSync(join(game, 'script.rpyc'), 'rpyc')
    writeFileSync(join(game, 'script.rpy'), 'label start:\n    return\n')
    writeFileSync(join(game, 'pending.rpyc'), 'rpyc')
    await addTrackedFiles(root, 'decompile', ['script.rpy'])

    const discarded = await discardSourceFiles(root, 'decompile')
    expect(discarded.removed).toBe(1)
    expect(discarded.remaining.decompileLocked).toBe(true)
    expect(existsSync(join(game, 'script.rpyc'))).toBe(false)
    expect(existsSync(join(game, 'pending.rpyc'))).toBe(true)

    await expect(retractTrackedFiles(root, 'decompile')).rejects.toThrow(
      'Cannot remove decompiled scripts after the compiled scripts have been deleted.'
    )
    expect(readFileSync(join(game, 'script.rpy'), 'utf8')).toContain('label start')
  })

  test('does not delete archives before they have been extracted', async () => {
    const root = tempDir()
    const game = join(root, 'game')
    mkdirSync(game, { recursive: true })
    writeFileSync(join(game, 'archive.rpa'), 'rpa')
    await expect(discardSourceFiles(root, 'extract')).rejects.toThrow(
      'Extract the archives before deleting them.'
    )
    expect(readFileSync(join(game, 'archive.rpa'), 'utf8')).toBe('rpa')
  })

  test('does not delete compiled scripts before they have been decompiled', async () => {
    const root = tempDir()
    const game = join(root, 'game')
    mkdirSync(game, { recursive: true })
    writeFileSync(join(game, 'script.rpyc'), 'rpyc')
    await expect(discardSourceFiles(root, 'decompile')).rejects.toThrow(
      'Decompile the compiled scripts before deleting them.'
    )
    expect(readFileSync(join(game, 'script.rpyc'), 'utf8')).toBe('rpyc')
  })

  test('recording new extracted files unlocks archive deletion', async () => {
    const root = tempDir()
    const game = join(root, 'game')
    mkdirSync(game, { recursive: true })
    writeFileSync(join(game, 'archive.rpa'), 'rpa')
    writeFileSync(join(game, 'script.rpyc'), 'rpyc')
    writeFileSync(join(game, 'bg.png'), 'img')
    await addTrackedFiles(root, 'extract', ['bg.png'])
    await discardSourceFiles(root, 'extract')
    writeFileSync(join(game, 'archive.rpa'), 'rpa')
    const unlocked = await addTrackedFiles(root, 'extract', ['script.rpyc'])
    expect(unlocked.extractLocked).toBe(false)
    const extracted = await retractTrackedFiles(root, 'extract')
    expect(extracted.removed).toBe(2)
  })
})
