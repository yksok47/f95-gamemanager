import { describe, expect, test } from 'bun:test'
import { hostLinkFromHtml, isF95GateUrl, normalizeUnmaskedUrl } from './f95-masked'

const PAGE = 'https://f95zone.to/masked/mega.nz/1/2/abc'

describe('isF95GateUrl', () => {
  test('matches forum hosts only', () => {
    expect(isF95GateUrl(PAGE)).toBe(true)
    expect(isF95GateUrl('https://www.f95zone.to/threads/1/')).toBe(true)
    expect(isF95GateUrl('https://mega.nz/file/abc#key')).toBe(false)
    expect(isF95GateUrl('https://pixeldrain.com/u/abc')).toBe(false)
  })
})

describe('normalizeUnmaskedUrl', () => {
  test('rejects F95 pages and restores a MEGA fragment encoded as %23', () => {
    expect(normalizeUnmaskedUrl(PAGE)).toBeNull()
    expect(normalizeUnmaskedUrl('/threads/1/', PAGE)).toBeNull()
    expect(normalizeUnmaskedUrl('https://mega.nz/file/abc%23decryptionkey')).toBe(
      'https://mega.nz/file/abc#decryptionkey'
    )
    expect(normalizeUnmaskedUrl('https://pixeldrain.com/u/AbC')).toBe('https://pixeldrain.com/u/AbC')
  })
})

describe('hostLinkFromHtml', () => {
  test('reads a.host_link, including when class comes after href', () => {
    expect(
      hostLinkFromHtml(
        '<a class="button host_link" href="https://mega.nz/file/abc#key">Continue to Mega</a>',
        PAGE
      )
    ).toBe('https://mega.nz/file/abc#key')
    expect(
      hostLinkFromHtml(
        `<a href="https://pixeldrain.com/u/xyz" class="host_link">Continue to Pixeldrain</a>`,
        PAGE
      )
    ).toBe('https://pixeldrain.com/u/xyz')
  })

  test('reads data-href and Continue to … fallbacks', () => {
    expect(
      hostLinkFromHtml(
        '<a class="host_link" href="#" data-href="https://gofile.io/d/abc">Continue</a>',
        PAGE
      )
    ).toBe('https://gofile.io/d/abc')
    expect(
      hostLinkFromHtml(
        '<a href="https://workupload.com/file/abc">Continue to Workupload</a>',
        PAGE
      )
    ).toBe('https://workupload.com/file/abc')
  })

  test('ignores javascript placeholders and same-site links', () => {
    expect(hostLinkFromHtml('<a class="host_link" href="javascript:void(0)">Continue</a>', PAGE)).toBeNull()
    expect(
      hostLinkFromHtml('<a class="host_link" href="https://f95zone.to/threads/1/">Back</a>', PAGE)
    ).toBeNull()
  })
})
