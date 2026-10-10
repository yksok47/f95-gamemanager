import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_DOWNLOAD_PROVIDER_ORDER,
  mirrorIsOneClick,
  mirrorProvider,
  mirrorTarget,
  normalizeDownloadProviderOrder,
  rankMirrors
} from './download-providers'

const mirror = (label: string, url: string): { label: string; url: string } => ({ label, url })

describe('mirrorTarget', () => {
  test('identifies hosts directly and through F95 masked links', () => {
    expect(mirrorProvider(mirror('PIXELDRAIN', 'https://pixeldrain.com/u/abc'))).toBe('pixeldrain')
    expect(mirrorProvider(mirror('MEGA', 'https://f95zone.to/masked/mega.nz/1/2/abc'))).toBe('mega')
    expect(mirrorProvider(mirror('BUZZHEAVIER', 'https://bzzhr.to/kwkqt9wacoeq'))).toBe('buzzheavier')
    expect(mirrorProvider(mirror('VIKINGFILE', 'https://vik1ngfile.site/f/abc'))).toBe('vikingfile')
    expect(mirrorProvider(mirror('MIXDROP', 'https://mixdrop.top/f/x'))).toBe('mixdrop')
  })

  test('falls back to the link text only for placeholder masked hosts', () => {
    expect(mirrorProvider(mirror('BUZZHEAVIER', 'https://f95zone.to/masked/cancerads/1/2/x'))).toBe(
      'buzzheavier'
    )
    expect(mirrorProvider(mirror('MEGA', 'https://example.com/file'))).toBeNull()
  })

  test('separates forum posts, direct files, and other sites', () => {
    expect(mirrorTarget(mirror('Walkthrough', 'https://f95zone.to/threads/x.1/post-2')).kind).toBe('forum')
    expect(mirrorTarget(mirror('Save', 'https://attachments.f95zone.to/2024/01/123_save.zip')).kind).toBe(
      'file'
    )
    expect(mirrorTarget(mirror('Wiki', 'https://haremhotel.miraheze.org/wiki')).kind).toBe('web')
  })
})

describe('mirrorIsOneClick', () => {
  test('only connected providers on unmasked links skip the browser', () => {
    expect(mirrorIsOneClick(mirror('MEDIAFIRE', 'https://www.mediafire.com/file/abc/Game.zip/file'))).toBe(
      true
    )
    expect(mirrorIsOneClick(mirror('MEDIAFIRE', 'https://f95zone.to/masked/mediafire.com/1/2/x'))).toBe(
      false
    )
    expect(mirrorIsOneClick(mirror('PIXELDRAIN', 'https://pixeldrain.com/u/abc'))).toBe(false)
    expect(mirrorIsOneClick(mirror('VIKINGFILE', 'https://vikingfile.com/f/abc'))).toBe(true)
    expect(mirrorIsOneClick(mirror('VIKINGFILE', 'https://vik1ngfile.site/f/abc'))).toBe(true)
    expect(mirrorIsOneClick(mirror('VIKINGFILE', 'https://f95zone.to/masked/vikingfile.com/1/2/x'))).toBe(
      false
    )
  })
})

describe('rankMirrors', () => {
  const mirrors = [
    mirror('MEGA', 'https://mega.nz/file/a'),
    mirror('Somewhere', 'https://unknown-host.example/a'),
    mirror('PIXELDRAIN', 'https://pixeldrain.com/u/a'),
    mirror('DATANODES', 'https://datanodes.to/a')
  ]

  test('follows the provider order and keeps unknown hosts last', () => {
    const ranked = rankMirrors(mirrors, ['datanodes', 'mega', 'pixeldrain'])
    expect(ranked.map((item) => item.label)).toEqual(['DATANODES', 'MEGA', 'PIXELDRAIN', 'Somewhere'])
  })

  test('direct files beat every host', () => {
    const ranked = rankMirrors(
      [...mirrors, mirror('Direct', 'https://cdn.example/game.zip')],
      DEFAULT_DOWNLOAD_PROVIDER_ORDER
    )
    expect(ranked[0].label).toBe('Direct')
  })
})

describe('normalizeDownloadProviderOrder', () => {
  test('keeps saved order, drops junk, and appends new providers', () => {
    const order = normalizeDownloadProviderOrder(['mega', 'nope', 'mega', 42, 'gofile'])
    expect(order.slice(0, 2)).toEqual(['mega', 'gofile'])
    expect(order).toHaveLength(DEFAULT_DOWNLOAD_PROVIDER_ORDER.length)
    expect(new Set(order).size).toBe(order.length)
  })

  test('defaults when nothing is saved', () => {
    expect(normalizeDownloadProviderOrder(undefined)).toEqual(DEFAULT_DOWNLOAD_PROVIDER_ORDER)
  })
})
