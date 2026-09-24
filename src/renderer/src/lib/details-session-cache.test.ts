import { describe, expect, test, beforeEach } from 'bun:test'
import type { ThreadDetails } from '@shared/types'
import {
  readDetailsSession,
  resetDetailsSessionCacheForTests,
  syncOpenDetailThreads,
  writeDetailsSession
} from './details-session-cache'

function details(threadId: number, descriptionHtml: string): ThreadDetails {
  return {
    threadId,
    threadUrl: `https://f95zone.to/threads/${threadId}/`,
    title: 'Game',
    creator: 'Author',
    version: '1.0',
    coverUrl: 'https://attachments.example/cover.jpg',
    tags: [],
    fields: [],
    creatorLinks: [],
    relatedGames: [],
    releaseDate: '',
    updatedAt: '',
    descriptionHtml,
    notes: [],
    changelog: [],
    gallery: ['https://attachments.example/shot.jpg'],
    downloads: [],
    reviews: [],
    reviewsTotal: 0,
    reviewsTotalPages: 1,
    engine: '',
    likes: 0,
    views: 0,
    ignored: false
  }
}

describe('details session cache', () => {
  beforeEach(() => {
    resetDetailsSessionCacheForTests()
  })

  test('keeps parsed text and the selected tab while the game is on the taskbar', () => {
    syncOpenDetailThreads([7])
    writeDetailsSession(7, { details: details(7, '<p>Hello</p>'), tab: 'changelog' })

    expect(readDetailsSession(7)?.details?.descriptionHtml).toBe('<p>Hello</p>')
    expect(readDetailsSession(7)?.tab).toBe('changelog')
    expect(readDetailsSession(7)?.details?.gallery).toEqual(['https://attachments.example/shot.jpg'])
  })

  test('drops the session when the game leaves the taskbar and ignores later writes', () => {
    syncOpenDetailThreads([7])
    writeDetailsSession(7, { details: details(7, '<p>Hello</p>'), tab: 'files' })

    syncOpenDetailThreads([])

    expect(readDetailsSession(7)).toBeUndefined()
    writeDetailsSession(7, { details: details(7, '<p>Again</p>'), tab: 'about' })
    syncOpenDetailThreads([7])
    expect(readDetailsSession(7)).toBeUndefined()
  })

  test('updates the tab without discarding parsed details', () => {
    syncOpenDetailThreads([4])
    writeDetailsSession(4, { details: details(4, '<p>Body</p>'), tab: 'overview' })
    writeDetailsSession(4, { tab: 'reviews' })

    expect(readDetailsSession(4)?.tab).toBe('reviews')
    expect(readDetailsSession(4)?.details?.descriptionHtml).toBe('<p>Body</p>')
  })
})
