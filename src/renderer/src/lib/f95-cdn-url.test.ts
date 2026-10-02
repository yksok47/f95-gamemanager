import { describe, expect, test } from 'bun:test'
import { f95AttachmentThumbUrl } from './f95-cdn-url'

describe('f95AttachmentThumbUrl', () => {
  test('inserts /thumb/ before the filename on attachments hosts', () => {
    expect(
      f95AttachmentThumbUrl(
        'https://attachments.f95zone.to/2026/02/5781333_U4_190_ScarletMovesIn_V01_Final.jpg'
      )
    ).toBe('https://attachments.f95zone.to/2026/02/thumb/5781333_U4_190_ScarletMovesIn_V01_Final.jpg')
    expect(
      f95AttachmentThumbUrl('https://attachments.f95zone.com/2019/05/308212_ohmy.png')
    ).toBe('https://attachments.f95zone.com/2019/05/thumb/308212_ohmy.png')
  })

  test('keeps an existing thumb path and non-attachment urls', () => {
    const thumb = 'https://attachments.f95zone.to/2026/02/thumb/5781331_preview.png'
    expect(f95AttachmentThumbUrl(thumb)).toBe(thumb)
    const preview = 'https://preview.f95zone.to/data/covers/abc.jpg'
    expect(f95AttachmentThumbUrl(preview)).toBe(preview)
    const other = 'https://i.imgur.com/shot.jpg'
    expect(f95AttachmentThumbUrl(other)).toBe(other)
  })

  test('preserves query strings', () => {
    expect(
      f95AttachmentThumbUrl('https://attachments.f95zone.to/2024/12/4407424_shot.jpg?foo=1')
    ).toBe('https://attachments.f95zone.to/2024/12/thumb/4407424_shot.jpg?foo=1')
  })
})
