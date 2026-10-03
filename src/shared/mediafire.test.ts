import { describe, expect, test } from 'bun:test'
import {
  isMediaFireCdnUrl,
  isMediaFirePageUrl,
  mediaFireDirectUrlFromHtml
} from './mediafire'

describe('isMediaFirePageUrl', () => {
  test('matches file interstitials', () => {
    expect(isMediaFirePageUrl('https://www.mediafire.com/file/abc123/Game.zip')).toBe(true)
    expect(isMediaFirePageUrl('https://mediafire.com/file/abc123/Game.zip/file')).toBe(true)
    expect(isMediaFirePageUrl('https://www.mediafire.com/download/abc123')).toBe(true)
    expect(isMediaFirePageUrl('https://www.mediafire.com/?4s1uh7mv6olz269')).toBe(true)
  })

  test('rejects CDN URLs and unrelated pages', () => {
    expect(isMediaFireCdnUrl('https://download1234.mediafire.com/token/Game.zip')).toBe(true)
    expect(isMediaFirePageUrl('https://download1234.mediafire.com/token/Game.zip')).toBe(false)
    expect(isMediaFirePageUrl('https://www.mediafire.com/about')).toBe(false)
  })
})

describe('mediaFireDirectUrlFromHtml', () => {
  test('reads the download button href', () => {
    const html = `
      <a class="input popsok"
         href="https://download2390.mediafire.com/abc/Game-v1.zip"
         id="downloadButton">Download</a>
    `
    expect(mediaFireDirectUrlFromHtml(html)).toBe(
      'https://download2390.mediafire.com/abc/Game-v1.zip'
    )
  })

  test('reads aria-label download links and html-encoded ampersands', () => {
    const html = `
      <a aria-label="Download file"
         href="https://download1.mediafire.com/x/Game.zip?token=1&amp;y=2">DL</a>
    `
    expect(mediaFireDirectUrlFromHtml(html)).toBe(
      'https://download1.mediafire.com/x/Game.zip?token=1&y=2'
    )
  })

  test('ignores a button that still points at the interstitial', () => {
    const html = `<a href="https://www.mediafire.com/file_premium/abc" id="downloadButton">`
    expect(mediaFireDirectUrlFromHtml(html)).toBe(null)
  })
})
