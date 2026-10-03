import { describe, expect, test } from 'bun:test'
import type { GameLibraryFile, IdentifiedSaveFolder, Subscription } from '@shared/types'
import { CONTENT_KIND_IDS } from '@shared/types'
import type { ThreadDownloadProgress } from './downloads'
import {
  hasLibraryCopy,
  libraryExclusiveKind,
  listUncensorPatchTargets,
  mergeDownloadingLibraryGames,
  overlayListLabel,
  overlayRemoveNoun,
  saveOnlyLibraryGames,
  saveThreadIds,
  summarizeInstalledOverlayKind,
  summarizeLibrary,
  withSavePresence,
  libraryFileBusy,
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

  test('exposes uninstalling state for tiles', () => {
    const status = summarizeLibrary([
      libraryFile({ id: 'a', threadId: 1, isInstalled: true, uninstalling: true })
    ]).get(1)
    expect(status?.isInstalled).toBe(true)
    expect(status?.uninstalling).toBe(true)
    expect(status?.installPercent).toBeNull()
    expect(hasLibraryCopy(status)).toBe(true)
  })

  test('keeps an install-only game visible after the folder is already gone', () => {
    const status = summarizeLibrary([
      libraryFile({ id: 'a', threadId: 1, isInstalled: false, uninstalling: true })
    ]).get(1)
    expect(status?.uninstalling).toBe(true)
    expect(hasLibraryCopy(status)).toBe(true)
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
    expect(status?.uninstalling).toBe(false)
  })

  test('play/status use the highest installed version when several copies exist', () => {
    const status = summarizeLibrary([
      libraryFile({
        id: 'old',
        threadId: 1,
        isInstalled: true,
        installPath: 'C:\\games\\old',
        installedAt: 200,
        version: '0.4'
      }),
      libraryFile({
        id: 'new',
        threadId: 1,
        isInstalled: true,
        installPath: 'C:\\games\\new',
        installedAt: 50,
        version: '0.5'
      })
    ]).get(1)
    expect(status?.isInstalled).toBe(true)
    expect(status?.installedVersion).toBe('0.5')
  })

  test('treats Chapter 2 Update 4 as older than Ch.2 Up.5', () => {
    const status = summarizeLibrary([
      libraryFile({
        id: 'old',
        threadId: 1,
        isInstalled: true,
        installPath: 'C:\\games\\old',
        installedAt: 200,
        version: 'Chapter 2 Update 4'
      }),
      libraryFile({
        id: 'new',
        threadId: 1,
        isInstalled: true,
        installPath: 'C:\\games\\new',
        installedAt: 50,
        version: 'Ch.2 Up.5'
      })
    ]).get(1)
    expect(status?.installedVersion).toBe('Ch.2 Up.5')
  })

  test('uses overview release dates when they are provided', () => {
    const status = summarizeLibrary(
      [
        libraryFile({
          id: 'old',
          threadId: 1,
          isInstalled: true,
          installPath: 'C:\\games\\old',
          installedAt: 200,
          version: 'Final Cut'
        }),
        libraryFile({
          id: 'new',
          threadId: 1,
          isInstalled: true,
          installPath: 'C:\\games\\new',
          installedAt: 50,
          version: '0.9'
        })
      ],
      [
        {
          threadId: 1,
          version: '0.9',
          playedVersions: [
            { version: '0.9', releasedAt: 2000, lastPlayedAt: 0, playtimeMs: 0 },
            { version: 'Final Cut', releasedAt: 1000, lastPlayedAt: 0, playtimeMs: 0 }
          ]
        }
      ]
    ).get(1)
    expect(status?.installedVersion).toBe('0.9')
  })

  test('defaults hasSaves to false until save folders are merged', () => {
    const status = summarizeLibrary([
      libraryFile({ id: 'a', threadId: 1, hasArchive: true })
    ]).get(1)
    expect(status?.hasSaves).toBe(false)
  })
})

