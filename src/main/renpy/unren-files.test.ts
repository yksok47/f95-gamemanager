import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  addTrackedFiles,
  diffNewRels,
  mergeTracked,
  parseTrackedFiles,
  recordNewGameFiles,
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

  test('parses unknown json as empty lists', () => {
    expect(parseTrackedFiles(null)).toEqual({ version: 1, extract: [], decompile: [] })
    expect(parseTrackedFiles({ extract: ['a.rpyc', 'a.rpyc'], decompile: [1, 'b.rpy'] })).toEqual({
      version: 1,
      extract: ['a.rpyc'],
      decompile: ['b.rpy']
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
      decompile: 1
    })

    const extracted = await retractTrackedFiles(root, 'extract')
    expect(extracted.removed).toBe(2)
    expect(extracted.remaining).toEqual({ version: 1, extract: [], decompile: ['script.rpy'] })
    expect(readFileSync(join(game, 'keep.rpy'), 'utf8')).toContain('label start')
    expect(readFileSync(join(game, 'archive.rpa'), 'utf8')).toBe('rpa2')
    expect(readFileSync(join(game, 'script.rpy'), 'utf8')).toContain('label start')

    const decompiled = await retractTrackedFiles(root, 'decompile')
    expect(decompiled.removed).toBe(1)
    expect(decompiled.remaining).toEqual({ version: 1, extract: [], decompile: [] })
  })

  test('removes empty folders left behind by retract', async () => {
    const root = tempDir()
    const game = join(root, 'game')
    mkdirSync(join(game, 'images', 'bg'), { recursive: true })
    writeFileSync(join(game, 'images', 'bg', 'room.png'), 'img')
    await addTrackedFiles(root, 'extract', ['images/bg/room.png'])
    await retractTrackedFiles(root, 'extract')
    expect(await snapshotGameRels(game)).toEqual(new Set())
  })
})
