import { describe, expect, test } from 'bun:test'
import { catalogLookupAttempts } from './catalog-lookup-attempts'
import { sanitizeCatalogQuery } from './sanitize-query'

describe('catalogLookupAttempts', () => {
  test('tries title+author, then title, then author', () => {
    expect(catalogLookupAttempts('The Big Step', 'Studio Name')).toEqual([
      { search: 'The Big Step', creator: 'Studio Name' },
      { search: 'The Big Step' },
      { creator: 'Studio Name' }
    ])
  })

  test('reads author from [creator] title tags', () => {
    expect(catalogLookupAttempts('Forest Walk [1.0] [Alice]')).toEqual([
      { search: 'Forest Walk', creator: 'Alice' },
      { search: 'Forest Walk' },
      { creator: 'Alice' }
    ])
  })

  test('skips title filters that sanitize to empty stopwords', () => {
    expect(sanitizeCatalogQuery('The')).toBe('')
    expect(catalogLookupAttempts('The', 'Alice')).toEqual([{ creator: 'Alice' }])
  })

  test('skips author when missing', () => {
    expect(catalogLookupAttempts('Forest Walk')).toEqual([{ search: 'Forest Walk' }])
  })
})
