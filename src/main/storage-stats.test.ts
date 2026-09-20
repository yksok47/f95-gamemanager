import { describe, expect, test } from 'bun:test'
import type { LibraryStorageItem, LibraryStorageStats } from '@shared/types'
import { patchLibraryStorageStatsForSaveFolder } from './storage-identity'

function saveItem(overrides: Partial<LibraryStorageItem> = {}): LibraryStorageItem {
  return {
    id: 'saves:c:\\saves\\game',
    kind: 'saves',
    threadId: 0,
    title: 'GAME-123',
    creator: '',
    version: '',
    filename: 'Saves',
    coverUrl: null,
    engine: "Ren'Py",
    bytes: 42,
    fileId: null,
    hasArchive: false,
    isInstalled: false,
    savePath: 'C:\\saves\\GAME-123',
    saveFolderName: 'GAME-123',
    identified: false,
    identifyFailed: false,
    ...overrides
  }
}

function stats(items: LibraryStorageItem[]): LibraryStorageStats {
  return {
    archiveBytes: 0,
    installBytes: 0,
    saveBytes: items.reduce((sum, item) => sum + item.bytes, 0),
    totalBytes: items.reduce((sum, item) => sum + item.bytes, 0),
    games: [],
    items
  }
}

describe('patchLibraryStorageStatsForSaveFolder', () => {
  test('marks a save folder as identified without changing bytes', () => {
    const prev = stats([saveItem()])
    const next = patchLibraryStorageStatsForSaveFolder(prev, {
      savePath: 'C:\\saves\\GAME-123',
      identified: true,
      threadId: 99,
      title: 'Cool Game',
      coverUrl: 'https://example/cover.jpg',
      creator: 'Dev',
      engine: "Ren'Py"
    })
    expect(next).not.toBeNull()
    const item = next?.items.find((entry) => entry.kind === 'saves')
    expect(item?.identified).toBe(true)
    expect(item?.identifyFailed).toBe(false)
    expect(item?.title).toBe('Cool Game')
    expect(item?.threadId).toBe(99)
    expect(item?.bytes).toBe(42)
    expect(next?.games).toEqual([
      expect.objectContaining({
        threadId: 99,
        title: 'Cool Game',
        saveBytes: 42,
        totalBytes: 42
      })
    ])
  })

  test('marks a save folder as unidentified after a failed lookup', () => {
    const prev = stats([saveItem({ identified: true, threadId: 99, title: 'Cool Game' })])
    const next = patchLibraryStorageStatsForSaveFolder(prev, {
      savePath: 'C:\\saves\\GAME-123',
      identified: false,
      identifyFailed: true
    })
    expect(next?.items[0]?.identified).toBe(false)
    expect(next?.items[0]?.identifyFailed).toBe(true)
    expect(next?.items[0]?.threadId).toBe(0)
    expect(next?.games).toEqual([])
  })

  test('keeps a 0-byte identified save folder as a library game', () => {
    const prev = stats([
      saveItem({
        bytes: 0,
        identified: true,
        threadId: 44,
        title: 'Empty Folder Game'
      })
    ])
    const next = patchLibraryStorageStatsForSaveFolder(prev, {
      savePath: 'C:\\saves\\GAME-123',
      identified: true,
      threadId: 44,
      title: 'Empty Folder Game'
    })
    expect(next?.games).toEqual([
      expect.objectContaining({
        threadId: 44,
        title: 'Empty Folder Game',
        saveBytes: 0,
        totalBytes: 0
      })
    ])
  })

  test('keeps both save folders when identifying a second folder for the same game', () => {
    const prev = stats([
      saveItem({
        id: 'saves:c:\\saves\\game-old',
        savePath: 'C:\\saves\\GAME-111',
        saveFolderName: 'GAME-111',
        identified: true,
        threadId: 99,
        title: 'Cool Game',
        bytes: 10
      }),
      saveItem({
        id: 'saves:c:\\saves\\game-new',
        savePath: 'C:\\saves\\GAME-222',
        saveFolderName: 'GAME-222',
        bytes: 20
      })
    ])
    const next = patchLibraryStorageStatsForSaveFolder(prev, {
      savePath: 'C:\\saves\\GAME-222',
      identified: true,
      threadId: 99,
      title: 'Cool Game'
    })
    expect(next?.items.filter((item) => item.threadId === 99)).toHaveLength(2)
    expect(next?.games).toEqual([
      expect.objectContaining({
        threadId: 99,
        title: 'Cool Game',
        saveBytes: 30,
        totalBytes: 30
      })
    ])
  })
})
