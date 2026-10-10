import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { DownloadEntry, DownloadSection } from '@shared/types'
import {
  availablePlatforms,
  buildDownloadLayout,
  defaultPlatformFilter,
  entryHeading
} from './download-layout'

function entry(partial: Partial<DownloadEntry>): DownloadEntry {
  return {
    contentType: 'game',
    systems: [],
    variants: [],
    version: null,
    title: null,
    unofficial: false,
    mirrors: [{ label: 'MEGA', url: 'https://mega.nz/file/x' }],
    parts: [],
    ...partial
  }
}

function section(partial: Partial<DownloadSection>): DownloadSection {
  return { title: null, kind: 'current', sections: [], entries: [], ...partial }
}

const sample: DownloadSection[] = JSON.parse(
  readFileSync(
    join(import.meta.dir, '../../../main/f95/parser/samples/downloads/14/output.json'),
    'utf8'
  )
)

describe('buildDownloadLayout', () => {
  test('shows only this computer’s builds and counts the rest as hidden', () => {
    const layout = buildDownloadLayout(sample, 'win')
    const gameRows = layout.game.flatMap((block) => block.rows)
    expect(gameRows.every((row) => row.entry.systems.includes('win'))).toBe(true)
    expect(gameRows.some((row) => row.split)).toBe(true)
    expect(layout.hidden).toBeGreaterThan(0)
    expect(buildDownloadLayout(sample, 'all').hidden).toBe(0)
  })

  test('groups extras by kind instead of post order', () => {
    const titles = buildDownloadLayout(sample, 'win').addons.map((block) => block.title)
    expect(titles).toEqual(['Mods & cheats', 'Walkthroughs', 'Translations', 'Other'])
  })

  test('patches inside the main block move to add-ons; archives become older versions', () => {
    const layout = buildDownloadLayout(
      [
        section({
          entries: [
            entry({ systems: ['win'] }),
            entry({ contentType: 'uncensor', title: 'Incest' })
          ]
        }),
        section({ kind: 'archive', title: 'OLD S2 VERSION', entries: [entry({ systems: ['win'] })] })
      ],
      'win'
    )
    expect(layout.game.flatMap((block) => block.rows)).toHaveLength(1)
    expect(layout.addons.map((block) => block.title)).toEqual(['Patches'])
    expect(layout.older.map((block) => block.title)).toEqual(['OLD S2 VERSION'])
  })

  test('skips entries without links', () => {
    const layout = buildDownloadLayout([section({ entries: [entry({ mirrors: [] })] })], 'all')
    expect(layout.game).toHaveLength(0)
  })
})

describe('platform defaults', () => {
  test('lists the host first and defaults to it', () => {
    expect(availablePlatforms(sample, 'mac')[0]).toBe('mac')
    expect(defaultPlatformFilter(sample, 'win')).toBe('win')
  })

  test('shows everything when this computer has no game build', () => {
    const sections = [
      section({
        entries: [
          entry({ systems: ['mac'] }),
          entry({ contentType: 'patch', systems: ['win'], title: 'Fix' })
        ]
      })
    ]
    expect(defaultPlatformFilter(sections, 'win')).toBe('all')
    expect(defaultPlatformFilter(sections, null)).toBe('all')
  })
})

describe('entryHeading', () => {
  test('leads with the title, then platforms', () => {
    expect(entryHeading(entry({ systems: ['win', 'linux'] }))).toBe('Windows / Linux')
    expect(entryHeading(entry({ contentType: 'walkthrough', title: 'Mini Guide' }))).toBe('Mini Guide')
    expect(entryHeading(entry({ contentType: 'cheat' }))).toBe('Cheat')
  })
})
