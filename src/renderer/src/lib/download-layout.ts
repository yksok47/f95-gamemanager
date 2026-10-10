import {
  CONTENT_KIND_LABELS,
  OS_KIND_IDS,
  OS_KIND_LABELS,
  type ContentKind,
  type DownloadEntry,
  type DownloadSection,
  type DownloadSectionKind,
  type OsKind
} from '@shared/types'

export type PlatformFilter = OsKind | 'all'

export type DownloadRowModel = {
  key: string
  entry: DownloadEntry
  /** Entry came from a split-archive section; it is an alternative to the full archive. */
  split: boolean
}

export type DownloadBlock = {
  key: string
  title: string | null
  rows: DownloadRowModel[]
}

export type DownloadLayout = {
  game: DownloadBlock[]
  addons: DownloadBlock[]
  older: DownloadBlock[]
  /** Entries the platform filter hides. */
  hidden: number
}

export type AddonCategory =
  | 'patches'
  | 'mods'
  | 'walkthroughs'
  | 'translations'
  | 'dlc'
  | 'saves'
  | 'other'

const ADDON_CATEGORY_ORDER: AddonCategory[] = [
  'patches',
  'mods',
  'walkthroughs',
  'translations',
  'dlc',
  'saves',
  'other'
]

const ADDON_CATEGORY_LABELS: Record<AddonCategory, string> = {
  patches: 'Patches',
  mods: 'Mods & cheats',
  walkthroughs: 'Walkthroughs',
  translations: 'Translations',
  dlc: 'DLC',
  saves: 'Saves',
  other: 'Other'
}

const ADDON_CATEGORY_BY_KIND: Record<ContentKind, AddonCategory> = {
  game: 'other',
  update: 'patches',
  patch: 'patches',
  uncensor: 'patches',
  crack: 'patches',
  mod: 'mods',
  cheat: 'mods',
  walkthrough: 'walkthroughs',
  translation: 'translations',
  dlc: 'dlc',
  save: 'saves',
  extra: 'other',
  other: 'other'
}

const SECTION_KIND_LABELS: Record<DownloadSectionKind, string> = {
  current: 'Current',
  split: 'Split',
  archive: 'Older versions',
  edition: 'Edition',
  patches: 'Patches',
  extras: 'Extras',
  other: 'Other'
}

/** OS tags that run anywhere and so never get filtered out. */
const PORTABLE_SYSTEMS: OsKind[] = ['web', 'html']

type Zone = 'game' | 'addons' | 'older'

function zoneFor(kind: DownloadSectionKind, parent: Zone | null): Zone {
  if (parent === 'older' || kind === 'archive') return 'older'
  if (kind === 'patches' || kind === 'extras') return 'addons'
  return parent ?? 'game'
}

function sectionTitle(section: DownloadSection): string | null {
  if (section.title?.trim()) return section.title.trim()
  if (section.kind === 'current') return null
  return SECTION_KIND_LABELS[section.kind]
}

function isMainContent(kind: ContentKind): boolean {
  return kind === 'game' || kind === 'update'
}

function addonCategory(entry: DownloadEntry, sectionKind: DownloadSectionKind): AddonCategory {
  if (entry.contentType === 'game' && sectionKind === 'patches') return 'patches'
  return ADDON_CATEGORY_BY_KIND[entry.contentType]
}

function hasMirrors(entry: DownloadEntry): boolean {
  return entry.mirrors.length > 0 || entry.parts.some((part) => part.mirrors.length > 0)
}

export function entryMatchesPlatform(entry: DownloadEntry, filter: PlatformFilter): boolean {
  if (filter === 'all' || !entry.systems.length) return true
  return entry.systems.includes(filter) || entry.systems.some((os) => PORTABLE_SYSTEMS.includes(os))
}

function walkEntries(
  sections: DownloadSection[],
  visit: (entry: DownloadEntry, section: DownloadSection, zone: Zone, title: string | null) => void,
  parent: { zone: Zone; title: string | null } | null = null
): void {
  for (const section of sections) {
    const zone = zoneFor(section.kind, parent?.zone ?? null)
    const title = sectionTitle(section) ?? parent?.title ?? null
    for (const entry of section.entries) {
      if (hasMirrors(entry)) visit(entry, section, zone, title)
    }
    walkEntries(section.sections, visit, { zone, title })
  }
}

