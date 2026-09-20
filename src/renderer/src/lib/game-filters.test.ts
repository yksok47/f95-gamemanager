import { describe, expect, test } from 'bun:test'
import { matchesLocalFilters, selectedChipIds } from './game-filters'

describe('selectedChipIds', () => {
  test('collects include and exclude ids', () => {
    const state = { 1: 'include', 2: 'exclude', 3: 'off', 4: 'include' } as const
    expect(selectedChipIds(state, 'include')).toEqual([1, 4])
    expect(selectedChipIds(state, 'exclude')).toEqual([2])
  })
})

describe('matchesLocalFilters', () => {
  const game = { prefixes: [18, 7], tags: [10, 20, 30], creator: 'Alice Writer' }

  test('passes when no filters are set', () => {
    expect(
      matchesLocalFilters(game, {
        includePrefixes: [],
        excludePrefixes: [],
        includeTags: [],
        excludeTags: [],
        tagType: 'or',
        creator: ''
      })
    ).toBe(true)
  })

  test('requires every included prefix', () => {
    const query = {
      includePrefixes: [18, 7],
      excludePrefixes: [],
      includeTags: [],
      excludeTags: [],
      tagType: 'or' as const,
      creator: ''
    }
    expect(matchesLocalFilters(game, query)).toBe(true)
    expect(matchesLocalFilters(game, { ...query, includePrefixes: [18, 99] })).toBe(false)
  })

  test('rejects games with an excluded prefix', () => {
    expect(
      matchesLocalFilters(game, {
        includePrefixes: [],
        excludePrefixes: [3],
        includeTags: [],
        excludeTags: [],
        tagType: 'or',
        creator: ''
      })
    ).toBe(true)
    expect(
      matchesLocalFilters(game, {
        includePrefixes: [],
        excludePrefixes: [18],
        includeTags: [],
        excludeTags: [],
        tagType: 'or',
        creator: ''
      })
    ).toBe(false)
  })

  test('matches included tags with OR or AND', () => {
    const base = {
      includePrefixes: [],
      excludePrefixes: [],
      excludeTags: [],
      creator: ''
    }
    expect(matchesLocalFilters(game, { ...base, includeTags: [10, 99], tagType: 'or' })).toBe(true)
    expect(matchesLocalFilters(game, { ...base, includeTags: [10, 99], tagType: 'and' })).toBe(false)
    expect(matchesLocalFilters(game, { ...base, includeTags: [10, 20], tagType: 'and' })).toBe(true)
  })

  test('rejects games with an excluded tag', () => {
    expect(
      matchesLocalFilters(game, {
        includePrefixes: [],
        excludePrefixes: [],
        includeTags: [],
        excludeTags: [99],
        tagType: 'or',
        creator: ''
      })
    ).toBe(true)
    expect(
      matchesLocalFilters(game, {
        includePrefixes: [],
        excludePrefixes: [],
        includeTags: [],
        excludeTags: [20],
        tagType: 'or',
        creator: ''
      })
    ).toBe(false)
  })

  test('matches creator case-insensitively', () => {
    const query = {
      includePrefixes: [],
      excludePrefixes: [],
      includeTags: [],
      excludeTags: [],
      tagType: 'or' as const,
      creator: 'alice'
    }
    expect(matchesLocalFilters(game, query)).toBe(true)
    expect(matchesLocalFilters(game, { ...query, creator: 'bob' })).toBe(false)
  })
})
