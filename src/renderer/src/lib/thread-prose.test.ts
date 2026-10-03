import { describe, expect, test } from 'bun:test'
import { postIdFromHref, threadIdFromHref } from './thread-prose'

describe('postIdFromHref', () => {
  test('reads common F95zone post URL shapes', () => {
    expect(postIdFromHref('https://f95zone.to/posts/1106178/')).toBe(1106178)
    expect(postIdFromHref('https://f95zone.to/threads/game.18207/post-1106178')).toBe(1106178)
    expect(postIdFromHref('https://f95zone.to/threads/game.18207/#post-1106178')).toBe(1106178)
    expect(postIdFromHref('/goto/post?id=42')).toBe(42)
    expect(postIdFromHref('https://f95zone.to/threads/18207/', 9)).toBe(9)
  })
})

describe('threadIdFromHref', () => {
  test('reads the numeric thread id from a thread URL', () => {
    expect(threadIdFromHref('https://f95zone.to/threads/314326/')).toBe(314326)
    expect(threadIdFromHref('https://f95zone.to/threads/f95-game-manager.314326/')).toBe(314326)
    expect(threadIdFromHref('/somewhere', 12)).toBe(12)
    expect(threadIdFromHref('https://example.com/')).toBe(0)
  })
})
