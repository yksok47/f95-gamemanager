import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { findNamedFiles, scanScripts, scanScriptsWithPending } from './scan'

const temps: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'renpy-scan-'))
  temps.push(dir)
  return dir
}

function write(file: string, contents = 'x'): void {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, contents)
}

function names(paths: string[]): string[] {
  return paths.map((file) => basename(file)).sort()
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeGame(): string {
  const root = tempDir()
  const game = join(root, 'game')
  write(join(game, 'options.rpy'))
  write(join(game, 'archive.rpa'), 'rpa')
  write(join(game, 'script.rpy'))
  write(join(game, 'script.rpyc'))
  write(join(game, 'pending.rpyc'))
  write(join(game, 'unren-dev.rpy'))
  write(join(game, 'images', 'bg.png'))
  write(join(game, 'images', 'hidden.rpyc'))
  write(join(game, 'gui', 'button.png'))
  write(join(game, 'tl', 'english', 'script.rpy'))
  write(join(game, 'tl', 'english', 'extra.rpyc'))
  return root
}

describe('scanScripts', () => {
  test('counts scripts without walking asset folders or extra option searches', async () => {
    const root = makeGame()
    const status = await scanScripts(root)
    expect(status.rpaCount).toBe(1)
    expect(status.rpaBytes).toBe(3)
    expect(status.rpyCount).toBe(3)
    expect(status.rpycCount).toBe(3)
    expect(status.rpycWithoutRpy).toBe(2)
    expect(status.optionsRpy).toBe(true)
    expect(status.optionsRpyc).toBe(false)
    expect(status.needsUnpack).toBe(false)
    expect(status.needsDecompile).toBe(true)
    expect(status.alreadyUnpacked).toBe(true)
    expect(status.alreadyDecompiled).toBe(false)
  })

  test('status scan does not collect pending paths', async () => {
    const root = makeGame()
    const scanned = await scanScriptsWithPending(root)
    expect(names(scanned.pendingRpyc.map((file) => file.path))).toEqual(['extra.rpyc', 'pending.rpyc'])
    expect(names(scanned.compiledWithRpy)).toEqual(['script.rpyc'])
    expect(scanned.pendingRpyc.some((file) => file.path.toLowerCase().includes('hidden.rpyc'))).toBe(false)
  })
})

describe('findNamedFiles', () => {
  test('finds options.rpy without descending into images or translations', async () => {
    const root = makeGame()
    const game = join(root, 'game')
    write(join(game, 'images', 'options.rpy'))
    write(join(game, 'tl', 'english', 'options.rpy'))
    const found = await findNamedFiles(game, 'options.rpy')
    expect(found).toHaveLength(1)
    expect(dirname(found[0] || '')).toBe(game)
  })
})
