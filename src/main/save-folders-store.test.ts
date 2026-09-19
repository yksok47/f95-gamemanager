import { describe, expect, test } from 'bun:test'
import type { IdentifiedSaveFolder } from '@shared/types'
import { mergeIdentifiedSaveFolder } from './save-folder-meta'

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
