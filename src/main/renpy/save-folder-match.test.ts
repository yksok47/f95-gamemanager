import { describe, expect, test } from 'bun:test'
import {
  folderAcronymKey,
  folderSearchQueries,
  matchRenpySaveFolder,
  matchSaveFoldersToGames,
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

describe('scoreSaveFolder', () => {
  test('does not map a developer-named folder onto another game by that studio', () => {
    expect(scoreSaveFolder('TheX', 'The Fixer [v1.0] [TheX]')).toBe(0)
    expect(scoreSaveFolder('TheX', 'The Fixer')).toBe(0)
    expect(scoreSaveFolder('TheFixer', 'The X')).toBe(0)
  })

  test('still matches a folder named after the game', () => {
    expect(scoreSaveFolder('TheFixer', 'The Fixer [v1.0] [TheX]')).toBeGreaterThan(40)
    expect(scoreSaveFolder('TheX', 'The X')).toBeGreaterThan(40)
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

  test('matches nested publisher/game save folders on the leaf name', () => {
    expect(
      matchRenpySaveFolder('Lunars Chosen Episode 2', ['PTGames/Lunars Chosen Episode 2'])
    ).toBe('PTGames/Lunars Chosen Episode 2')
  })
})

describe('folderAcronymKey', () => {
  test('strips RenPy timestamp suffix', () => {
    expect(folderAcronymKey('MBDK-1749650324')).toBe('mbdk')
    expect(folderAcronymKey('MBDS2-1749650324')).toBe('mbds2')
  })
})

describe('matchSaveFoldersToGames', () => {
  const games = [
    { threadId: 1, title: 'My Bimbo Dream: Kingpin [v0.11.5] [MBD]' },
    { threadId: 2, title: 'My Bimbo Dream S2 [v2.0.7] [MBD]' },
    { threadId: 3, title: 'Unrelated Title' }
  ]

  test('assigns each folder to a unique game', () => {
    const matched = matchSaveFoldersToGames(
      ['MBDK-1749650324', 'MBDS2-1749650324', 'nope'],
      games
    )
    const byFolder = Object.fromEntries(matched.map((item) => [item.folderName, item.game.threadId]))
    expect(byFolder).toEqual({
      'MBDK-1749650324': 1,
      'MBDS2-1749650324': 2
    })
  })

  test('leaves a folder unmatched when two titles tie', () => {
    const matched = matchSaveFoldersToGames(['MCG-1749650324'], [
      { threadId: 1, title: 'My Cool Game' },
      { threadId: 2, title: 'My Cool Gameplay' }
    ])
    expect(matched).toEqual([])
  })

  test('lets one game keep multiple matching folders', () => {
    const matched = matchSaveFoldersToGames(
      ['CAG-11111111', 'CAG-22222222', 'Other-1'],
      [{ threadId: 1, title: 'Cool Adventure Game' }]
    )
    expect(matched.map((item) => item.folderName).sort()).toEqual(['CAG-11111111', 'CAG-22222222'])
    expect(matched.every((item) => item.game.threadId === 1)).toBe(true)
  })
})

describe('folderSearchQueries', () => {
  test('strips timestamps and splits camel case', () => {
    expect(folderSearchQueries('BeingADik-1749650324')).toContain('Being A Dik')
  })

  test('searches nested folders by the leaf name', () => {
    expect(folderSearchQueries('PTGames/Lunars Chosen Episode 2')).toContain(
      'Lunars Chosen Episode 2'
    )
  })

  test('keeps acronym folders searchable', () => {
    expect(folderSearchQueries('MBDK-1749650324')).toEqual(['MBDK'])
  })
})