describe('libraryFileBusy', () => {
  test('treats install and uninstall as busy', () => {
    expect(libraryFileBusy({ installPercent: null })).toBe(false)
    expect(libraryFileBusy({ installPercent: 10 })).toBe(true)
    expect(libraryFileBusy({ installPercent: null, uninstalling: true })).toBe(true)
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

describe('listUncensorPatchTargets', () => {
  const gameTags = { os: [0], contentKind: CONTENT_KIND_IDS.game, version: '1.0' }
  const patchTags = { os: [0], contentKind: CONTENT_KIND_IDS.patch, version: '' }
  const uncensorTags = { os: [0], contentKind: CONTENT_KIND_IDS.uncensor, version: '' }
  const modTags = { os: [0], contentKind: CONTENT_KIND_IDS.mod, version: '' }

  test('lists installed Ren\'Py games for patch, uncensor, and mod overlays', () => {
    const installed = libraryFile({
      id: 'game',
      threadId: 1,
      isInstalled: true,
      engine: "Ren'Py",
      packageTags: gameTags,
      version: '1.0'
    })
    const patch = libraryFile({
      id: 'fix',
      threadId: 1,
      hasArchive: true,
      packageTags: patchTags,
      hash: 'fix-hash'
    })
    const uncensor = libraryFile({
      id: 'unc',
      threadId: 1,
      hasArchive: true,
      packageTags: uncensorTags,
      hash: 'unc-hash'
    })
    const mod = libraryFile({
      id: 'mod',
      threadId: 1,
      hasArchive: true,
      packageTags: modTags,
      hash: 'mod-hash'
    })
    expect(listUncensorPatchTargets([installed, patch], patch).map((file) => file.id)).toEqual([
      'game'
    ])
    expect(listUncensorPatchTargets([installed, uncensor], uncensor).map((file) => file.id)).toEqual([
      'game'
    ])
    expect(listUncensorPatchTargets([installed, mod], mod).map((file) => file.id)).toEqual(['game'])
  })

  test('ignores non-overlay kinds and already-applied overlays', () => {
    const installed = libraryFile({
      id: 'game',
      threadId: 1,
      isInstalled: true,
      engine: "Ren'Py",
      packageTags: gameTags,
      installedPatches: [
        { patchId: 'mod', hash: 'mod-hash', filename: 'cool-mod.zip', installedAt: 1, kind: 'mod' }
      ]
    })
    const walkthrough = libraryFile({
      id: 'guide',
      threadId: 1,
      hasArchive: true,
      packageTags: { os: [0], contentKind: CONTENT_KIND_IDS.walkthrough, version: '' }
    })
    const appliedMod = libraryFile({
      id: 'mod',
      threadId: 1,
      hasArchive: true,
      packageTags: modTags,
      hash: 'mod-hash'
    })
    expect(listUncensorPatchTargets([installed, walkthrough], walkthrough)).toEqual([])
    expect(listUncensorPatchTargets([installed, appliedMod], appliedMod)).toEqual([])
  })

  test('labels mixed installed overlays as applied', () => {
    expect(overlayListLabel('mod')).toBe('Mod')
    expect(overlayListLabel('uncensor')).toBe('Uncensor')
    expect(overlayListLabel('patch')).toBe('Patch')
    expect(overlayListLabel('mixed')).toBe('Applied')
    expect(overlayRemoveNoun('mod')).toBe('mod')
    expect(overlayRemoveNoun('patch')).toBe('patch')
    expect(overlayRemoveNoun('mixed')).toBe('overlay')
    expect(
      summarizeInstalledOverlayKind(
        [
          { patchId: 'a', hash: 'a', filename: 'a.rpy', installedAt: 1, kind: 'mod' },
          { patchId: 'b', hash: 'b', filename: 'b.rpy', installedAt: 2, kind: 'uncensor' }
        ],
        []
      )
    ).toBe('mixed')
  })
})

describe('withSavePresence', () => {
  test('marks existing library rows and adds save-only stubs', () => {
    const library = summarizeLibrary([
      libraryFile({ id: 'a', threadId: 1, hasArchive: true })
    ])
    const next = withSavePresence(library, new Set([1, 9]))
    expect(next.get(1)?.hasSaves).toBe(true)
    expect(next.get(1)?.hasArchive).toBe(true)
    expect(next.get(9)?.hasSaves).toBe(true)
    expect(next.get(9)?.hasArchive).toBe(false)
    expect(hasLibraryCopy(next.get(9))).toBe(false)
    expect(hasLibraryCopy(next.get(1))).toBe(true)
  })

  test('collects thread ids from identified folders', () => {
    expect(
      [...saveThreadIds([
        identifiedFolder({ threadId: 4, title: 'A', savePath: 'C:\\saves\\a' }),
        identifiedFolder({ threadId: 0, title: 'Skip', savePath: 'C:\\saves\\b' }),
        identifiedFolder({ threadId: 4, title: 'A again', savePath: 'C:\\saves\\c' })
      ])]
    ).toEqual([4])
  })
})
