import { describe, expect, test } from 'bun:test'
import { downloadHostPreference, downloadMatchesHostOs, osKindFromNavigator } from './types'

describe('osKindFromNavigator', () => {
  test('maps common platform strings', () => {
    expect(osKindFromNavigator('Win32')).toBe('win')
    expect(osKindFromNavigator('MacIntel', 'Mozilla/5.0 (Macintosh)')).toBe('mac')
    expect(osKindFromNavigator('Linux x86_64', 'Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux')
  })
})

describe('downloadHostPreference', () => {
  test('ranks host OS builds above others', () => {
    expect(downloadHostPreference(['linux'], 'linux')).toBeGreaterThan(
      downloadHostPreference(['win'], 'linux')
    )
    expect(downloadHostPreference([], 'linux')).toBeGreaterThan(downloadHostPreference(['win'], 'linux'))
    expect(downloadMatchesHostOs(['linux', 'win'], 'linux')).toBe(true)
    expect(downloadMatchesHostOs(['win'], 'linux')).toBe(false)
  })
})
