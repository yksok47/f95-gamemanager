import { describe, expect, test } from 'bun:test'
import { mergeUserData, needsApply, needsUpload } from './merge'
import {
  emptyPayload,
  emptySyncedSettings,
  parseEnvelope,
  serializeEnvelope,
  type SyncedSubscription,
  type UserDataPayload
} from './snapshot'

function sub(partial: Partial<SyncedSubscription> & { threadId: number }): SyncedSubscription {
  const addedAt = partial.addedAt || 10
  return {
    threadId: partial.threadId,
    title: partial.title || `Game ${partial.threadId}`,
    creator: partial.creator || 'Author',
    version: partial.version || '1.0',
    coverUrl: partial.coverUrl ?? null,
    rating: partial.rating || 0,
    likes: partial.likes || 0,
    views: partial.views || 0,
    updatedAt: partial.updatedAt || '',
    timestamp: partial.timestamp || 0,
    threadUrl: `https://f95zone.to/threads/${partial.threadId}/`,
    source: partial.source || 'manual',
    addedAt,
    rarity: partial.rarity || 'regular',
    tags: partial.tags || [],
    prefixes: partial.prefixes || [],
    engine: partial.engine || '',
    lastPlayedVersion: partial.lastPlayedVersion || '',
    lastPlayedAt: partial.lastPlayedAt || 0,
    playtimeMs: partial.playtimeMs || 0,
    playedVersions: partial.playedVersions || [],
    checkedAt: partial.checkedAt || 0,
    screens: partial.screens || [],
    archived: Boolean(partial.archived),
    userUpdatedAt: partial.userUpdatedAt || addedAt
  }
}

function payload(partial: Partial<UserDataPayload> = {}): UserDataPayload {
  return {
    ...emptyPayload(),
    ...partial,
    settings: partial.settings || emptySyncedSettings(),
    settingsTimes: partial.settingsTimes || {}
  }
}

