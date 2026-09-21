import { describe, expect, test } from 'bun:test'
import { compareGameVersions } from './engines'

describe('compareGameVersions', () => {
  test('treats Chapter/Ch and Update/Up as the same labels', () => {
    expect(compareGameVersions('Chapter 2 Update 4', 'Ch.2 Up.4')).toBe(0)
    expect(compareGameVersions('Chapter 2 Update 4', 'Ch.2 Up.5')).toBeLessThan(0)
    expect(compareGameVersions('Ch.2 Up.5', 'Chapter 2 Update 4')).toBeGreaterThan(0)
  })

  test('splits letter-digit boundaries so Ch2Up5 is chapter 2 update 5', () => {
    expect(compareGameVersions('Ch2Up5', 'Ch.2 Up.5')).toBe(0)
    expect(compareGameVersions('Ch2Up4', 'Ch2Up5')).toBeLessThan(0)
  })

  test('still compares dotted numbers', () => {
    expect(compareGameVersions('1.0', '1.1')).toBeLessThan(0)
    expect(compareGameVersions('v0.17', '0.17')).toBe(0)
    expect(compareGameVersions('0.4.5a', '0.4.5b')).toBeLessThan(0)
  })
})
