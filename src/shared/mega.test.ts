import { describe, expect, test } from 'bun:test'
import { isMegaPageUrl, listMegaFiles, megaHasKey, parseMegaLink } from './mega'

describe('isMegaPageUrl', () => {
  test('matches file and folder shares', () => {
    expect(isMegaPageUrl('https://mega.nz/file/abc#key')).toBe(true)
    expect(isMegaPageUrl('https://mega.io/folder/abc#key/file/def')).toBe(true)
    expect(isMegaPageUrl('https://mega.co.nz/#!abc!key')).toBe(true)
  })

  test('rejects unrelated pages', () => {
    expect(isMegaPageUrl('https://mega.nz/')).toBe(false)
    expect(isMegaPageUrl('https://pixeldrain.com/u/abc')).toBe(false)
  })
})

describe('megaHasKey', () => {
  test('requires the fragment key', () => {
    expect(megaHasKey('https://mega.nz/file/abc#decryptionkey')).toBe(true)
    expect(megaHasKey('https://mega.nz/file/abc')).toBe(false)
  })
})

describe('parseMegaLink', () => {
  test('parses current file and folder links', () => {
    expect(parseMegaLink('https://mega.nz/file/W6YSgByQ#EpWj2Wbw-CnT_W8')).toEqual({
      kind: 'file',
      id: 'W6YSgByQ',
      key: 'EpWj2Wbw-CnT_W8'
    })
    expect(parseMegaLink('https://mega.nz/folder/6MoiDDIL#scWhno54XeDeKVMNyNEqlQ')).toEqual({
      kind: 'folder',
      id: '6MoiDDIL',
      key: 'scWhno54XeDeKVMNyNEqlQ'
    })
    expect(parseMegaLink('https://mega.nz/folder/6MoiDDIL#scWhno54/file/iZQ1wQ5Y')).toEqual({
      kind: 'folder',
      id: '6MoiDDIL',
      key: 'scWhno54',
      node: 'iZQ1wQ5Y'
    })
    expect(parseMegaLink('https://mega.nz/embed/abc#key')).toEqual({ kind: 'file', id: 'abc', key: 'key' })
  })

  test('parses legacy hash links', () => {
    expect(parseMegaLink('https://mega.co.nz/#!abc!key')).toEqual({ kind: 'file', id: 'abc', key: 'key' })
    expect(parseMegaLink('https://mega.nz/#F!abc!key')).toEqual({ kind: 'folder', id: 'abc', key: 'key' })
    expect(parseMegaLink('https://mega.nz/#F!abc!key!sub')).toEqual({
      kind: 'folder',
      id: 'abc',
      key: 'key',
      node: 'sub'
    })
  })

  test('rejects links without a key or off MEGA', () => {
    expect(parseMegaLink('https://mega.nz/file/abc')).toBeNull()
    expect(parseMegaLink('https://mega.nz/#!abc')).toBeNull()
    expect(parseMegaLink('https://example.com/file/abc#key')).toBeNull()
  })
})

describe('listMegaFiles', () => {
  test('returns a single file as-is', () => {
    expect(listMegaFiles({ name: 'Game.zip', size: 10 })).toEqual([{ name: 'Game.zip', size: 10 }])
  })

  test('flattens nested folder files', () => {
    const files = listMegaFiles({
      directory: true,
      children: [
        { name: 'readme.txt', size: 12 },
        { name: 'Game-Win.zip', size: 800 },
        { directory: true, children: [{ name: 'Game-Linux.zip', size: 20 }] }
      ]
    })
    expect(files.map((file) => file.name)).toEqual(['readme.txt', 'Game-Win.zip', 'Game-Linux.zip'])
  })
})
