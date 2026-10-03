import { describe, expect, test } from 'bun:test'
import { filterOverviewFields } from './thread-overview'

describe('filterOverviewFields', () => {
  test('keeps useful first-post fields and drops dates, related games, and genre', () => {
    expect(
      filterOverviewFields([
        { label: 'Developer', value: 'Piotr' },
        { label: 'Status', value: 'Ongoing' },
        { label: 'Updated', value: '2026-10-01' },
        { label: 'Release date', value: '2024-01-01' },
        { label: 'Related games', value: 'Other' },
        { label: 'Genre', value: 'Tool' },
        { label: 'OS', value: 'Windows' }
      ])
    ).toEqual([
      { label: 'Developer', value: 'Piotr' },
      { label: 'Status', value: 'Ongoing' },
      { label: 'OS', value: 'Windows' }
    ])
  })
})
