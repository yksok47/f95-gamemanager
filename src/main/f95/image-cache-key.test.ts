import { describe, expect, test } from 'bun:test'
import {
  f95ImgProtocolUrl,
  imageCacheFileName,
  isF95CdnImageUrl,
  normalizeImageCacheUrl,
  originalUrlFromProtocolRequest,
  sniffImageMime
} from './image-cache-key'

describe('isF95CdnImageUrl', () => {
  test('accepts preview and attachments hosts', () => {
    expect(isF95CdnImageUrl('https://preview.f95zone.to/data/cover.jpg')).toBe(true)
    expect(isF95CdnImageUrl('https://attachments.f95zone.to/data/full.png')).toBe(true)
    expect(isF95CdnImageUrl('https://preview.f95zone.com/x.webp')).toBe(true)
  })

  test('rejects the forum host and non-https', () => {
    expect(isF95CdnImageUrl('https://f95zone.to/threads/1')).toBe(false)
    expect(isF95CdnImageUrl('http://preview.f95zone.to/cover.jpg')).toBe(false)
    expect(isF95CdnImageUrl('https://example.com/cover.jpg')).toBe(false)
  })
})

describe('normalizeImageCacheUrl', () => {
  test('strips the renderer retry nonce and hash', () => {
    expect(normalizeImageCacheUrl('https://preview.f95zone.to/cover.jpg?_gm_retry=3#x')).toBe(
      'https://preview.f95zone.to/cover.jpg'
    )
  })

  test('keeps other query params', () => {
    expect(normalizeImageCacheUrl('https://preview.f95zone.to/cover.jpg?w=200&_gm_retry=1')).toBe(
      'https://preview.f95zone.to/cover.jpg?w=200'
    )
  })
})

describe('imageCacheFileName', () => {
  test('keys by normalized url', () => {
    const a = imageCacheFileName('https://preview.f95zone.to/cover.jpg')
    const b = imageCacheFileName('https://preview.f95zone.to/cover.jpg?_gm_retry=2')
    const c = imageCacheFileName('https://preview.f95zone.to/other.jpg')
    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe('f95ImgProtocolUrl', () => {
  test('round-trips the original url', () => {
    const url = 'https://attachments.f95zone.to/data/shot.png?foo=1'
    expect(originalUrlFromProtocolRequest(f95ImgProtocolUrl(url))).toBe(url)
  })

  test('rejects protocol requests for non-cdn urls', () => {
    expect(originalUrlFromProtocolRequest(f95ImgProtocolUrl('https://evil.example/x.png'))).toBeNull()
  })
})

describe('sniffImageMime', () => {
  test('detects png jpeg gif webp avif', () => {
    expect(sniffImageMime(Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(sniffImageMime(Uint8Array.of(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffImageMime(Buffer.from('GIF89a'))).toBe('image/gif')
    expect(
      sniffImageMime(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))
    ).toBe('image/webp')
    const avif = Buffer.alloc(12)
    avif.write('ftyp', 4)
    avif.write('avif', 8)
    expect(sniffImageMime(avif)).toBe('image/avif')
    expect(sniffImageMime(Buffer.from('<html>'))).toBeNull()
  })
})
