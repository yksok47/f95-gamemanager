import { describe, expect, test } from 'bun:test'
import type { GameLibraryFile, IdentifiedSaveFolder, Subscription } from '@shared/types'
import type { ThreadDownloadProgress } from './downloads'
import {
  libraryExclusiveKind,
  mergeDownloadingLibraryGames,
  saveOnlyLibraryGames,
  summarizeLibrary,
  type LibraryGame
} from './library'

function libraryGame(partial: Partial<LibraryGame> & Pick<LibraryGame, 'threadId' | 'title'>): LibraryGame {
  return {
    creator: '',
    version: '',
    coverUrl: null,
    rating: 0,
    likes: 0,
    views: 0,
    engine: '',
    prefixes: [],
    tags: [],
    timestamp: 0,
    threadUrl: `https://f95zone.to/threads/${partial.threadId}/`,
    screens: [],
    lastPlayedVersion: '',
    lastPlayedAt: 0,
    playtimeMs: 0,
    playedVersions: [],
    downloadedAt: 1,
    ...partial
  }
}

function pending(
  partial: Partial<ThreadDownloadProgress> & Pick<ThreadDownloadProgress, 'threadId' | 'title'>
): ThreadDownloadProgress {
  return {
    version: '1.0',
    creator: '',
    coverUrl: null,
    engine: '',
    percent: 20,
    startedAt: 50,
    ...partial
  }
}

describe('mergeDownloadingLibraryGames', () => {
  test('adds downloading games that are not in the library yet', () => {
    const games = [libraryGame({ threadId: 1, title: 'Installed' })]
    const downloads = new Map<number, ThreadDownloadProgress>([
      [1, pending({ threadId: 1, title: 'Installed update' })],
      [2, pending({ threadId: 2, title: 'Downloading', coverUrl: 'https://cdn.test/d.jpg', startedAt: 90 })]
    ])
    const merged = mergeDownloadingLibraryGames(games, downloads, [])
    expect(merged.map((game) => game.threadId)).toEqual([1, 2])
    expect(merged[1]?.coverUrl).toBe('https://cdn.test/d.jpg')
    expect(merged[1]?.downloadedAt).toBe(90)
  })

  test('fills tile metadata from a followed subscription', () => {
    const sub = {
      threadId: 8,
      title: 'Followed title',
      creator: 'Author',
      version: '2.1',
      coverUrl: 'https://cdn.test/f.jpg',
      rating: 4,
      likes: 10,
      views: 20,
      threadUrl: 'https://f95zone.to/threads/8/',
      prefixes: [1],
      tags: [2],
      screens: ['https://cdn.test/s.jpg']
    } as Subscription
    const merged = mergeDownloadingLibraryGames(
      [],
      new Map([[8, pending({ threadId: 8, title: 'File name', version: '2.1' })]]),
      [sub]
    )
    expect(merged[0]?.title).toBe('Followed title')
    expect(merged[0]?.creator).toBe('Author')
    expect(merged[0]?.coverUrl).toBe('https://cdn.test/f.jpg')
    expect(merged[0]?.tags).toEqual([2])
  })

  test('cancelled downloads disappear when they are no longer pending and have no library files', () => {
    const pendingMap = new Map([[3, pending({ threadId: 3, title: 'Soon gone' })]])
    expect(mergeDownloadingLibraryGames([], pendingMap, [])).toHaveLength(1)
    expect(mergeDownloadingLibraryGames([], new Map(), [])).toEqual([])
  })
})

function libraryFile(
  partial: Partial<GameLibraryFile> & Pick<GameLibraryFile, 'id' | 'threadId'>
): GameLibraryFile {
  return {
    title: '',
    version: '',
    engine: '',
    filename: '',
    archivePath: '',
    hash: '',
    size: 0,
    downloadedAt: 1,
    installPath: null,
    installedAt: null,
    executablePath: null,
    lastPlayedAt: null,
    playtimeMs: 0,
    hasArchive: false,
    isInstalled: false,
    installPercent: null,
    ...partial
  }
}

