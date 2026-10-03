import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import { findHtmlEntry } from './html-game/detect'

describe('findHtmlEntry', () => {
  test('picks the root html file over assets and readmes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'html-game-'))
    try {
      await mkdir(join(root, 'resources'), { recursive: true })
      await writeFile(join(root, 'Family business.html'), '<html></html>')
      await writeFile(join(root, 'readme.html'), '<html></html>')
      await writeFile(join(root, 'resources', 'help.html'), '<html></html>')
      const found = findHtmlEntry(root)
      expect(found?.replace(/\\/g, '/').endsWith('/Family business.html')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('prefers index.html in a nested folder when that is the game', async () => {
    const root = await mkdtemp(join(tmpdir(), 'html-index-'))
    try {
      const nested = join(root, 'build')
      await mkdir(nested, { recursive: true })
      await writeFile(join(nested, 'index.html'), '<html></html>')
      const found = findHtmlEntry(root)
      expect(found?.replace(/\\/g, '/').endsWith('/build/index.html')).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('ignores documentation html files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'html-readme-'))
    try {
      await writeFile(join(root, 'readme.html'), '<html></html>')
      expect(findHtmlEntry(root)).toBeNull()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
