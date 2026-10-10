import { describe, expect, test } from 'bun:test'
import { isUploadHavenPageUrl, uploadHavenIdFromUrl, uploadHavenPageUrl } from './uploadhaven'

describe('isUploadHavenPageUrl', () => {
  test('matches /download/<id> pages', () => {
    expect(isUploadHavenPageUrl('https://uploadhaven.com/download/c1b409d9e0e23ab67af8ddf0a55c6d26')).toBe(
      true
    )
    expect(
      isUploadHavenPageUrl('https://www.uploadhaven.com/download/d680f8a4166b43619434504e340b5aaf')
    ).toBe(true)
    expect(uploadHavenIdFromUrl('https://uploadhaven.com/download/c1b409d9e0e23ab67af8ddf0a55c6d26')).toBe(
      'c1b409d9e0e23ab67af8ddf0a55c6d26'
    )
    expect(uploadHavenPageUrl('https://www.uploadhaven.com/download/abc123def4567890')).toBe(
      'https://uploadhaven.com/download/abc123def4567890'
    )
  })

  test('rejects site chrome', () => {
    expect(isUploadHavenPageUrl('https://uploadhaven.com/')).toBe(false)
    expect(isUploadHavenPageUrl('https://uploadhaven.com/account/login')).toBe(false)
    expect(isUploadHavenPageUrl('https://uploadhaven.com/download')).toBe(false)
    expect(isUploadHavenPageUrl('https://pixeldrain.com/u/abc')).toBe(false)
  })
})
