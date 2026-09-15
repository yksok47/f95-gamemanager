import { describe, expect, test } from 'bun:test'
import { gameUpdateState, hasPendingGameUpdate, shouldListOnUpdatesPage } from './updates'
import type { VersionPlayStat } from './types'

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
