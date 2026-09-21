import { describe, expect, test } from 'bun:test'
import {
  gameUpdateState,
  hasPendingGameUpdate,
  latestInstalledLibraryFile,
  libraryFileVersion,
  shouldListOnUpdatesPage
} from './updates'
import type { GameLibraryFile, VersionPlayStat } from './types'
import { CONTENT_KIND_IDS } from './types'

function stat(
  version: string,
  status?: VersionPlayStat['status'],
  extra: Partial<VersionPlayStat> = {}
): VersionPlayStat {
  return {
    version,
    releasedAt: 0,
    lastPlayedAt: extra.lastPlayedAt ?? 0,
    playtimeMs: extra.playtimeMs ?? 0,
    ...(status ? { status } : extra)
  }
}

describe('hasPendingGameUpdate', () => {
  test('treats a newer unplayed catalog version as pending', () => {
    expect(
      hasPendingGameUpdate({
        latestVersion: '1.1',
        lastPlayedVersion: '1.0',
        playedVersions: [stat('1.0', 'played', { lastPlayedAt: 1 })]
      })
    ).toBe(true)
  })

  test('drops the updates list after marking the latest version played', () => {
    expect(
      hasPendingGameUpdate({
        latestVersion: '1.1',
        installedVersion: '1.0',
        lastPlayedVersion: '1.0',
        playedVersions: [stat('1.0', 'played', { lastPlayedAt: 1 }), stat('1.1', 'played')]
      })
    ).toBe(false)
  })

  test('drops the updates list after ignoring the latest version', () => {
    expect(
      hasPendingGameUpdate({
        latestVersion: '1.1',
        installedVersion: '1.0',
        lastPlayedVersion: '1.0',
        playedVersions: [stat('1.0', 'played', { lastPlayedAt: 1 }), stat('1.1', 'skipped')]
      })
    ).toBe(false)
  })
})

describe('shouldListOnUpdatesPage', () => {
  const pending = {
    latestVersion: '1.1',
    lastPlayedVersion: '1.0',
    playedVersions: [stat('1.0', 'played', { lastPlayedAt: 1 })]
  }

  test('hides a pending update while the game is on the roster', () => {
    expect(shouldListOnUpdatesPage(pending, true)).toBe(false)
  })

  test('shows the pending update again after leaving the roster unplayed', () => {
    expect(shouldListOnUpdatesPage(pending, false)).toBe(true)
  })
})

describe('gameUpdateState skipped latest', () => {
  test('hides the install update badge when the latest version is skipped', () => {
    expect(
      gameUpdateState({
        latestVersion: '1.1',
        installedVersion: '1.0',
        playedVersions: [stat('1.1', 'skipped')]
      })
    ).toEqual({ updateAvailable: false, unplayedUpdate: false })
  })

  test('keeps the install update badge after marking played', () => {
    expect(
      gameUpdateState({
        latestVersion: '1.1',
        installedVersion: '1.0',
        playedVersions: [stat('1.1', 'played')]
      })
    ).toEqual({ updateAvailable: true, unplayedUpdate: false })
  })
})

function installedFile(
  partial: Partial<GameLibraryFile> & Pick<GameLibraryFile, 'id' | 'version'>
): GameLibraryFile {
  return {
    threadId: 1,
    title: 'Game',
    engine: '',
    filename: `${partial.version}.zip`,
    archivePath: '',
    hash: partial.id,
    size: 1,
    downloadedAt: 1,
    installPath: 'C:\\games\\x',
    installedAt: 1,
    executablePath: null,
    lastPlayedAt: null,
    playtimeMs: 0,
    hasArchive: false,
    isInstalled: true,
    installPercent: null,
    ...partial
  }
}

describe('latestInstalledLibraryFile', () => {
  test('play uses the highest installed version even if an older copy was installed later', () => {
    const older = installedFile({
      id: 'old',
      version: '0.4',
      installedAt: 200,
      downloadedAt: 200
    })
    const newer = installedFile({
      id: 'new',
      version: '0.5',
      installedAt: 100,
      downloadedAt: 100
    })
    expect(latestInstalledLibraryFile([older, newer])?.id).toBe('new')
  })

  test('prefers approved package version over a stale file.version', () => {
    const staleCatalog = installedFile({
      id: 'old',
      version: '1.2',
      installedAt: 50,
      packageTags: { os: [0], contentKind: CONTENT_KIND_IDS.game, version: '1.0' }
    })
    const actualLatest = installedFile({
      id: 'new',
      version: '1.2',
      installedAt: 40,
      packageTags: { os: [0], contentKind: CONTENT_KIND_IDS.game, version: '1.1' }
    })
    expect(libraryFileVersion(staleCatalog)).toBe('1.0')
    expect(latestInstalledLibraryFile([staleCatalog, actualLatest])?.id).toBe('new')
  })

  test('picks Ch.2 Up.5 over Chapter 2 Update 4', () => {
    const older = installedFile({
      id: 'old',
      version: 'Chapter 2 Update 4',
      installedAt: 200,
      downloadedAt: 200
    })
    const newer = installedFile({
      id: 'new',
      version: 'Ch.2 Up.5',
      installedAt: 100,
      downloadedAt: 100,
      packageTags: { os: [0], contentKind: CONTENT_KIND_IDS.game, version: 'Ch.2 Up.5' }
    })
    expect(latestInstalledLibraryFile([older, newer])?.id).toBe('new')
    expect(latestInstalledLibraryFile([older, newer], 'Ch.2 Up.5')?.id).toBe('new')
  })

  test('uses overview release order when version strings do not compare cleanly', () => {
    const older = installedFile({
      id: 'old',
      version: 'Final Cut',
      installedAt: 200,
      downloadedAt: 200
    })
    const newer = installedFile({
      id: 'new',
      version: '0.9',
      installedAt: 50,
      downloadedAt: 50
    })
    expect(
      latestInstalledLibraryFile([older, newer], {
        catalogVersion: '0.9',
        playedVersions: [
          { version: '0.9', releasedAt: 2000, lastPlayedAt: 0, playtimeMs: 0 },
          { version: 'Final Cut', releasedAt: 1000, lastPlayedAt: 0, playtimeMs: 0 }
        ]
      })?.id
    ).toBe('new')
  })
})
