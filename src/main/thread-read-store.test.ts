import { describe, expect, test } from 'bun:test'
import { lastReadNeedsPageFallback } from '@shared/types'
import { parseThreadReadStore } from './thread-read-parse'

describe('parseThreadReadStore', () => {
  test('keeps post ids from old records that have no page', () => {
    const store = parseThreadReadStore({
      version: 1,
      lastRead: {
        '99': { postId: 22, updatedAt: 10 }
      }
    })
    expect(store.lastRead['99']).toEqual({ postId: 22, updatedAt: 10 })
  })

  test('reads the backup page when present', () => {
    const store = parseThreadReadStore({
      version: 1,
      lastRead: {
        '99': { postId: 22, page: 7, updatedAt: 10 }
      }
    })
    expect(store.lastRead['99']).toEqual({ postId: 22, page: 7, updatedAt: 10 })
  })

  test('drops invalid pages and post ids', () => {
    const store = parseThreadReadStore({
      lastRead: {
        '1': { postId: 8, page: 0, updatedAt: 1 },
        '2': { postId: 0, page: 3, updatedAt: 1 },
        nope: { postId: 9, page: 2, updatedAt: 1 }
      }
    })
    expect(store.lastRead['1']).toEqual({ postId: 8, updatedAt: 1 })
    expect(store.lastRead['2']).toBeUndefined()
    expect(store.lastRead.nope).toBeUndefined()
  })
})

describe('lastReadNeedsPageFallback', () => {
  test('stays on the post when it is still on the loaded page', () => {
    expect(
      lastReadNeedsPageFallback(22, 7, { page: 7, posts: [{ postId: 21 }, { postId: 22 }] })
    ).toBe(false)
  })

  test('uses the stored page when the linked post is gone', () => {
    expect(lastReadNeedsPageFallback(22, 7, { page: 1, posts: [{ postId: 3 }] })).toBe(true)
  })

  test('does not refetch when the fallback page is already loaded', () => {
    expect(lastReadNeedsPageFallback(22, 7, { page: 7, posts: [{ postId: 30 }] })).toBe(false)
  })

  test('does nothing without a stored page', () => {
    expect(lastReadNeedsPageFallback(22, null, { page: 1, posts: [] })).toBe(false)
  })
})