describe('summarizeLibrary', () => {
  test('exposes in-progress install percent for tiles', () => {
    const status = summarizeLibrary([
      libraryFile({ id: 'a', threadId: 1, hasArchive: true, installPercent: 42 })
    ]).get(1)
    expect(status?.hasArchive).toBe(true)
    expect(status?.isInstalled).toBe(false)
    expect(status?.installPercent).toBe(42)
  })

  test('clears install percent after the extract finishes', () => {
    const status = summarizeLibrary([
      libraryFile({
        id: 'a',
        threadId: 1,
        hasArchive: true,
        isInstalled: true,
        installPath: 'C:\\games\\a',
        installedAt: 9,
        version: '1.2',
        installPercent: null
      })
    ]).get(1)
    expect(status?.isInstalled).toBe(true)
    expect(status?.installedVersion).toBe('1.2')
    expect(status?.installPercent).toBeNull()
  })
})

function identifiedFolder(
  partial: Partial<IdentifiedSaveFolder> & Pick<IdentifiedSaveFolder, 'threadId' | 'title' | 'savePath'>
): IdentifiedSaveFolder {
  return {
    coverUrl: null,
    folderName: partial.title,
    identifiedAt: 10,
    ...partial
  }
}

describe('saveOnlyLibraryGames', () => {
  test('lists identified save folders that are not in the library', () => {
    const games = saveOnlyLibraryGames(
      [
        identifiedFolder({
          threadId: 11,
          title: 'Save only',
          savePath: 'C:\\saves\\a',
          coverUrl: 'https://cdn.test/s.jpg',
          creator: 'Dev',
          prefixes: [3],
          tags: [9]
        }),
        identifiedFolder({ threadId: 12, title: 'Installed too', savePath: 'C:\\saves\\b' })
      ],
      [],
      new Set([12])
    )
    expect(games.map((game) => game.threadId)).toEqual([11])
    expect(games[0]?.savesOnly).toBe(true)
    expect(games[0]?.coverUrl).toBe('https://cdn.test/s.jpg')
    expect(games[0]?.creator).toBe('Dev')
    expect(games[0]?.tags).toEqual([9])
  })

  test('fills tile metadata from a followed subscription', () => {
    const sub = {
      threadId: 8,
      title: 'Followed title',
      creator: 'Author',
      version: '2.1',
      coverUrl: 'https://cdn.test/f.jpg',
      rating: 4,
      likes: 10,
      views: 20,
      threadUrl: 'https://f95zone.to/threads/8/',
      prefixes: [1],
      tags: [2],
      screens: ['https://cdn.test/s.jpg']
    } as Subscription
    const games = saveOnlyLibraryGames(
      [identifiedFolder({ threadId: 8, title: 'Folder name', savePath: 'C:\\saves\\8' })],
      [sub],
      new Set()
    )
    expect(games[0]?.title).toBe('Followed title')
    expect(games[0]?.creator).toBe('Author')
    expect(games[0]?.tags).toEqual([2])
    expect(games[0]?.coverUrl).toBe('https://cdn.test/f.jpg')
  })
})

describe('libraryExclusiveKind', () => {
  test('treats identified saves without archive or install as saves-only', () => {
    expect(libraryExclusiveKind(libraryGame({ threadId: 1, title: 'Saves', savesOnly: true }))).toBe(
      'saves'
    )
  })

  test('treats an archive without an install as archive-only', () => {
    expect(
      libraryExclusiveKind(libraryGame({ threadId: 2, title: 'Zip' }), {
        hasArchive: true,
        isInstalled: false
      })
    ).toBe('archive')
  })

  test('treats an install without an archive as install-only', () => {
    expect(
      libraryExclusiveKind(libraryGame({ threadId: 3, title: 'Playable' }), {
        hasArchive: false,
        isInstalled: true
      })
    ).toBe('install')
  })

  test('does not treat mixed or in-progress games as exclusive', () => {
    expect(
      libraryExclusiveKind(libraryGame({ threadId: 4, title: 'Both' }), {
        hasArchive: true,
        isInstalled: true
      })
    ).toBe(null)
    expect(libraryExclusiveKind(libraryGame({ threadId: 5, title: 'Downloading' }))).toBe(null)
  })
})
