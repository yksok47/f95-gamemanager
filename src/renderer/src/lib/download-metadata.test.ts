import { describe, expect, test } from 'bun:test'
import type { PackageMetadata, ThreadDownloadMetadata } from '@shared/p2p'
import type { DownloadEntry, DownloadSection } from '@shared/types'
import { DEFAULT_DOWNLOAD_PROVIDER_ORDER, rankMirrors } from '@shared/download-providers'
import { applyDownloadMetadata, PEER_SHARED_TITLE } from './download-metadata'
import { buildDownloadLayout } from './download-layout'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)

function entry(overrides: Partial<DownloadEntry> = {}): DownloadEntry {
  return {
    contentType: 'game',
    systems: [],
    variants: [],
    version: null,
    title: null,
    unofficial: false,
    mirrors: [
      { label: 'MEGA', url: 'https://f95zone.to/masked/mega.nz/1/2/abc' },
      { label: 'PIXELDRAIN', url: 'https://pixeldrain.com/u/xyz' }
    ],
    parts: [],
    ...overrides
  }
}

function section(entries: DownloadEntry[], kind: DownloadSection['kind'] = 'current'): DownloadSection {
  return { title: null, kind, sections: [], entries }
}

function pkg(contentHash: string, overrides: Partial<PackageMetadata> = {}): PackageMetadata {
  return {
    contentHash,
    infoHash: contentHash.slice(0, 40),
    normalizedName: `${contentHash[0]}-game.zip`,
    gameName: 'Game',
    f95ThreadId: 1,
    f95ThreadUrl: null,
    uniqueSeederPubkeyCount: 1,
    seeders: 2,
    installCount: 4,
    flagCounts: { broken: 0, harmful: 0 },
    flags: [],
    sizeBytes: 1024,
    ...overrides
  }
}

const options = { p2pEnabled: true, currentVersion: '1.0' }

