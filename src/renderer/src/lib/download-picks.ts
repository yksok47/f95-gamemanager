import type { DownloadEntry, DownloadMirror, DownloadSection } from '@shared/types'
import {
  downloadProviderLabel,
  mirrorIsOneClick,
  mirrorTarget,
  rankMirrors,
  type DownloadProviderId
} from '@shared/download-providers'
import { buildDownloadLayout, entryHeading, type PlatformFilter } from './download-layout'

export type DownloadPick = {
  key: string
  entry: DownloadEntry
  mirror: DownloadMirror
  heading: string
  source: string
  oneClick: boolean
}

function hostLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const masked = parsed.pathname.match(/^\/masked\/([^/]+)/i)
    if (masked?.[1]) return masked[1]
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return 'Link'
  }
}

/** Link text as posted, falling back to the host when it is a bare URL. */
export function linkText(link: DownloadMirror): string {
  const label = link.label.trim().replace(/[*\s]+$/, '')
  if (!label || /^https?:\/\//i.test(label)) return hostLabel(link.url)
  return label
}

export function mirrorSource(mirror: DownloadMirror): string {
  const target = mirrorTarget(mirror)
  if (target.kind === 'provider') return downloadProviderLabel(target.provider)
  if (target.kind === 'file') return 'Direct file'
  if (target.kind === 'forum') return 'F95zone'
  return target.host.includes('.') ? target.host : linkText(mirror)
}

export function mirrorAction(mirror: DownloadMirror): string {
  const kind = mirrorTarget(mirror).kind
  if (kind === 'forum') return 'Open post'
  if (kind === 'web') return 'Open'
  return 'Download'
}

export function mirrorTitle(mirror: DownloadMirror): string {
  return `${linkText(mirror)} · ${hostLabel(mirror.url)}`
}

function picksForMirrors(
  entry: DownloadEntry,
  mirrors: DownloadMirror[],
  order: readonly DownloadProviderId[],
  heading: string,
  keyPrefix: string
): DownloadPick[] {
  return rankMirrors(mirrors, order).map((mirror, index) => ({
    key: `${keyPrefix}-${index}-${mirror.url}`,
    entry,
    mirror,
    heading,
    source: mirrorSource(mirror),
    oneClick: mirrorIsOneClick(mirror)
  }))
}

function picksForEntry(
  entry: DownloadEntry,
  order: readonly DownloadProviderId[],
  keyPrefix: string
): DownloadPick[] {
  const heading = entryHeading(entry)
  if (entry.mirrors.length) {
    return picksForMirrors(entry, entry.mirrors, order, heading, keyPrefix)
  }
  return entry.parts.flatMap((part, partIndex) => {
    const partHeading = part.label || `Part ${part.index}`
    return picksForMirrors(
      entry,
      part.mirrors,
      order,
      heading === partHeading ? partHeading : `${heading} · ${partHeading}`,
      `${keyPrefix}-p${partIndex}`
    )
  })
}

/**
 * Mirrors the header Download / Update split button can fire: every host of the
 * best current build, then the top host of each other current build.
 */
export function listHeaderDownloadPicks(
  sections: DownloadSection[],
  filter: PlatformFilter,
  order: readonly DownloadProviderId[]
): DownloadPick[] {
  const rows = buildDownloadLayout(sections, filter).game.flatMap((block) => block.rows)
  const primaryRow = rows.find((row) => row.entry.mirrors.length) ?? rows[0]
  if (!primaryRow) return []
  const primary = picksForEntry(primaryRow.entry, order, primaryRow.key)
  const extras = rows
    .filter((row) => row !== primaryRow)
    .flatMap((row) => {
      const picks = picksForEntry(row.entry, order, row.key)
      const best = picks[0]
      if (!best) return []
      return [
        {
          ...best,
          heading: `${best.heading} · ${best.source}`,
          key: `alt-${best.key}`
        }
      ]
    })
  return [...primary, ...extras]
}
