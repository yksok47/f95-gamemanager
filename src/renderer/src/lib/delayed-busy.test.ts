import { describe, expect, test } from 'bun:test'
import { SPINNER_SHOW_DELAY_MS } from './delayed-busy'

describe('SPINNER_SHOW_DELAY_MS', () => {
  test('waits long enough to skip a short load without feeling stuck', () => {
    expect(SPINNER_SHOW_DELAY_MS).toBeGreaterThanOrEqual(150)
    expect(SPINNER_SHOW_DELAY_MS).toBeLessThanOrEqual(400)
  })
})
