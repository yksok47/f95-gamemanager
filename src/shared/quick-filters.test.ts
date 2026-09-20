import { describe, expect, test } from 'bun:test'
import {
  captureQuickFilterSnapshot,
  emptyQuickFilterSnapshot,
  parseQuickFilters,
  snapshotsEqual
} from './quick-filters'

describe('parseQuickFilters', () => {
  test('keeps valid named snapshots and drops junk', () => {
    const items = parseQuickFilters([
      {
        id: 'a',
        name: '  VN only  ',
        snapshot: {
          prefixState: { '18': 'include', 7: 'exclude', 3: 'off' },
          tagState: { 10: 'include' },
          tagType: 'and',
          creator: ' Alice ',
          favoritesFilter: 'include',
          hatedFilter: 'off'
        }
      },
      { id: '', name: 'bad' },
      { id: 'b', name: '   ' },
      null,
      { id: 'c', name: 'Empty' }
    ])
    expect(items).toHaveLength(2)
    expect(items[0]).toEqual({
      id: 'a',
      name: 'VN only',
      snapshot: {
        prefixState: { 18: 'include', 7: 'exclude' },
        tagState: { 10: 'include' },
        tagType: 'and',
        creator: 'Alice',
        favoritesFilter: 'include',
        hatedFilter: 'off'
      }
    })
    expect(items[1]).toEqual({
      id: 'c',
      name: 'Empty',
      snapshot: emptyQuickFilterSnapshot()
    })
  })
})

describe('snapshotsEqual', () => {
  test('ignores off chips and key order', () => {
    const a = captureQuickFilterSnapshot({
      prefixState: { 1: 'include', 2: 'off' },
      tagState: { 9: 'exclude' },
      tagType: 'or',
      creator: 'bob',
      favoritesFilter: 'off',
      hatedFilter: 'exclude'
    })
    const b = captureQuickFilterSnapshot({
      prefixState: { 1: 'include' },
      tagState: { 9: 'exclude' },
      tagType: 'or',
      creator: 'bob',
      favoritesFilter: 'off',
      hatedFilter: 'exclude'
    })
    expect(snapshotsEqual(a, b)).toBe(true)
    expect(snapshotsEqual(a, { ...b, creator: 'other' })).toBe(false)
  })
})
