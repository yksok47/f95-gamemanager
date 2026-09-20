import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { discoverRenpySaveFolders, isRenpySaveFolder } from './save-folder-scan'

const temps: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'renpy-saves-scan-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('isRenpySaveFolder', () => {
  test('requires a file named persistent', () => {
    const root = tempDir()
    mkdirSync(join(root, 'GAME-1'))
    writeFileSync(join(root, 'GAME-1', '1-1.save'), 'slot')
    expect(isRenpySaveFolder(join(root, 'GAME-1'))).toBe(false)
    writeFileSync(join(root, 'GAME-1', 'persistent'), 'data')
    expect(isRenpySaveFolder(join(root, 'GAME-1'))).toBe(true)
  })

  test('ignores similarly named files', () => {
    const root = tempDir()
    mkdirSync(join(root, 'GAME-1'))
    writeFileSync(join(root, 'GAME-1', 'persistent.bak'), 'data')
    expect(isRenpySaveFolder(join(root, 'GAME-1'))).toBe(false)
  })
})

describe('discoverRenpySaveFolders', () => {
  test('skips folders without persistent and includes nested save folders', () => {
    const root = tempDir()
    mkdirSync(join(root, 'GAME-11111111'))
    writeFileSync(join(root, 'GAME-11111111', 'persistent'), 'data')
    mkdirSync(join(root, 'noise'))
    writeFileSync(join(root, 'noise', 'notes.txt'), 'nope')
    mkdirSync(join(root, 'PTGames', 'Lunars Chosen Episode 2'), { recursive: true })
    writeFileSync(join(root, 'PTGames', 'Lunars Chosen Episode 2', 'persistent'), 'data')
    mkdirSync(join(root, 'PTGames', 'empty-child'), { recursive: true })

    const found = discoverRenpySaveFolders(root).map((folder) => folder.name).sort()
    expect(found).toEqual(['GAME-11111111', join('PTGames', 'Lunars Chosen Episode 2')].sort())
  })

  test('does not recurse when the parent folder itself is a save folder', () => {
    const root = tempDir()
    mkdirSync(join(root, 'GAME-1', 'nested'), { recursive: true })
    writeFileSync(join(root, 'GAME-1', 'persistent'), 'data')
    writeFileSync(join(root, 'GAME-1', 'nested', 'persistent'), 'data')

    expect(discoverRenpySaveFolders(root).map((folder) => folder.name)).toEqual(['GAME-1'])
  })
})
