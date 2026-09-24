import { describe, expect, test } from 'bun:test'
import {
  addVersionAlias,
  addVersionPlaytime,
  canonicalVersionName,
  ensureKnownVersion,
  gameUpdateState,
  hasPendingGameUpdate,
  latestInstalledLibraryFile,
  latestKnownVersion,
  preferNewerVersion,
  latestOverviewVersion,
  libraryFileVersion,
  mergeVersionNames,
  mergeVersionPlayStats,
  normalizeVersionPlayStats,
  removeVersionAlias,
  setVersionReleasedAt,
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

  test('keeps a newer unplayed version visible when the stored field rolled back', () => {
    const playedVersions = [stat('v0.9.23'), stat('v0.9.22', 'played')]
    expect(latestKnownVersion('v0.9.22', playedVersions)).toBe('v0.9.23')
    expect(preferNewerVersion('v0.9.23', 'v0.9.22')).toBe('v0.9.23')
    expect(
      hasPendingGameUpdate({
        latestVersion: latestKnownVersion('v0.9.22', playedVersions),
        lastPlayedVersion: '',
        playedVersions
      })
    ).toBe(true)
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

describe('version aliases', () => {
  test('normalize collapses aliased names and sums their playtimes', () => {
    const stats = normalizeVersionPlayStats([
      { version: '0.9', releasedAt: 2_000_000_000_000, lastPlayedAt: 50, playtimeMs: 2_000, aliases: ['v0.9'] },
      { version: 'v0.9', releasedAt: 0, lastPlayedAt: 80, playtimeMs: 1_000 }
    ])
    expect(stats).toHaveLength(1)
    expect(stats[0]?.version).toBe('0.9')
    expect(stats[0]?.aliases).toEqual(['v0.9'])
    expect(stats[0]?.playtimeMs).toBe(3_000)
    expect(stats[0]?.lastPlayedAt).toBe(80)
    expect(stats[0]?.releasedAt).toBe(2_000_000_000_000)
  })

  test('mergeVersionPlayStats folds file rows using aliases from the other list', () => {
    const merged = mergeVersionPlayStats(
      [
        { version: '0.9', releasedAt: 0, lastPlayedAt: 10, playtimeMs: 2_000 },
        { version: 'v0.9', releasedAt: 0, lastPlayedAt: 20, playtimeMs: 1_000 }
      ],
      [{ version: '0.9', releasedAt: 1_700_000_000_000, lastPlayedAt: 0, playtimeMs: 0, aliases: ['v0.9'] }]
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.version).toBe('0.9')
    expect(merged[0]?.aliases).toEqual(['v0.9'])
    expect(merged[0]?.playtimeMs).toBe(3_000)
    expect(merged[0]?.releasedAt).toBe(1_700_000_000_000)
  })

  test('mergeVersionPlayStats does not double-count the same version from two sources', () => {
    const merged = mergeVersionPlayStats(
      [{ version: '1.0', releasedAt: 0, lastPlayedAt: 1, playtimeMs: 8_000 }],
      [{ version: '1.0', releasedAt: 0, lastPlayedAt: 1, playtimeMs: 8_000 }]
    )
    expect(merged).toHaveLength(1)
    expect(merged[0]?.playtimeMs).toBe(8_000)
  })

  test('addVersionAlias merges an existing row into the canonical name', () => {
    const stats = addVersionAlias(
      [
        { version: '0.9', releasedAt: 100, lastPlayedAt: 10, playtimeMs: 2_000 },
        { version: 'Chapter 9', releasedAt: 0, lastPlayedAt: 20, playtimeMs: 4_000 }
      ],
      '0.9',
      'Chapter 9'
    )
    expect(stats).toHaveLength(1)
    expect(stats[0]?.version).toBe('0.9')
    expect(stats[0]?.aliases).toEqual(['Chapter 9'])
    expect(stats[0]?.playtimeMs).toBe(6_000)
  })

  test('mergeVersionNames keeps the chosen name and sums playtimes', () => {
    const stats = mergeVersionNames(
      [
        { version: '0.9', releasedAt: 100, lastPlayedAt: 1, playtimeMs: 2_000 },
        { version: 'v0.9', releasedAt: 0, lastPlayedAt: 2, playtimeMs: 1_000 }
      ],
      'v0.9',
      ['0.9']
    )
    expect(stats).toHaveLength(1)
    expect(stats[0]?.version).toBe('v0.9')
    expect(stats[0]?.aliases).toEqual(['0.9'])
    expect(stats[0]?.playtimeMs).toBe(3_000)
  })

  test('removeVersionAlias drops a name without splitting playtime back out', () => {
    const stats = removeVersionAlias(
      [{ version: '0.9', releasedAt: 0, lastPlayedAt: 1, playtimeMs: 3_000, aliases: ['v0.9'] }],
      '0.9',
      'v0.9'
    )
    expect(stats[0]?.aliases).toBeUndefined()
    expect(stats[0]?.playtimeMs).toBe(3_000)
  })

  test('setVersionReleasedAt overwrites the stored date', () => {
    const stats = setVersionReleasedAt(
      [{ version: '0.9', releasedAt: 1_700_000_000_000, lastPlayedAt: 0, playtimeMs: 0 }],
      '0.9',
      1_700_000_009_000
    )
    expect(stats[0]?.releasedAt).toBe(1_700_000_009_000)
  })

  test('ensureKnownVersion does not recreate a name that is already an alias', () => {
    const stats = ensureKnownVersion(
      [{ version: '0.9', releasedAt: 1_700_000_000_000, lastPlayedAt: 0, playtimeMs: 0, aliases: ['v0.9'] }],
      'v0.9',
      1_700_000_000_200
    )
    expect(stats).toHaveLength(1)
    expect(stats[0]?.version).toBe('0.9')
    expect(stats[0]?.releasedAt).toBe(1_700_000_000_000)
  })

  test('playtime recorded against an alias is stored on the canonical version', () => {
    const stats = addVersionPlaytime(
      [{ version: '0.9', releasedAt: 0, lastPlayedAt: 1, playtimeMs: 1_000, aliases: ['v0.9'] }],
      'v0.9',
      500,
      20
    )
    expect(stats).toHaveLength(1)
    expect(stats[0]?.version).toBe('0.9')
    expect(stats[0]?.playtimeMs).toBe(1_500)
    expect(stats[0]?.lastPlayedAt).toBe(20)
  })

  test('latest overview version matches a catalog name that is only an alias', () => {
    expect(
      latestOverviewVersion(
        [{ version: '0.9', releasedAt: 100, lastPlayedAt: 0, playtimeMs: 0, aliases: ['v0.9'] }],
        'v0.9'
      )
    ).toBe('0.9')
    expect(
      canonicalVersionName('v0.9', [
        { version: '0.9', releasedAt: 0, lastPlayedAt: 0, playtimeMs: 0, aliases: ['v0.9'] }
      ])
    ).toBe('0.9')
  })
})
