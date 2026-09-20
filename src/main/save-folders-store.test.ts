import { describe, expect, test } from 'bun:test'
import type { IdentifiedSaveFolder } from '@shared/types'
import {
  identifiedSaveFoldersForGame,
  mergeIdentifiedSaveFolder,
  pickIdentifiedSaveFolder,
  renpySaveLocationOptions,
  sameIdentifiedSaveFolder
} from './save-folder-meta'

function folder(
  partial: Partial<IdentifiedSaveFolder> & Pick<IdentifiedSaveFolder, 'title' | 'threadId' | 'savePath'>
): IdentifiedSaveFolder {
  return {
    coverUrl: null,
    folderName: partial.title,
    identifiedAt: 1,
    ...partial
  }
}

describe('mergeIdentifiedSaveFolder', () => {
  test('keeps catalog snapshot when a later match only has a title', () => {
    const prev = folder({
      title: 'Game',
      threadId: 4,
      savePath: 'C:\\saves\\game',
      creator: 'Author',
      coverUrl: 'https://cdn.test/c.jpg',
      prefixes: [1],
      tags: [8],
      rating: 4.2
    })
    const merged = mergeIdentifiedSaveFolder(
      prev,
      folder({ title: 'Game', threadId: 4, savePath: 'C:\\saves\\game', identifiedAt: 9 })
    )
    expect(merged.creator).toBe('Author')
    expect(merged.coverUrl).toBe('https://cdn.test/c.jpg')
    expect(merged.prefixes).toEqual([1])
    expect(merged.tags).toEqual([8])
    expect(merged.rating).toBe(4.2)
    expect(merged.identifiedAt).toBe(9)
  })
})

describe('sameIdentifiedSaveFolder', () => {
  test('ignores identifiedAt so rescans do not look like new mappings', () => {
    const prev = folder({
      title: 'Game',
      threadId: 4,
      savePath: 'C:\\saves\\game',
      creator: 'Author',
      coverUrl: 'https://cdn.test/c.jpg',
      identifiedAt: 1
    })
    const next = mergeIdentifiedSaveFolder(
      prev,
      folder({
        title: 'Game',
        threadId: 4,
        savePath: 'C:\\saves\\game',
        identifiedAt: Date.now()
      })
    )
    expect(sameIdentifiedSaveFolder(prev, next)).toBe(true)
  })

  test('detects a real mapping change', () => {
    const prev = folder({ title: 'Game', threadId: 4, savePath: 'C:\\saves\\game' })
    const next = folder({ title: 'Other', threadId: 8, savePath: 'C:\\saves\\game' })
    expect(sameIdentifiedSaveFolder(prev, next)).toBe(false)
    expect(sameIdentifiedSaveFolder(undefined, next)).toBe(false)
  })
})

describe('identifiedSaveFoldersForGame', () => {
  test('returns every folder for a thread, newest first', () => {
    const older = folder({
      title: 'Game',
      threadId: 4,
      savePath: 'C:\\saves\\old',
      identifiedAt: 2
    })
    const newer = folder({
      title: 'Game',
      threadId: 4,
      savePath: 'C:\\saves\\new',
      identifiedAt: 9
    })
    const other = folder({ title: 'Other', threadId: 8, savePath: 'C:\\saves\\other', identifiedAt: 20 })
    expect(identifiedSaveFoldersForGame([older, newer, other], 4).map((item) => item.savePath)).toEqual([
      'C:\\saves\\new',
      'C:\\saves\\old'
    ])
  })

  test('pickIdentifiedSaveFolder uses the newest thread match', () => {
    const folders = [
      folder({ title: 'Game', threadId: 4, savePath: 'C:\\saves\\old', identifiedAt: 2 }),
      folder({ title: 'Game', threadId: 4, savePath: 'C:\\saves\\new', identifiedAt: 9 })
    ]
    expect(pickIdentifiedSaveFolder(folders, 4)?.savePath).toBe('C:\\saves\\new')
  })

  test('switching the active folder follows the later identifiedAt', () => {
    const first = folder({
      title: 'Game',
      threadId: 4,
      savePath: 'C:\\saves\\first',
      identifiedAt: 2
    })
    const second = folder({
      title: 'Game',
      threadId: 4,
      savePath: 'C:\\saves\\second',
      identifiedAt: 9
    })
    expect(pickIdentifiedSaveFolder([first, second], 4)?.savePath).toBe('C:\\saves\\second')
    expect(
      pickIdentifiedSaveFolder([{ ...first, identifiedAt: 20 }, second], 4)?.savePath
    ).toBe('C:\\saves\\first')
  })

  test('does not pick an ambiguous title-only match', () => {
    const folders = [
      folder({ title: 'Game', threadId: 4, savePath: 'C:\\saves\\a', identifiedAt: 2 }),
      folder({ title: 'Game', threadId: 5, savePath: 'C:\\saves\\b', identifiedAt: 9 })
    ]
    expect(pickIdentifiedSaveFolder(folders, 0, 'Game')).toBeNull()
    expect(identifiedSaveFoldersForGame(folders, 0, 'Game')).toHaveLength(2)
  })
})

describe('renpySaveLocationOptions', () => {
  test('puts the active path first and includes it when it is not identified yet', () => {
    const identified = [
      folder({ title: 'Game', threadId: 4, savePath: 'C:\\saves\\old', folderName: 'old', identifiedAt: 2 }),
      folder({ title: 'Game', threadId: 4, savePath: 'C:\\saves\\new', folderName: 'new', identifiedAt: 9 })
    ]
    expect(renpySaveLocationOptions(identified, 'C:\\saves\\old').map((item) => item.folderName)).toEqual([
      'old',
      'new'
    ])
    expect(
      renpySaveLocationOptions(identified, 'C:\\saves\\custom').map((item) => item.folderName)
    ).toEqual(['custom', 'new', 'old'])
  })

  test('does not duplicate the active path when it is already identified', () => {
    const identified = [
      folder({
        title: 'Game',
        threadId: 4,
        savePath: 'C:\\saves\\Game',
        folderName: 'Game',
        identifiedAt: 2
      })
    ]
    expect(renpySaveLocationOptions(identified, 'C:\\saves\\game')).toHaveLength(1)
  })
})
