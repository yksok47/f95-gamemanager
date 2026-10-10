import { describe, expect, test } from 'bun:test'
import {
  isVikingFileCdnUrl,
  isVikingFilePageUrl,
  vikingFileDirectUrlFromBody,
  vikingFileHashFromUrl,
  vikingFileMetaFromCheckBody
} from './vikingfile'

describe('isVikingFilePageUrl', () => {
  test('matches file landing pages on both hosts', () => {
    expect(isVikingFilePageUrl('https://vikingfile.com/f/IYQDK1lzRf')).toBe(true)
    expect(isVikingFilePageUrl('https://www.vikingfile.com/f/g2HZQBypsL#harem')).toBe(true)
    expect(isVikingFilePageUrl('https://vik1ngfile.site/f/7G76QcYa8s')).toBe(true)
  })

  test('rejects generated file URLs and unrelated pages', () => {
    expect(isVikingFileCdnUrl('https://cdn.vik1ngfile.site/token/Game.zip')).toBe(true)
    expect(isVikingFilePageUrl('https://cdn.vik1ngfile.site/token/Game.zip')).toBe(false)
    expect(isVikingFilePageUrl('https://vikingfile.com/api')).toBe(false)
    expect(isVikingFilePageUrl('https://pixeldrain.com/u/abc')).toBe(false)
  })
})

describe('vikingFileHashFromUrl', () => {
  test('reads the file id', () => {
    expect(vikingFileHashFromUrl('https://vikingfile.com/f/IYQDK1lzRf')).toBe('IYQDK1lzRf')
    expect(vikingFileHashFromUrl('https://vikingfile.com/f/7lla6LUWrb#harem')).toBe('7lla6LUWrb')
  })
})

describe('vikingFileDirectUrlFromBody', () => {
  test('reads the captcha POST JSON', () => {
    expect(
      vikingFileDirectUrlFromBody(
        JSON.stringify({
          link: 'https://s3.eu-central-1.amazonaws.com/bucket/Game.zip?X-Amz-Signature=1'
        })
      )
    ).toBe('https://s3.eu-central-1.amazonaws.com/bucket/Game.zip?X-Amz-Signature=1')
  })

  test('reads a filled-in download-link href', () => {
    const html = `
      <a id="download-link" class="button"
         href="https://download.vik1ngfile.site/abc/Game-v1.zip">Download</a>
    `
    expect(vikingFileDirectUrlFromBody(html)).toBe('https://download.vik1ngfile.site/abc/Game-v1.zip')
  })

  test('ignores the landing button before a file URL is generated', () => {
    const html = `<a id="download-link" rel="noopener noreferrer" class="button hidden">Generating download link </a>`
    expect(vikingFileDirectUrlFromBody(html)).toBe(null)
  })
})

describe('vikingFileMetaFromCheckBody', () => {
  test('reads check-file rows', () => {
    expect(
      vikingFileMetaFromCheckBody(
        '[{"exist":true,"hash":"IYQDK1lzRf","name":"Game.zip","size":100}]',
        'IYQDK1lzRf'
      )
    ).toEqual({
      exist: true,
      hash: 'IYQDK1lzRf',
      name: 'Game.zip',
      size: 100
    })
  })
})
