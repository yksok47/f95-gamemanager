import { describe, expect, test } from 'bun:test'
import {
  CONTENT_KIND_IDS,
  isRenpyModPackage,
  isRenpyOverlayKind,
  isRenpyOverlayPackage,
  isRenpyPatchPackage,
  isRenpyUncensorPackage,
  renpyOverlayKind,
  renpyOverlayLabel
} from './types'

describe('Ren\'Py overlay packages', () => {
  test('treats patch, uncensor, and mod as overlay-installable', () => {
    const patch = { os: [0], contentKind: CONTENT_KIND_IDS.patch, version: '' }
    const uncensor = { os: [0], contentKind: CONTENT_KIND_IDS.uncensor, version: '' }
    const mod = { os: [0], contentKind: CONTENT_KIND_IDS.mod, version: '' }
    const game = { os: [0], contentKind: CONTENT_KIND_IDS.game, version: '1.0' }

    expect(isRenpyPatchPackage(patch)).toBe(true)
    expect(isRenpyUncensorPackage(uncensor)).toBe(true)
    expect(isRenpyModPackage(mod)).toBe(true)
    expect(isRenpyOverlayPackage(patch)).toBe(true)
    expect(isRenpyOverlayPackage(uncensor)).toBe(true)
    expect(isRenpyOverlayPackage(mod)).toBe(true)
    expect(isRenpyOverlayPackage(game)).toBe(false)
    expect(renpyOverlayKind(patch)).toBe('patch')
    expect(renpyOverlayKind(mod)).toBe('mod')
    expect(renpyOverlayLabel('mod')).toBe('mod')
    expect(renpyOverlayLabel('uncensor')).toBe('uncensor patch')
    expect(renpyOverlayLabel('patch')).toBe('patch')
    expect(isRenpyOverlayKind('patch')).toBe(true)
    expect(isRenpyOverlayKind('other')).toBe(false)
  })
})
