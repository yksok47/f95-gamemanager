import { describe, expect, test } from 'bun:test'
import { downloadLinkKey, sourceLinksFor } from './download-links'

describe('downloadLinkKey', () => {
  test('matches the metadata API normalization', () => {
    expect(downloadLinkKey(' HTTPS://Pixeldrain.COM:443/u/AbC/ ')).toBe('https://pixeldrain.com/u/AbC')
    expect(downloadLinkKey('http://example.com:80/a//')).toBe('http://example.com/a')
    expect(downloadLinkKey('http://example.com:443/a')).toBe('http://example.com:443/a')
    expect(downloadLinkKey('https://mega.nz/file/x#Key/')).toBe('https://mega.nz/file/x#Key/')
    expect(downloadLinkKey('https://example.com/?a=1/')).toBe('https://example.com/?a=1/')
    expect(downloadLinkKey('https://example.com/')).toBe('https://example.com')
  })

  test('rejects non-http and malformed links', () => {
    expect(downloadLinkKey('')).toBeNull()
    expect(downloadLinkKey('p2p:abc')).toBeNull()
    expect(downloadLinkKey('ftp://example.com/x')).toBeNull()
    expect(downloadLinkKey('https://example.com/a b')).toBeNull()
    expect(downloadLinkKey(`https://example.com/${'a'.repeat(2048)}`)).toBeNull()
  })
})

describe('sourceLinksFor', () => {
  test('puts the clicked link first and drops duplicates and non-http mirrors', () => {
    expect(
      sourceLinksFor('https://gofile.io/d/x', [
        'https://pixeldrain.com/u/a',
        'https://GOFILE.io/d/x/',
        'p2p:abc',
        'https://pixeldrain.com/u/a'
      ])
    ).toEqual(['https://gofile.io/d/x', 'https://pixeldrain.com/u/a'])
  })

  test('caps at the API limit', () => {
    const mirrors = Array.from({ length: 30 }, (_, index) => `https://example.com/${index}`)
    expect(sourceLinksFor(mirrors[0], mirrors)).toHaveLength(16)
  })
})
