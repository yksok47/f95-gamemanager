import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { DownloadSection } from '@shared/types'
import { DEFAULT_DOWNLOAD_PROVIDER_ORDER } from '@shared/download-providers'
import { listHeaderDownloadPicks } from './download-picks'

const sample: DownloadSection[] = JSON.parse(
  readFileSync(
    join(import.meta.dir, '../../../main/f95/parser/samples/downloads/22/output.json'),
    'utf8'
  )
)

describe('listHeaderDownloadPicks', () => {
  test('uses the current game build and ranks hosts by provider order', () => {
    const picks = listHeaderDownloadPicks(sample, 'win', DEFAULT_DOWNLOAD_PROVIDER_ORDER)
    expect(picks.length).toBeGreaterThan(1)
    expect(picks.some((pick) => pick.source === 'VikingFile')).toBe(true)
    const viking = picks.find((pick) => pick.source === 'VikingFile')
    expect(viking?.mirror.host).toBe('vikingfile.com')
    expect(viking?.mirror.url).toContain('f95zone.to/dl/')
    expect(viking?.oneClick).toBe(false)
  })

  test('puts the highest-ranked host first', () => {
    const vikingFirst = listHeaderDownloadPicks(sample, 'win', [
      'vikingfile',
      ...DEFAULT_DOWNLOAD_PROVIDER_ORDER.filter((id) => id !== 'vikingfile')
    ])
    expect(vikingFirst[0]?.source).toBe('VikingFile')
    expect(vikingFirst[0]?.oneClick).toBe(false)
  })
})
