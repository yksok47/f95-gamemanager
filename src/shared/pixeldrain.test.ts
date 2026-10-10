import { describe, expect, test } from 'bun:test'
import {
  isPixeldrainPageUrl,
  pixeldrainDownloadUrl,
  pixeldrainFileIdFromUrl,
  pixeldrainFilesFromListBody,
  pixeldrainListIdFromUrl,
  resolvePixeldrainFromFetch
} from './pixeldrain'
import type { ConnectorFetch } from './connector'

const jsonFetch =
  (body: string): ConnectorFetch =>
  async () =>
    ({
      ok: true,
      status: 200,
      url: 'https://pixeldrain.com/api/list/listid',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => body
    })

describe('isPixeldrainPageUrl', () => {
  test('matches file and list pages on both hosts', () => {
    expect(isPixeldrainPageUrl('https://pixeldrain.com/u/abc123')).toBe(true)
    expect(isPixeldrainPageUrl('https://www.pixeldrain.net/u/abc123?download')).toBe(true)
    expect(isPixeldrainPageUrl('https://pixeldrain.com/l/listid')).toBe(true)
  })

  test('rejects unrelated pages', () => {
    expect(isPixeldrainPageUrl('https://pixeldrain.com/')).toBe(false)
    expect(isPixeldrainPageUrl('https://mediafire.com/file/abc')).toBe(false)
  })
})

describe('pixeldrain ids', () => {
  test('reads file and list ids', () => {
    expect(pixeldrainFileIdFromUrl('https://pixeldrain.com/u/AbC123')).toBe('AbC123')
    expect(pixeldrainListIdFromUrl('https://pixeldrain.com/l/xyz')).toBe('xyz')
  })
})

describe('resolvePixeldrainFromFetch', () => {
  test('maps a file page to the API download URL', async () => {
    expect(await resolvePixeldrainFromFetch('https://pixeldrain.com/u/abc', jsonFetch('{}'))).toBe(
      'https://pixeldrain.com/api/file/abc?download'
    )
    expect(pixeldrainDownloadUrl('https://pixeldrain.net', 'abc')).toBe(
      'https://pixeldrain.net/api/file/abc?download'
    )
  })

  test('returns every file on a list for the OS picker', async () => {
    const body = JSON.stringify({
      files: [
        { id: 'notes', name: 'readme.txt', size: 12 },
        { id: 'win', name: 'Game-Win.zip', size: 900 },
        { id: 'linux', name: 'Game-Linux.zip', size: 800 }
      ]
    })
    expect(pixeldrainFilesFromListBody(body).map((file) => file.id)).toEqual(['notes', 'win', 'linux'])
    expect(await resolvePixeldrainFromFetch('https://pixeldrain.com/l/pack', jsonFetch(body))).toEqual([
      { name: 'readme.txt', size: 12, url: 'https://pixeldrain.com/api/file/notes?download' },
      { name: 'Game-Win.zip', size: 900, url: 'https://pixeldrain.com/api/file/win?download' },
      { name: 'Game-Linux.zip', size: 800, url: 'https://pixeldrain.com/api/file/linux?download' }
    ])
  })
})
