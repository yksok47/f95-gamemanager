import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import {
  expectedInstallPath,
  installLayoutMatches,
  moveInstallDirectory,
  rebaseAbsolutePath,
  rebasePath
} from './install-layout'
import { pathExists } from './win-path'

async function withTemp(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'install-layout-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

describe('expectedInstallPath', () => {
  test('uses sanitized title and version under the library root', () => {
    const library = join(process.platform === 'win32' ? 'C:\\' : '/', 'Games')
    expect(expectedInstallPath(library, 'Cool Game?', '1.0')).toBe(
      join(library, 'Cool Game_', '1.0')
    )
  })

  test('falls back to unknown when version is empty', () => {
    const library = join(process.platform === 'win32' ? 'C:\\' : '/', 'Games')
    expect(expectedInstallPath(library, 'Title', '')).toBe(join(library, 'Title', 'unknown'))
  })
})

describe('installLayoutMatches', () => {
  test('treats trailing separators as the same folder', () => {
    const dest = join(process.platform === 'win32' ? 'C:\\' : '/', 'Games', 'Title', '1.0')
    expect(installLayoutMatches(dest, dest + (process.platform === 'win32' ? '\\' : '/'))).toBe(true)
    expect(installLayoutMatches(join(dest, 'nested'), dest)).toBe(false)
  })
})

describe('rebasePath', () => {
  test('rewrites the root and nested files, and leaves outsiders alone', () => {
    const from = join(process.platform === 'win32' ? 'D:\\' : '/', 'old', 'Game')
    const to = join(process.platform === 'win32' ? 'C:\\' : '/', 'Games', 'Title', '1.0')
    expect(rebasePath(from, from, to)).toBe(to)
    expect(rebasePath(join(from, 'Game.exe'), from, to)).toBe(join(to, 'Game.exe'))
    expect(rebasePath(join(from, 'game', 'saves'), from, to)).toBe(join(to, 'game', 'saves'))
    expect(rebasePath(join(from, '..', 'other'), from, to)).toBe(join(from, '..', 'other'))
  })

  test('leaves relative RenPy folder names untouched', () => {
    const from = join(process.platform === 'win32' ? 'C:\\' : '/', 'Games', 'Old')
    const to = join(process.platform === 'win32' ? 'C:\\' : '/', 'Games', 'New')
    expect(rebaseAbsolutePath('GAME-1234', from, to)).toBe('GAME-1234')
    expect(rebaseAbsolutePath(join(from, 'game', 'saves'), from, to)).toBe(join(to, 'game', 'saves'))
  })
})

describe('moveInstallDirectory', () => {
  test('moves a sibling folder onto title/version', async () => {
    await withTemp(async (root) => {
      const source = join(root, 'Imported Game')
      const dest = join(root, 'Cool Game', '1.0')
      await mkdir(source)
      await writeFile(join(source, 'game.txt'), 'ok')
      await moveInstallDirectory(source, dest)
      expect(await readFile(join(dest, 'game.txt'), 'utf8')).toBe('ok')
      expect(pathExists(source)).toBe(false)
    })
  })

  test('nests into a version folder inside the current root', async () => {
    await withTemp(async (root) => {
      const source = join(root, 'Cool Game')
      const dest = join(source, '1.0')
      await mkdir(source)
      await writeFile(join(source, 'game.txt'), 'ok')
      await mkdir(join(source, 'game'))
      await writeFile(join(source, 'game', 'script.rpy'), 'label start:\n    return\n')
      await moveInstallDirectory(source, dest)
      expect(await readFile(join(dest, 'game.txt'), 'utf8')).toBe('ok')
      expect(await readFile(join(dest, 'game', 'script.rpy'), 'utf8')).toContain('label start')
      expect(pathExists(join(source, 'game.txt'))).toBe(false)
    })
  })

  test('unwraps a game root nested under the destination', async () => {
    await withTemp(async (root) => {
      const dest = join(root, 'Cool Game', '1.0')
      const source = join(dest, 'Cool Game v1.0')
      await mkdir(source, { recursive: true })
      await writeFile(join(source, 'game.txt'), 'ok')
      await moveInstallDirectory(source, dest)
      expect(await readFile(join(dest, 'game.txt'), 'utf8')).toBe('ok')
      expect(pathExists(source)).toBe(false)
    })
  })

  test('refuses to overwrite a destination that already has files', async () => {
    await withTemp(async (root) => {
      const source = join(root, 'Imported')
      const dest = join(root, 'Cool Game', '1.0')
      await mkdir(source)
      await writeFile(join(source, 'from.txt'), 'a')
      await mkdir(dest, { recursive: true })
      await writeFile(join(dest, 'keep.txt'), 'b')
      await expect(moveInstallDirectory(source, dest)).rejects.toThrow('already exists')
      expect(await readFile(join(source, 'from.txt'), 'utf8')).toBe('a')
      expect(await readFile(join(dest, 'keep.txt'), 'utf8')).toBe('b')
    })
  })
})
