import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_DOWNLOAD_PROVIDER_ORDER,
  mirrorIsOneClick,
  mirrorProvider,
  mirrorTarget,
  mirrorUsesConnector,
  normalizeDownloadProviderOrder,
  rankMirrors
} from './download-providers'
import type { DownloadMirror } from './types'

const mirror = (label: string, url: string): { label: string; url: string } => ({ label, url })

describe('mirrorTarget', () => {
  test('identifies hosts directly and through F95 masked links', () => {
    expect(mirrorProvider(mirror('PIXELDRAIN', 'https://pixeldrain.com/u/abc'))).toBe('pixeldrain')
    expect(mirrorProvider(mirror('MEGA', 'https://f95zone.to/masked/mega.nz/1/2/abc'))).toBe('mega')
    expect(mirrorProvider(mirror('BUZZHEAVIER', 'https://bzzhr.to/kwkqt9wacoeq'))).toBe('buzzheavier')
    expect(mirrorProvider(mirror('VIKINGFILE', 'https://vik1ngfile.site/f/abc'))).toBe('vikingfile')
    expect(
      mirrorProvider(mirror('UPLOADHAVEN', 'https://uploadhaven.com/download/c1b409d9e0e23ab67af8ddf0a55c6d26'))
    ).toBe('uploadhaven')
    expect(mirrorProvider(mirror('MIXDROP', 'https://mixdrop.top/f/x'))).toBe('mixdrop')
    expect(mirrorProvider(mirror('MIXDROP', 'https://mxdrop.top/f/x'))).toBe('mixdrop')
  })

  test('falls back to the link text only for placeholder masked hosts', () => {
    expect(mirrorProvider(mirror('BUZZHEAVIER', 'https://f95zone.to/masked/cancerads/1/2/x'))).toBe(
      'buzzheavier'
    )
    expect(mirrorProvider(mirror('UPLOADHEAVEN', 'https://f95zone.to/masked/cancerads/1/2/x'))).toBe(
      'uploadhaven'
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

  test('does not treat the defunct Nopy host as a file or a provider', () => {
    const nopy = mirror('NOPY', 'https://nopy.to/n0e6G5zw/HalloweenSpecial-1.0-pc.zip')
    const files = mirror('NOPY', 'https://files.nopy.to/n0e6G5zw/HalloweenSpecial-1.0-pc.zip')
    const masked = mirror('NOPY', 'https://f95zone.to/masked/nopy.to/1/2/HalloweenSpecial-1.0-pc.zip')
    expect(mirrorTarget(nopy)).toEqual({ kind: 'web', host: 'nopy.to' })
    expect(mirrorTarget(files)).toEqual({ kind: 'web', host: 'files.nopy.to' })
    expect(mirrorTarget(masked)).toEqual({ kind: 'web', host: 'nopy.to' })
    expect(mirrorIsOneClick(nopy)).toBe(false)
    expect(mirrorUsesConnector(nopy)).toBe(false)
  })
})

describe('mirrorUsesConnector', () => {
  test('connected hosts use a connector; other links do not', () => {
    expect(mirrorUsesConnector(mirror('PIXELDRAIN', 'https://pixeldrain.com/u/abc'))).toBe(true)
    expect(mirrorUsesConnector(mirror('MEDIAFIRE', 'https://f95zone.to/masked/mediafire.com/1/2/x'))).toBe(
      true
    )
    expect(mirrorUsesConnector(mirror('MIXDROP', 'https://mixdrop.ag/f/x'))).toBe(true)
    expect(
      mirrorUsesConnector(mirror('Save', 'https://attachments.f95zone.to/2024/01/123_save.zip'))
    ).toBe(false)
  })
})

describe('mirrorIsOneClick', () => {
  test('connected providers skip the browser, including F95 masked links', () => {
    expect(mirrorIsOneClick(mirror('MEDIAFIRE', 'https://www.mediafire.com/file/abc/Game.zip/file'))).toBe(
      true
    )
    expect(mirrorIsOneClick(mirror('MEDIAFIRE', 'https://f95zone.to/masked/mediafire.com/1/2/x'))).toBe(
      true
    )
    expect(mirrorIsOneClick(mirror('PIXELDRAIN', 'https://pixeldrain.com/u/abc'))).toBe(true)
    expect(mirrorIsOneClick(mirror('PIXELDRAIN', 'https://f95zone.to/masked/pixeldrain.com/1/2/x'))).toBe(
      true
    )
    expect(mirrorIsOneClick(mirror('GOFILE', 'https://gofile.io/d/abc'))).toBe(true)
    expect(mirrorIsOneClick(mirror('WORKUPLOAD', 'https://workupload.com/file/abc'))).toBe(true)
    expect(
      mirrorIsOneClick(mirror('UPLOADHAVEN', 'https://uploadhaven.com/download/c1b409d9e0e23ab67af8ddf0a55c6d26'))
    ).toBe(true)
    expect(
      mirrorIsOneClick(mirror('UPLOADHEAVEN', 'https://f95zone.to/masked/uploadhaven.com/1/2/x'))
    ).toBe(true)
    expect(mirrorIsOneClick(mirror('BUZZHEAVIER', 'https://bzzhr.to/kwkqt9wacoeq'))).toBe(true)
    expect(mirrorIsOneClick(mirror('DATANODES', 'https://datanodes.to/abc'))).toBe(true)
    expect(mirrorIsOneClick(mirror('MEGA', 'https://mega.nz/file/abc#key'))).toBe(true)
    expect(mirrorIsOneClick(mirror('MEGA', 'https://f95zone.to/masked/mega.nz/1/2/abc'))).toBe(true)
    expect(mirrorIsOneClick(mirror('GDRIVE', 'https://drive.google.com/file/d/abc/view'))).toBe(true)
    expect(mirrorIsOneClick(mirror('VIKINGFILE', 'https://vikingfile.com/f/abc'))).toBe(true)
    expect(mirrorIsOneClick(mirror('VIKINGFILE', 'https://vik1ngfile.site/f/abc'))).toBe(true)
    expect(mirrorIsOneClick(mirror('VIKINGFILE', 'https://f95zone.to/masked/vikingfile.com/1/2/x'))).toBe(
      true
    )
    expect(mirrorIsOneClick(mirror('MIXDROP', 'https://mixdrop.ag/f/x'))).toBe(true)
    expect(mirrorIsOneClick(mirror('MIXDROP', 'https://mxdrop.top/f/x'))).toBe(true)
    expect(mirrorIsOneClick(mirror('MIXDROP', 'https://f95zone.to/masked/mixdrop.ag/1/2/x'))).toBe(true)
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

  test('defunct Nopy zip links stay last, behind working hosts', () => {
    const ranked = rankMirrors(
      [
        mirror('NOPY', 'https://nopy.to/n0e6G5zw/HalloweenSpecial-1.0-pc.zip'),
        ...mirrors
      ],
      DEFAULT_DOWNLOAD_PROVIDER_ORDER
    )
    expect(ranked[0].label).not.toBe('NOPY')
    expect(ranked.findIndex((item) => item.label === 'NOPY')).toBeGreaterThan(
      ranked.findIndex((item) => item.label === 'DATANODES')
    )
  })

  const peer = (seeders: number | null, harmful = 0): DownloadMirror => ({
    label: 'Peer-to-peer',
    url: 'p2p:abc',
    p2p: {
      contentHash: 'abc',
      filename: 'Game.zip',
      seeders,
      installCount: 3,
      flagCounts: { broken: 0, harmful }
    }
  })

  test('peer-to-peer follows its slot in the provider order', () => {
    const ranked = rankMirrors([...mirrors, peer(2)], ['datanodes', 'p2p', 'mega', 'pixeldrain'])
    expect(ranked.map((item) => item.label)).toEqual([
      'DATANODES',
      'Peer-to-peer',
      'MEGA',
      'PIXELDRAIN',
      'Somewhere'
    ])
    expect(mirrorTarget(peer(2))).toEqual({ kind: 'provider', provider: 'p2p' })
    expect(mirrorIsOneClick(peer(2))).toBe(true)
    expect(mirrorUsesConnector(peer(2))).toBe(false)
  })

  test('unseeded or harmful peer copies drop behind every posted link', () => {
    const order = ['p2p', 'mega'] as const
    expect(rankMirrors([peer(0), ...mirrors], [...order]).at(-1)?.label).toBe('Peer-to-peer')
    expect(rankMirrors([peer(5, 1), ...mirrors], [...order]).at(-1)?.label).toBe('Peer-to-peer')
    expect(rankMirrors([peer(null), ...mirrors], [...order])[0].label).toBe('Peer-to-peer')
  })

  test('a link labelled P2P is not mistaken for the swarm', () => {
    expect(mirrorProvider(mirror('P2P', 'https://f95zone.to/masked/cancerads/1/2/x'))).toBeNull()
  })
})

describe('normalizeDownloadProviderOrder', () => {
  test('keeps saved order, drops junk, and appends new providers', () => {
    const order = normalizeDownloadProviderOrder(['mega', 'nope', 'nopy', 'mega', 42, 'gofile'])
    expect(order.slice(0, 2)).toEqual(['mega', 'gofile'])
    expect(order).toHaveLength(DEFAULT_DOWNLOAD_PROVIDER_ORDER.length)
    expect(order).not.toContain('nopy')
    expect(new Set(order).size).toBe(order.length)
  })

  test('defaults when nothing is saved', () => {
    expect(normalizeDownloadProviderOrder(undefined)).toEqual(DEFAULT_DOWNLOAD_PROVIDER_ORDER)
  })
})
