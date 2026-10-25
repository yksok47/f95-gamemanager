import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { ThreadVersionHistory, ThreadVersionRelease } from '@shared/types'

const DAYS_PER_UNIT: Record<string, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365
}

export function parseVersionHistory(html: string): ThreadVersionHistory {
  return parseVersionHistoryDocument(load(html))
}

export function parseVersionHistoryDocument($: CheerioAPI): ThreadVersionHistory {
  const strip = $('.f95wg-thread .f95wg-strip, .f95wg-strip').first()
  if (!strip.length) return { versions: [], cadenceDays: null }

  const versions: ThreadVersionRelease[] = []
  strip.find('.f95wg-strip-version').each((_, el) => {
    const node = $(el)
    const label = node.clone()
    label.find('.f95wg-muted').remove()
    const version = normalize(label.text())
    if (!version) return
    versions.push({
      version,
      previousVersion: previousVersion(node.attr('title') || node.attr('data-original-title') || ''),
      releasedAt: releasedAt(node.find('time').first())
    })
  })

  return {
    versions,
    cadenceDays: cadenceDays(normalize(strip.find('.f95wg-strip-gap').first().text()))
  }
}

function normalize(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function previousVersion(title: string): string {
  const match = normalize(title).match(/^from\s+(.+)$/i)
  return match ? match[1].trim() : ''
}

function releasedAt(time: Cheerio<AnyNode>): number {
  if (!time.length) return 0
  const stamp = Number(time.attr('data-timestamp'))
  if (Number.isFinite(stamp) && stamp > 0) return stamp * 1000
  const parsed = Date.parse(time.attr('datetime') || '')
  return Number.isFinite(parsed) ? parsed : 0
}

export function cadenceDays(text: string): number | null {
  const match = text.match(/every\s+(\d+(?:[.,]\d+)?\s+)?(day|week|month|year)s?\b/i)
  if (!match) return null
  const count = match[1] ? Number(match[1].trim().replace(',', '.')) : 1
  const days = count * DAYS_PER_UNIT[match[2].toLowerCase()]
  return Number.isFinite(days) && days > 0 ? days : null
}
