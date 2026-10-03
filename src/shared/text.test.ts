import { describe, expect, test } from 'bun:test'
import { asText } from './text'

describe('asText', () => {
  test('trims strings and stringifies finite numbers', () => {
    expect(asText('  Forest Walk  ')).toBe('Forest Walk')
    expect(asText(365)).toBe('365')
    expect(asText(1.2)).toBe('1.2')
  })

  test('drops non-text values', () => {
    expect(asText(undefined)).toBe('')
    expect(asText(null)).toBe('')
    expect(asText(NaN)).toBe('')
    expect(asText({ en: 'Forest Walk' })).toBe('')
    expect(asText(['Forest Walk'])).toBe('')
  })
})
