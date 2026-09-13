import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import {
  entriesSuggestUncensorInstall,
  findPatchGameDirs,
  findRenpyScripts,
  planUncensorPatch,
  applyUncensorPatchToGameDir,
  removeUncensorPatchFromGameDir
} from './uncensor-patch'

const temps: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'uncensor-test-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('planUncensorPatch', () => {
  test('merges when a game folder is present', () => {
    const root = tempDir()
    const game = join(root, 'wrapper', 'game')
    mkdirSync(game, { recursive: true })
    writeFileSync(join(game, 'uncensor.rpy'), 'label start:\n    return\n')
    const plan = planUncensorPatch(root)
    expect(plan.mode).toBe('merge-game')
    if (plan.mode === 'merge-game') {
      expect(plan.sourceGameDir.toLowerCase()).toBe(game.toLowerCase())
    }
  })

  test('copies scripts when there is no game folder', () => {
    const root = tempDir()
    const nested = join(root, 'patchpack')
    mkdirSync(nested, { recursive: true })
    writeFileSync(join(nested, 'uncensor.rpy'), 'label start:\n    return\n')
    writeFileSync(join(nested, 'readme.txt'), 'hi')
    const plan = planUncensorPatch(root)
    expect(plan.mode).toBe('scripts')
    if (plan.mode === 'scripts') {
      expect(plan.files).toHaveLength(1)
      expect(plan.files[0].relative.toLowerCase()).toBe('uncensor.rpy')
    }
  })

  test('finds scripts and game dirs', () => {
    const root = tempDir()
    mkdirSync(join(root, 'game'), { recursive: true })
    writeFileSync(join(root, 'game', 'a.rpyc'), 'x')
    writeFileSync(join(root, 'loose.rpy'), 'y')
    expect(findPatchGameDirs(root).some((dir) => /game$/i.test(dir))).toBe(true)
    expect(findRenpyScripts(root).length).toBeGreaterThanOrEqual(2)
  })
})

describe('entriesSuggestUncensorInstall', () => {
  test('accepts game folder layouts and script files', () => {
    expect(entriesSuggestUncensorInstall(['wrapper/game/uncensor.rpy'])).toBe(true)
    expect(entriesSuggestUncensorInstall(['uncensor.rpy'])).toBe(true)
    expect(entriesSuggestUncensorInstall(['readme.txt', 'images/a.png'])).toBe(false)
  })
})

describe('apply and remove uncensor patch', () => {
  test('backs up conflicts and uninstall restores them', async () => {
    const root = tempDir()
    const gameDir = join(root, 'game')
    const tmpParent = join(root, 'tmp')
    mkdirSync(gameDir, { recursive: true })
    mkdirSync(tmpParent, { recursive: true })
    writeFileSync(join(gameDir, 'script.rpy'), 'original\n')

    const patchFile = join(root, 'uncensor.rpy')
    writeFileSync(patchFile, 'patched\n')
    // Installing a script named uncensor.rpy should add a new file.
    // Also overwrite script.rpy via a second apply using merge of two files — use archive-less
    // path: write a staged folder isn't needed; apply single script.
    await applyUncensorPatchToGameDir(patchFile, gameDir, tmpParent, {
      patchId: 'gf-1',
      hash: 'abc123hash',
      filename: 'uncensor.rpy'
    })

    expect(readFileSync(join(gameDir, 'uncensor.rpy'), 'utf8')).toBe('patched\n')
    const instructions = join(gameDir, '.uninstall', 'abc123hash', 'instructions.json')
    expect(existsSync(instructions)).toBe(true)
    const manifest = JSON.parse(readFileSync(instructions, 'utf8')) as {
      remove: string[]
      restore: string[]
    }
    expect(manifest.remove).toContain('uncensor.rpy')
    expect(manifest.restore).toEqual([])

    // Overwrite an existing file with another patch script named script.rpy
    const overwrite = join(root, 'script.rpy')
    writeFileSync(overwrite, 'from-patch\n')
    await applyUncensorPatchToGameDir(overwrite, gameDir, tmpParent, {
      patchId: 'gf-2',
      hash: 'def456hash',
      filename: 'script.rpy'
    })
    expect(readFileSync(join(gameDir, 'script.rpy'), 'utf8')).toBe('from-patch\n')
    const backup = join(gameDir, '.uninstall', 'def456hash', 'backup', 'script.rpy.f95bak')
    expect(existsSync(backup)).toBe(true)
    expect(readFileSync(backup, 'utf8')).toBe('original\n')

    await removeUncensorPatchFromGameDir(gameDir, { hash: 'def456hash' })
    expect(readFileSync(join(gameDir, 'script.rpy'), 'utf8')).toBe('original\n')
    expect(existsSync(join(gameDir, '.uninstall', 'def456hash'))).toBe(false)

    await removeUncensorPatchFromGameDir(gameDir, { hash: 'abc123hash' })
    expect(existsSync(join(gameDir, 'uncensor.rpy'))).toBe(false)
  })
})
