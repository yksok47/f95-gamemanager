import { describe, expect, test } from 'bun:test'
import type { FollowSyncStatus } from './types'
import { followSyncLabel, followSyncProgress } from './follow-sync'

function status(partial: Partial<FollowSyncStatus>): FollowSyncStatus {
  return {
    running: false,
    lastRunAt: null,
    lastError: null,
    checked: 0,
    updated: 0,
    pending: 0,
    cancelled: false,
    mode: null,
    page: 0,
    totalPages: 0,
    ...partial
  }
}

describe('followSyncProgress', () => {
  test('is complete when idle', () => {
    expect(followSyncProgress(status({ running: false, page: 3 }))).toBe(1)
  })

  test('uses page motion for catch-up so the ring moves before matches appear', () => {
    expect(
      followSyncProgress(status({ running: true, mode: 'catchup', page: 0, pending: 1 }))
    ).toBe(0)
    expect(
      followSyncProgress(status({ running: true, mode: 'catchup', page: 3, pending: 1 }))
    ).toBe(0.75)
  })

  test('uses followed-game counts for a manual refresh', () => {
    expect(
      followSyncProgress(
        status({ running: true, mode: 'manual', checked: 8, pending: 2, page: 4 })
      )
    ).toBe(0.8)
  })
})

describe('followSyncLabel', () => {
  test('names the catalog page during catch-up', () => {
    expect(followSyncLabel(status({ running: true, mode: 'catchup', page: 2 }))).toBe(
      'Checking page 2'
    )
  })

  test('names remaining followed games during a manual refresh', () => {
    expect(
      followSyncLabel(status({ running: true, mode: 'manual', checked: 3, pending: 7 }))
    ).toBe('Checking 3/10')
  })
})
