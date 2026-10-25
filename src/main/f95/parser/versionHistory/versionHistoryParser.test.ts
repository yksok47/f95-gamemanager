import { describe, expect, it } from 'vitest'
import { cadenceDays, parseVersionHistory } from './versionHistoryParser'
import { defineParserTests } from '../test-harness'

defineParserTests('versionHistory', parseVersionHistory)

const STRIP = `
<div class="f95wg-thread">
  <div class="f95wg-strip">
    <span class="f95wg-strip-label">Versions</span>
    <span class="f95wg-strip-version is-latest" data-xf-init="tooltip" title="from v0.4">v0.5 <span class="f95wg-muted">· <time class="u-dt" datetime="2026-10-25T10:21:09+0100" data-timestamp="1792920069">Today at 10:21 AM</time></span></span>
    <span class="f95wg-strip-version" data-xf-init="tooltip" title="">v0.4 <span class="f95wg-muted">· <time class="u-dt" datetime="2026-09-20T16:32:42+0200">Sep 20, 2026</time></span></span>
    <span class="f95wg-muted f95wg-strip-gap">a new version about every 2 weeks</span>
  </div>
</div>
`

describe('versionHistory unit', () => {
  it('reads versions, previous versions, dates and cadence', () => {
    expect(parseVersionHistory(STRIP)).toEqual({
      versions: [
        { version: 'v0.5', previousVersion: 'v0.4', releasedAt: 1792920069000 },
        { version: 'v0.4', previousVersion: '', releasedAt: Date.parse('2026-09-20T16:32:42+0200') }
      ],
      cadenceDays: 14
    })
  })

  it('returns an empty history without the strip', () => {
    expect(parseVersionHistory('<div class="p-body"></div>')).toEqual({ versions: [], cadenceDays: null })
  })

  it('understands cadence wording', () => {
    expect(cadenceDays('a new version about every 37 days')).toBe(37)
    expect(cadenceDays('a new version about every day')).toBe(1)
    expect(cadenceDays('a new version about every week')).toBe(7)
    expect(cadenceDays('a new version about every 3 months')).toBe(90)
    expect(cadenceDays('')).toBeNull()
  })
})
