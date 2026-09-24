import { describe, expect, test } from 'bun:test'
import {
  catalogPagePastTimestamp,
  catalogWatermarkFromStore,
  followedTimestampCutoff,
  watermarkFromHeadPage
} from './catalog-scan'

const newest = 1_700_000_009_000
const middle = 1_700_000_005_000
const previous = 1_700_000_002_000
const older = 1_700_000_001_000
const oldest = 1_700_000_000_500

describe('catalog scan bounds', () => {
  test('discards a watermark saved before continuous scans', () => {
    expect(catalogWatermarkFromStore(undefined, newest)).toBe(0)
    expect(catalogWatermarkFromStore(1, newest)).toBe(0)
    expect(catalogWatermarkFromStore(2, newest)).toBe(newest)
  })

  test('does not treat the newest head row as coverage when nothing was scanned before', () => {
    expect(watermarkFromHeadPage([{ timestamp: newest }, { timestamp: middle }], 0)).toBe(0)
  })

  test('advances only when the head page reaches the previous watermark in order', () => {
    expect(
      watermarkFromHeadPage(
        [{ timestamp: newest }, { timestamp: middle }, { timestamp: older }],
        previous
      )
    ).toBe(newest)
    expect(watermarkFromHeadPage([{ timestamp: newest }, { timestamp: middle }], previous)).toBe(0)
    expect(
      watermarkFromHeadPage(
        [{ timestamp: newest }, { timestamp: oldest }, { timestamp: middle }],
        previous
      )
    ).toBe(0)
  })

  test('keeps scanning when an early row is older than the watermark', () => {
    expect(
      catalogPagePastTimestamp([{ timestamp: oldest }, { timestamp: 0 }, { timestamp: newest }], previous)
    ).toBe(false)
    expect(catalogPagePastTimestamp([{ timestamp: older }, { timestamp: oldest }], previous)).toBe(true)
    expect(catalogPagePastTimestamp([{ timestamp: previous }], previous)).toBe(false)
  })

  test('a newly followed game does not become the cutoff while other follows are undated', () => {
    expect(followedTimestampCutoff([newest, 0, older])).toBe(0)
    expect(followedTimestampCutoff([newest])).toBe(newest)
    expect(followedTimestampCutoff([newest, older, middle])).toBe(older)
  })
})
