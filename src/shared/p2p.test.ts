import { describe, expect, test } from 'bun:test'
import { isInFlightP2pState, type P2pTransferState } from './p2p'

describe('isInFlightP2pState', () => {
  test('covers connecting and other user-facing download states', () => {
    const inflight: P2pTransferState[] = [
      'connecting',
      'downloading',
      'checking',
      'paused',
      'quarantined',
      'error'
    ]
    for (const state of inflight) {
      expect(isInFlightP2pState(state)).toBe(true)
    }
  })

  test('excludes idle and seeding', () => {
    expect(isInFlightP2pState('idle')).toBe(false)
    expect(isInFlightP2pState('seeding')).toBe(false)
  })
})
