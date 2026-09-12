import { describe, expect, test } from 'bun:test'
import { isContentHash, isInfoHash, normalizeInfoHash, normalizePackageFilename } from './content-address'

describe('normalizePackageFilename', () => {
  test('lowercases basename and collapses whitespace', () => {
    expect(normalizePackageFilename('C:\\\\Games\\\\My  Game.ZIP')).toBe('my game.zip')
    expect(normalizePackageFilename('/tmp/Foo   Bar.rar')).toBe('foo bar.rar')
  })

  test('strips unsafe filename characters', () => {
    expect(normalizePackageFilename('a<b>|c?.7z')).toBe('abc.7z')
  })

  test('handles bare names', () => {
    expect(normalizePackageFilename('Package.Zip')).toBe('package.zip')
  })
})

describe('hash validators', () => {
  test('isContentHash requires 64 hex', () => {
    expect(isContentHash('a'.repeat(64))).toBe(true)
    expect(isContentHash('A'.repeat(64))).toBe(true)
    expect(isContentHash('a'.repeat(63))).toBe(false)
    expect(isContentHash(null)).toBe(false)
  })

  test('isInfoHash requires 40 hex', () => {
    expect(isInfoHash('b'.repeat(40))).toBe(true)
    expect(isInfoHash('b'.repeat(41))).toBe(false)
    expect(isInfoHash(undefined)).toBe(false)
  })
})

test('normalizeInfoHash lowercases 40-char hex', () => {
  expect(normalizeInfoHash('AABBCCDDEEFF00112233445566778899AABBCCDD')).toBe(
    'aabbccddeeff00112233445566778899aabbccdd'
  )
  expect(normalizeInfoHash('urn:btih:aabbccddeeff00112233445566778899aabbccdd')).toBe(
    'aabbccddeeff00112233445566778899aabbccdd'
  )
  expect(normalizeInfoHash('not-a-hash')).toBeNull()
})

test('normalizeInfoHash accepts 20-byte buffers from WebTorrent', () => {
  const hex = 'aabbccddeeff00112233445566778899aabbccdd'
  const bytes = Uint8Array.from({ length: 20 }, (_, i) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16))
  expect(normalizeInfoHash(bytes)).toBe(hex)
  expect(normalizeInfoHash(Buffer.from(bytes))).toBe(hex)
  expect(normalizeInfoHash(new Uint8Array(19))).toBeNull()
})
