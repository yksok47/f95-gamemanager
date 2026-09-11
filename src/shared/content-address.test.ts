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