/** Platforms the post offers builds for, the host first. */
export function availablePlatforms(sections: DownloadSection[], host: OsKind | null): OsKind[] {
  const found = new Set<OsKind>()
  walkEntries(sections, (entry) => {
    for (const os of entry.systems) if (!PORTABLE_SYSTEMS.includes(os)) found.add(os)
  })
  return [...found].sort((a, b) => {
    if (a === host) return -1
    if (b === host) return 1
    return OS_KIND_IDS[a] - OS_KIND_IDS[b]
  })
}

/** This computer's platform, unless that would hide every game build. */
export function defaultPlatformFilter(
  sections: DownloadSection[],
  host: OsKind | null
): PlatformFilter {
  if (!host || !availablePlatforms(sections, host).includes(host)) return 'all'
  if (buildDownloadLayout(sections, host).game.length) return host
  return buildDownloadLayout(sections, 'all').game.length ? 'all' : host
}

export function buildDownloadLayout(
  sections: DownloadSection[],
  filter: PlatformFilter
): DownloadLayout {
  const game: DownloadBlock[] = []
  const older: DownloadBlock[] = []
  const addons = new Map<AddonCategory, DownloadRowModel[]>()
  let hidden = 0
  let nextKey = 0

  function pushRow(blocks: DownloadBlock[], title: string | null, row: DownloadRowModel): void {
    const last = blocks.at(-1)
    if (last && last.title === title) last.rows.push(row)
    else blocks.push({ key: `${blocks.length}-${title ?? ''}`, title, rows: [row] })
  }

  walkEntries(sections, (entry, section, zone, title) => {
    if (!entryMatchesPlatform(entry, filter)) {
      hidden += 1
      return
    }
    const row: DownloadRowModel = {
      key: `row-${nextKey++}`,
      entry,
      split: section.kind === 'split' || entry.parts.length > 0
    }
    if (zone === 'older') {
      pushRow(older, title, row)
    } else if (zone === 'game' && isMainContent(entry.contentType)) {
      pushRow(game, title, row)
    } else {
      const category = addonCategory(entry, section.kind)
      const rows = addons.get(category)
      if (rows) rows.push(row)
      else addons.set(category, [row])
    }
  })

  return {
    game,
    addons: ADDON_CATEGORY_ORDER.flatMap((category) => {
      const rows = addons.get(category)
      return rows?.length
        ? [{ key: category, title: ADDON_CATEGORY_LABELS[category], rows }]
        : []
    }),
    older,
    hidden
  }
}

function prettyVariant(value: string): string {
  const key = value.trim().toLowerCase()
  if (!key) return ''
  if (/^(hq|lq|hd|sd|4k|1080p|720p)$/i.test(key)) return key.toUpperCase()
  return key.charAt(0).toUpperCase() + key.slice(1)
}

export function entryHeading(entry: DownloadEntry): string {
  const parts: string[] = []
  if (entry.title?.trim()) parts.push(entry.title.trim())
  else if (!isMainContent(entry.contentType)) parts.push(CONTENT_KIND_LABELS[entry.contentType])
  if (entry.systems.length) parts.push(entry.systems.map((os) => OS_KIND_LABELS[os]).join(' / '))
  if (!parts.length) parts.push(CONTENT_KIND_LABELS[entry.contentType])
  return parts.join(' · ')
}

/** Small tags shown after the heading. */
export function entryTags(entry: DownloadEntry, split: boolean): string[] {
  const tags = entry.variants.map(prettyVariant).filter(Boolean)
  if (entry.version?.trim()) tags.push(entry.version.trim())
  if (entry.contentType === 'update') tags.push('Update')
  else if (entry.title?.trim() && !isMainContent(entry.contentType)) {
    tags.push(CONTENT_KIND_LABELS[entry.contentType])
  }
  if (split && entry.parts.length) tags.push(`${entry.parts.length} parts`)
  else if (split) tags.push('Split')
  if (entry.unofficial) tags.push('Unofficial')
  return tags
}

export function countDownloadMirrors(sections: DownloadSection[]): number {
  let total = 0
  for (const section of sections) {
    total += countDownloadMirrors(section.sections)
    for (const entry of section.entries) {
      total += entry.mirrors.length
      for (const part of entry.parts) total += part.mirrors.length
    }
  }
  return total
}