describe('applyDownloadMetadata', () => {
  test('stores metadata once for every mirror of the same file', () => {
    // Only the Pixeldrain mirror was ever reported; the MEGA mirror gets the same file.
    const meta: ThreadDownloadMetadata = {
      links: [{ url: 'https://pixeldrain.com/u/xyz', files: [{ contentHash: HASH_A, reports: 3 }] }],
      packages: [pkg(HASH_A, { consensus: { os: [0, 1], contentKind: 1, version: '1.0', versionId: 1 } })]
    }
    const [result] = applyDownloadMetadata([section([entry()])], meta, options)
    const enriched = result.entries[0]
    expect(enriched.systems).toEqual(['win', 'linux'])
    expect(enriched.version).toBe('1.0')
    expect(enriched.known?.map((file) => file.contentHash)).toEqual([HASH_A])
    expect(enriched.known?.[0].reports).toBe(3)
    expect(enriched.mirrors.at(-1)?.p2p?.contentHash).toBe(HASH_A)
    expect(enriched.mirrors.at(-1)?.url).toBe(`p2p:${HASH_A}`)
  })

  test('matches links regardless of trailing slash or host case', () => {
    const meta: ThreadDownloadMetadata = {
      links: [{ url: 'https://pixeldrain.com/u/xyz', files: [{ contentHash: HASH_A, reports: 1 }] }],
      packages: [pkg(HASH_A)]
    }
    const posted = entry({ mirrors: [{ label: 'PIXELDRAIN', url: 'https://PixelDrain.com/u/xyz/' }] })
    const [result] = applyDownloadMetadata([section([posted])], meta, options)
    expect(result.entries[0].known).toHaveLength(1)
  })

  test('a link with several files lists them all and unions their platforms', () => {
    const meta: ThreadDownloadMetadata = {
      links: [
        {
          url: 'https://pixeldrain.com/u/xyz',
          files: [
            { contentHash: HASH_A, reports: 1 },
            { contentHash: HASH_B, reports: 5 }
          ]
        }
      ],
      packages: [
        pkg(HASH_A, { consensus: { os: [0], contentKind: 1, version: '1.0', versionId: 1 } }),
        pkg(HASH_B, { consensus: { os: [2], contentKind: 1, version: '1.0', versionId: 1 } })
      ]
    }
    const [result] = applyDownloadMetadata([section([entry({ systems: ['win'] })])], meta, options)
    const enriched = result.entries[0]
    expect(enriched.known?.map((file) => file.contentHash)).toEqual([HASH_B, HASH_A])
    expect(enriched.systems).toEqual(['win', 'mac'])
    const peers = enriched.mirrors.filter((mirror) => mirror.p2p)
    expect(peers).toHaveLength(2)
    expect(peers[0].label).toBe('Peer-to-peer · b-game.zip')
  })

  test('a unanimous vote recategorizes the entry; split votes keep the post', () => {
    const modMeta: ThreadDownloadMetadata = {
      links: [{ url: 'https://pixeldrain.com/u/xyz', files: [{ contentHash: HASH_A, reports: 1 }] }],
      packages: [pkg(HASH_A, { consensus: { os: [], contentKind: 5, version: '', versionId: 0 } })]
    }
    const [asMod] = applyDownloadMetadata([section([entry({ version: '0.9' })])], modMeta, options)
    expect(asMod.entries[0].contentType).toBe('mod')
    expect(asMod.entries[0].version).toBe('0.9')
    expect(buildDownloadLayout([asMod], 'all').addons[0]?.title).toBe('Mods & cheats')

    const split: ThreadDownloadMetadata = {
      links: [
        {
          url: 'https://pixeldrain.com/u/xyz',
          files: [
            { contentHash: HASH_A, reports: 1 },
            { contentHash: HASH_B, reports: 1 }
          ]
        }
      ],
      packages: [
        pkg(HASH_A, { consensus: { os: [], contentKind: 5, version: '', versionId: 0 } }),
        pkg(HASH_B, { consensus: { os: [0], contentKind: 1, version: '1.0', versionId: 1 } })
      ]
    }
    const [kept] = applyDownloadMetadata([section([entry()])], split, options)
    expect(kept.entries[0].contentType).toBe('game')
  })

  test('each part of a split archive gets the peer copy of its own file', () => {
    const meta: ThreadDownloadMetadata = {
      links: [
        { url: 'https://pixeldrain.com/u/p1', files: [{ contentHash: HASH_A, reports: 1 }] },
        { url: 'https://pixeldrain.com/u/p2', files: [{ contentHash: HASH_B, reports: 1 }] }
      ],
      packages: [pkg(HASH_A), pkg(HASH_B)]
    }
    const posted = entry({
      mirrors: [],
      parts: [
        { index: 1, total: 2, label: 'Part 1', mirrors: [{ label: 'PD', url: 'https://pixeldrain.com/u/p1' }] },
        { index: 2, total: 2, label: 'Part 2', mirrors: [{ label: 'PD', url: 'https://pixeldrain.com/u/p2' }] }
      ]
    })
    const [result] = applyDownloadMetadata([section([posted])], meta, options)
    const parts = result.entries[0].parts
    expect(parts[0].mirrors.at(-1)?.p2p?.contentHash).toBe(HASH_A)
    expect(parts[1].mirrors.at(-1)?.p2p?.contentHash).toBe(HASH_B)
    expect(result.entries[0].known).toHaveLength(2)
  })

  test('without P2P only categorizes; no peer mirrors or swarm-only entries', () => {
    const meta: ThreadDownloadMetadata = {
      links: [{ url: 'https://pixeldrain.com/u/xyz', files: [{ contentHash: HASH_A, reports: 1 }] }],
      packages: [
        pkg(HASH_A, { consensus: { os: [0], contentKind: 1, version: '1.0', versionId: 1 } }),
        pkg(HASH_B)
      ]
    }
    const result = applyDownloadMetadata([section([entry()])], meta, { ...options, p2pEnabled: false })
    expect(result).toHaveLength(1)
    expect(result[0].entries[0].systems).toEqual(['win'])
    expect(result[0].entries[0].mirrors.some((mirror) => mirror.p2p)).toBe(false)
  })

  test('files not behind any posted link become peer-shared entries by version and kind', () => {
    const meta: ThreadDownloadMetadata = {
      links: [],
      packages: [
        pkg(HASH_A, { consensus: { os: [0], contentKind: 1, version: '1.0', versionId: 1 } }),
        pkg(HASH_B, { consensus: { os: [0], contentKind: 1, version: '0.5', versionId: 2 } }),
        pkg(HASH_C, { consensus: { os: [], contentKind: 10, version: '', versionId: 0 } })
      ]
    }
    const result = applyDownloadMetadata([section([entry()])], meta, options)
    const peer = result.slice(1)
    expect(peer.map((item) => [item.kind, item.title])).toEqual([
      ['current', PEER_SHARED_TITLE],
      ['archive', PEER_SHARED_TITLE],
      ['extras', PEER_SHARED_TITLE]
    ])
    expect(peer[0].entries[0]).toMatchObject({ peerShared: true, title: 'a-game.zip', systems: ['win'] })
    const layout = buildDownloadLayout(result, 'all')
    expect(layout.game.map((block) => block.title)).toEqual([null, PEER_SHARED_TITLE])
    expect(layout.older[0].rows[0].entry.version).toBe('0.5')
    expect(layout.addons[0].title).toBe('Saves')
  })

  test('skips swarm-only files that are untrusted or not shareable', () => {
    const meta: ThreadDownloadMetadata = {
      links: [],
      packages: [
        pkg(HASH_A, { installCount: 1, flagCounts: { broken: 0, harmful: 3 } }),
        pkg(HASH_B, { infoHash: null })
      ]
    }
    expect(applyDownloadMetadata([section([entry()])], meta, options)).toHaveLength(1)
  })

  test('peer mirror honors provider order unless nobody seeds it', () => {
    const meta = (seeders: number): ThreadDownloadMetadata => ({
      links: [{ url: 'https://pixeldrain.com/u/xyz', files: [{ contentHash: HASH_A, reports: 1 }] }],
      packages: [pkg(HASH_A, { seeders, activeSeeders: seeders })]
    })
    const order = ['p2p', ...DEFAULT_DOWNLOAD_PROVIDER_ORDER.filter((id) => id !== 'p2p')] as const
    const seeded = applyDownloadMetadata([section([entry()])], meta(3), options)[0].entries[0]
    expect(rankMirrors(seeded.mirrors, [...order])[0].p2p).toBeDefined()
    const unseeded = applyDownloadMetadata([section([entry()])], meta(0), options)[0].entries[0]
    expect(rankMirrors(unseeded.mirrors, [...order]).at(-1)?.p2p).toBeDefined()
  })

  test('returns the post untouched without metadata', () => {
    const sections = [section([entry()])]
    expect(applyDownloadMetadata(sections, null, options)).toBe(sections)
  })
})
