import { describe, expect, test } from 'vitest'
import {
  folderAcronymKey,
  matchRenpySaveFolder,
  scoreSaveFolder,
  titleAcronyms
} from './save-folder-match'

describe('titleAcronyms', () => {
  test('builds Kingpin-style acronyms', () => {
    expect(titleAcronyms('My Bimbo Dream: Kingpin [v0.11.5] [MBD]')).toContain('mbdk')
  })

  test('keeps digit suffixes like S2', () => {
    expect(titleAcronyms('My Bimbo Dream S2')).toContain('mbds2')
  })
})

describe('matchRenpySaveFolder', () => {
  const folders = ['MBDK-1749650324', 'MBDS2-1749650324', 'SomeOtherGame-1', 'unrelated']

  test('finds My Bimbo Dream Kingpin → MBDK', () => {
    expect(matchRenpySaveFolder('My Bimbo Dream: Kingpin [v0.11.5] [MBD]', folders)).toBe(
      'MBDK-1749650324'
    )
  })

  test('finds My Bimbo Dream S2 → MBDS2', () => {
    expect(matchRenpySaveFolder('My Bimbo Dream S2 [v2.0.7] [MBD]', folders)).toBe('MBDS2-1749650324')
  })

  test('does not confuse prequel title with Kingpin folder', () => {
    const scoreKingpin = scoreSaveFolder('MBDK-1749650324', 'My Bimbo Dream S2')
    const scoreS2 = scoreSaveFolder('MBDS2-1749650324', 'My Bimbo Dream S2')
    expect(scoreS2).toBeGreaterThan(scoreKingpin)
  })

  test('returns null when ambiguous weak matches', () => {
    expect(matchRenpySaveFolder('ZZ', ['AAA', 'BBB'])).toBeNull()
  })
})

describe('folderAcronymKey', () => {
  test('strips RenPy timestamp suffix', () => {
    expect(folderAcronymKey('MBDK-1749650324')).toBe('mbdk')
    expect(folderAcronymKey('MBDS2-1749650324')).toBe('mbds2')
  })
})
