import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import {
  looksLikeVersion,
  parseImportName,
  parseInstallFolderGuess,
  scoreImportTitle
} from './library-import-parse'
import { CONTENT_KIND_IDS, OS_KIND_IDS } from '@shared/types'

describe('parseImportName', () => {
  test('reads title, version, OS, and kind from a typical archive name', () => {
    expect(parseImportName('Being a DIK-0.9.1-win.zip')).toEqual({
      title: 'Being a DIK',
      version: '0.9.1',
      os: [OS_KIND_IDS.win],
      contentKind: CONTENT_KIND_IDS.game
    })
  })

  test('maps pc to Windows and uncensor tokens to the uncensor kind', () => {
    const parsed = parseImportName('Game_Name_Uncensor_v1.2_Linux.7z')
    expect(parsed.title).toBe('Game Name')
    expect(parsed.version).toBe('1.2')
    expect(parsed.os).toEqual([OS_KIND_IDS.linux])
    expect(parsed.contentKind).toBe(CONTENT_KIND_IDS.uncensor)
  })

  test('strips [F95] tags and treats pc as Windows', () => {
    const parsed = parseImportName('[F95] Summer Camp 1.0.0 pc.rar')
    expect(parsed.title).toBe('Summer Camp')
    expect(parsed.version).toBe('1.0.0')
    expect(parsed.os).toEqual([OS_KIND_IDS.win])
  })
})

describe('parseInstallFolderGuess', () => {
  test('uses parent folder as title when the leaf looks like a version', () => {
    const parsed = parseInstallFolderGuess(join('/Games', 'Being a DIK', '0.9.1'))
    expect(parsed.title).toBe('Being a DIK')
    expect(parsed.version).toBe('0.9.1')
  })

  test('looksLikeVersion accepts dotted builds', () => {
    expect(looksLikeVersion('0.9.1')).toBe(true)
    expect(looksLikeVersion('v1.2.3a')).toBe(true)
    expect(looksLikeVersion('Being a DIK')).toBe(false)
  })
})

describe('scoreImportTitle', () => {
  test('scores an archive stem against the catalog title', () => {
    expect(scoreImportTitle('Being a DIK-0.9.1-win.zip', 'Being a DIK')).toBeGreaterThanOrEqual(90)
    expect(scoreImportTitle('Other Game-1.0-win.zip', 'Being a DIK')).toBeLessThan(40)
  })
})
