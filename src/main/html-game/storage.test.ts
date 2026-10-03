import { describe, expect, test } from 'bun:test'
import {
  mergeHtmlStorage,
  parseHtmlStorageDump,
  serializeHtmlStorageDump,
  htmlStorageBytes
} from './storage'

describe('html storage dump', () => {
  test('round-trips keys and ignores non-string values', () => {
    const raw = serializeHtmlStorageDump({
      savedAt: 42,
      keys: { Save1: '{"day":1}', notes: 'hello' }
    })
    expect(parseHtmlStorageDump(raw)).toEqual({
      savedAt: 42,
      keys: { Save1: '{"day":1}', notes: 'hello' }
    })
    expect(parseHtmlStorageDump('{"Save1":"x"}')?.keys).toEqual({ Save1: 'x' })
    expect(parseHtmlStorageDump('not json')).toBeNull()
  })

  test('live keys win when merging a backup into an existing store', () => {
    expect(mergeHtmlStorage({ Save1: 'new' }, { Save1: 'old', Save2: 'keep' })).toEqual({
      Save1: 'new',
      Save2: 'keep'
    })
    expect(htmlStorageBytes({ a: 'bb' })).toBe(3)
  })
})