describe('mergeUserData', () => {
  test('unfollows win when the tombstone is newer than the follow', () => {
    const local = payload({
      subscriptions: [sub({ threadId: 1, userUpdatedAt: 50 })],
      subscriptionTombstones: [{ threadId: 1, deletedAt: 100 }]
    })
    const remote = payload({
      subscriptions: [sub({ threadId: 1, userUpdatedAt: 80 })]
    })
    const merged = mergeUserData(local, remote)
    expect(merged.subscriptions).toEqual([])
    expect(merged.subscriptionTombstones).toEqual([{ threadId: 1, deletedAt: 100 }])
  })

  test('a newer follow beats an older unfollow', () => {
    const local = payload({
      subscriptions: [sub({ threadId: 1, userUpdatedAt: 200, rarity: 'epic' })]
    })
    const remote = payload({
      subscriptionTombstones: [{ threadId: 1, deletedAt: 50 }]
    })
    const merged = mergeUserData(local, remote)
    expect(merged.subscriptions).toHaveLength(1)
    expect(merged.subscriptions[0].rarity).toBe('epic')
    expect(merged.subscriptionTombstones).toEqual([])
  })

  test('playtime takes the max even when the other side won rarity', () => {
    const local = payload({
      subscriptions: [
        sub({
          threadId: 2,
          userUpdatedAt: 10,
          rarity: 'rare',
          playtimeMs: 8_000,
          lastPlayedAt: 500,
          lastPlayedVersion: '1.1',
          playedVersions: [{ version: '1.1', releasedAt: 0, lastPlayedAt: 500, playtimeMs: 8_000 }]
        })
      ]
    })
    const remote = payload({
      subscriptions: [
        sub({
          threadId: 2,
          userUpdatedAt: 90,
          rarity: 'legendary',
          playtimeMs: 3_000,
          lastPlayedAt: 400,
          lastPlayedVersion: '1.0',
          playedVersions: [{ version: '1.0', releasedAt: 0, lastPlayedAt: 400, playtimeMs: 3_000 }]
        })
      ]
    })
    const merged = mergeUserData(local, remote)
    expect(merged.subscriptions[0].rarity).toBe('legendary')
    expect(merged.subscriptions[0].playtimeMs).toBe(8_000)
    expect(merged.subscriptions[0].lastPlayedAt).toBe(500)
    expect(merged.subscriptions[0].lastPlayedVersion).toBe('1.1')
    expect(merged.subscriptions[0].playedVersions.map((item) => item.version).sort()).toEqual([
      '1.0',
      '1.1'
    ])
  })

  test('notes last-write-wins and honor delete tombstones', () => {
    const local = payload({
      notes: [
        { threadId: 3, text: 'old', updatedAt: 10 },
        { threadId: 4, text: 'keep', updatedAt: 40 }
      ]
    })
    const remote = payload({
      notes: [{ threadId: 3, text: 'new', updatedAt: 80 }],
      noteTombstones: [{ threadId: 4, deletedAt: 90 }]
    })
    const merged = mergeUserData(local, remote)
    expect(merged.notes).toEqual([{ threadId: 3, text: 'new', updatedAt: 80 }])
    expect(merged.noteTombstones).toEqual([{ threadId: 4, deletedAt: 90 }])
  })

  test('settings merge per key so later page size does not wipe earlier tags', () => {
    const local = payload({
      settings: { ...emptySyncedSettings(), favoriteTags: [{ id: 1, name: 'NTR', tier: 'gold' }] },
      settingsTimes: { favoriteTags: 100 }
    })
    const remote = payload({
      settings: { ...emptySyncedSettings(), catalogPageSize: 90 },
      settingsTimes: { catalogPageSize: 200 }
    })
    const merged = mergeUserData(local, remote)
    expect(merged.settings.favoriteTags).toEqual([{ id: 1, name: 'NTR', tier: 'gold' }])
    expect(merged.settings.catalogPageSize).toBe(90)
  })

  test('roster membership uses the same tombstone rule', () => {
    const local = payload({
      roster: [
        {
          threadId: 9,
          title: 'On list',
          creator: '',
          version: '',
          coverUrl: null,
          rating: 0,
          likes: 0,
          views: 0,
          updatedAt: '',
          timestamp: 0,
          threadUrl: 'https://f95zone.to/threads/9/',
          prefixes: [],
          tags: [],
          screens: [],
          addedAt: 10,
          userUpdatedAt: 10
        }
      ]
    })
    const remote = payload({
      rosterTombstones: [{ threadId: 9, deletedAt: 40 }]
    })
    const merged = mergeUserData(local, remote)
    expect(merged.roster).toEqual([])
  })
})

describe('needsApply / needsUpload', () => {
  test('skips work when local and remote already match', () => {
    const local = payload({
      subscriptions: [sub({ threadId: 1, playtimeMs: 1000, userUpdatedAt: 5 })]
    })
    const remote = payload({
      subscriptions: [sub({ threadId: 1, playtimeMs: 1000, userUpdatedAt: 5 })]
    })
    const merged = mergeUserData(local, remote)
    expect(needsApply(local, merged)).toBe(false)
    expect(needsUpload(remote, merged)).toBe(false)
  })

  test('uploads when there is no remote snapshot yet', () => {
    const local = payload({ subscriptions: [sub({ threadId: 1 })] })
    expect(needsUpload(null, local)).toBe(true)
  })
})

describe('envelope checksum', () => {
  test('round-trips a snapshot', () => {
    const original = payload({
      revision: 3,
      updatedAt: 99,
      subscriptions: [sub({ threadId: 7, playtimeMs: 2500, userUpdatedAt: 12 })]
    })
    const { bytes, checksum } = serializeEnvelope(original)
    const parsed = parseEnvelope(bytes)
    expect(parsed?.checksum).toBe(checksum)
    expect(parsed?.payload.subscriptions[0].playtimeMs).toBe(2500)
  })

  test('rejects a tampered payload so a failed upload cannot replace good data', () => {
    const { bytes } = serializeEnvelope(payload({ revision: 1, subscriptions: [sub({ threadId: 1 })] }))
    const parsed = JSON.parse(bytes.toString('utf8')) as {
      checksum: string
      payload: UserDataPayload
    }
    parsed.payload.subscriptions[0].playtimeMs = 99_999
    expect(parseEnvelope(JSON.stringify(parsed))).toBeNull()
  })

  test('rejects truncated JSON', () => {
    expect(parseEnvelope('{"checksum":"abc"')).toBeNull()
  })
})
