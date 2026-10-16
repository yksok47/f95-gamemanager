import { describe, expect, test } from 'bun:test'
import { parseThreadLinks, titleFromThreadSlug } from './thread-links'

describe('parseThreadLinks', () => {
  test('finds thread links separated by newlines, spaces and commas', () => {
    const text = [
      'https://f95zone.to/threads/being-a-dik-v0-9-1-dr-pinkcake.5765/',
      'f95zone.to/threads/12345 , https://f95zone.to/threads/other-game.777/post-999',
      'http://www.f95zone.to/threads/another.42/page-3#post-1'
    ].join('\n')
    expect(parseThreadLinks(text)).toEqual([
      { threadId: 5765, slug: 'being-a-dik-v0-9-1-dr-pinkcake' },
      { threadId: 12345, slug: '' },
      { threadId: 777, slug: 'other-game' },
      { threadId: 42, slug: 'another' }
    ])
  })

  test('drops duplicates and non-thread links', () => {
    const text = [
      'https://f95zone.to/threads/game.10/',
      'https://f95zone.to/threads/game-renamed.10/',
      'https://f95zone.to/forums/games.2/',
      'https://example.com/threads/game.11/'
    ].join('\n')
    expect(parseThreadLinks(text)).toEqual([{ threadId: 10, slug: 'game' }])
  })

  test('returns nothing for empty input', () => {
    expect(parseThreadLinks('')).toEqual([])
    expect(parseThreadLinks('no links here')).toEqual([])
  })
})

describe('titleFromThreadSlug', () => {
  test('turns a slug into words', () => {
    expect(titleFromThreadSlug('being-a-dik-v0-9-1', 1)).toBe('Being A Dik V0 9 1')
  })

  test('falls back to the thread id', () => {
    expect(titleFromThreadSlug('', 123)).toBe('Thread 123')
  })
})
