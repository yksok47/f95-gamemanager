import { describe, expect, test } from 'bun:test'
import {
  applyEmbedRequestHeaders,
  embedRefererForUrl,
  shouldSpoofEmbedClientHint
} from './embed-referer'

describe('shouldSpoofEmbedClientHint', () => {
  test('spoofs packaged file origins and missing values', () => {
    expect(shouldSpoofEmbedClientHint(undefined)).toBe(true)
    expect(shouldSpoofEmbedClientHint('')).toBe(true)
    expect(shouldSpoofEmbedClientHint('null')).toBe(true)
    expect(shouldSpoofEmbedClientHint('file:///C:/app/index.html')).toBe(true)
  })

  test('keeps vite serve and real https pages', () => {
    expect(shouldSpoofEmbedClientHint('http://localhost:5173/')).toBe(false)
    expect(shouldSpoofEmbedClientHint('https://f95zone.to/threads/1')).toBe(false)
  })
})

describe('embedRefererForUrl', () => {
  test('maps player CDNs to a first-party https referer', () => {
    expect(embedRefererForUrl('https://www.youtube.com/embed/abc')).toBe('https://www.youtube.com/')
    expect(embedRefererForUrl('https://r3---sn-abc.googlevideo.com/videoplayback')).toBe(
      'https://www.youtube.com/'
    )
    expect(embedRefererForUrl('https://player.vimeo.com/video/1')).toBe('https://player.vimeo.com/')
  })
})

describe('applyEmbedRequestHeaders', () => {
  test('rewrites file:// referer but leaves origin alone', () => {
    const headers = applyEmbedRequestHeaders(
      { Referer: 'file:///C:/app/index.html', Origin: 'file://' },
      'https://www.youtube.com/embed/abc'
    )
    expect(headers.Referer).toBe('https://www.youtube.com/')
    expect(headers.Origin).toBe('file://')
  })

  test('does not rewrite localhost serve headers', () => {
    const headers = applyEmbedRequestHeaders(
      { Referer: 'http://localhost:5173/', Origin: 'http://localhost:5173' },
      'https://www.youtube.com/embed/abc'
    )
    expect(headers.Referer).toBe('http://localhost:5173/')
    expect(headers.Origin).toBe('http://localhost:5173')
  })
})
