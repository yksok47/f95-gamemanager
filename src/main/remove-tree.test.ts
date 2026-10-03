import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { removeTree } from './remove-tree'
import { pathExists } from './win-path'

describe('removeTree', () => {
  test('is a no-op for a missing path', async () => {
    await removeTree(join(tmpdir(), `missing-remove-${Date.now()}`))
  })

  test('deletes a nested tree of many small files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'remove-tree-'))
    for (let i = 0; i < 8; i++) {
      const dir = join(root, `pack-${i}`, 'nested')
      await mkdir(dir, { recursive: true })
      await Promise.all(
        Array.from({ length: 40 }, (_, n) => writeFile(join(dir, `f-${n}.rpy`), `label ${i}_${n}\n`))
      )
    }
    await writeFile(join(root, 'readme.txt'), 'gone')
    await removeTree(root)
    expect(pathExists(root)).toBe(false)
  })

  test('deletes a single file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'remove-file-'))
    const file = join(dir, 'archive.zip')
    await writeFile(file, 'zip')
    await removeTree(file)
    expect(pathExists(file)).toBe(false)
    expect(pathExists(dir)).toBe(true)
    await removeTree(dir)
  })

  test('deletes a folder whose name has spaces', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'remove-space-'))
    const dir = join(parent, 'Some Game Title')
    await mkdir(dir)
    await writeFile(join(dir, 'game.exe'), 'x')
    await removeTree(dir)
    expect(pathExists(dir)).toBe(false)
    await removeTree(parent)
  })
})
