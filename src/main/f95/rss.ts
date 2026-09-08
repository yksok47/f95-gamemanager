import { load } from 'cheerio'
import type { CatalogGame } from '@shared/types'
import { fetchCatalog, mapGame } from './catalog'
import { F95Error, f95Fetch } from './http'
import { extractThreadId, parseGameTitle } from './parse'

export type RssGameUpdate = {
  threadId: number
  title: string
  version: string
  creator: string
  updatedAt: string
  timestamp: number
  threadUrl: string
}

function fromCatalogGame(game: CatalogGame): RssGameUpdate {
  return {
    threadId: game.threadId,
    title: game.title,
    version: game.version,
    creator: game.creator,
    updatedAt: game.updatedAt,
    timestamp: game.timestamp,
    threadUrl: game.threadUrl
  }
}

function parseTimestamp(value: string): number {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function itemToUpdate(link: string, title: string, date: string): RssGameUpdate | null {
  const threadId = extractThreadId(link) ?? extractThreadId(title)
  if (!threadId) return null
  const parsed = parseGameTitle(title)
  const timestamp = parseTimestamp(date)
  return {
    threadId,
    title: parsed.title || title,
    version: parsed.version,
    creator: parsed.creator,
    updatedAt: '',
    timestamp,
    threadUrl: `https://f95zone.to/threads/${threadId}/`
  }
}

function parseRssXml(body: string): RssGameUpdate[] {
  const $ = load(body, { xml: true })
  const items: RssGameUpdate[] = []
  const seen = new Set<number>()

  $('item').each((_, el) => {
    const node = $(el)
    const update = itemToUpdate(
      node.find('link').first().text().trim() || node.find('guid').first().text().trim(),
      node.find('title').first().text().trim(),
      node.find('pubDate, updated').first().text().trim()
    )
    if (!update || seen.has(update.threadId)) return
    seen.add(update.threadId)
    items.push(update)
  })

  $('entry').each((_, el) => {
    const node = $(el)
    const link =
      node.find('link[href]').first().attr('href') ||
      node.find('link').first().text().trim() ||
      node.find('id').first().text().trim()
    const update = itemToUpdate(
      link || '',
      node.find('title').first().text().trim(),
      node.find('updated, published').first().text().trim()
    )
    if (!update || seen.has(update.threadId)) return
    seen.add(update.threadId)
    items.push(update)
  })

  return items
}

function parseRssJson(body: string): RssGameUpdate[] {
  try {
    const parsed = JSON.parse(body) as {
      status?: string
      msg?: { data?: Parameters<typeof mapGame>[0][] }
    }
    if (parsed.status !== 'ok' || !Array.isArray(parsed.msg?.data)) return []
    return parsed.msg.data.map((entry) => fromCatalogGame(mapGame(entry)))
  } catch {
    return []
  }
}

export async function fetchLatestRss(): Promise<RssGameUpdate[]> {
  const { body } = await f95Fetch(
    `/sam/latest_alpha/latest_data.php?cmd=rss&cat=games&ignored=hide&_=${Date.now()}`,
    { headers: { Accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml,application/json,*/*' } }
  )

  const fromXml = parseRssXml(body)
  if (fromXml.length) return fromXml
  const fromJson = parseRssJson(body)
  if (fromJson.length) return fromJson

  try {
    const page = await fetchCatalog({ rows: 90, sort: 'date' })
    return page.games.map(fromCatalogGame)
  } catch (error) {
    if (error instanceof F95Error) throw error
    throw new F95Error('Could not read the F95zone latest-updates feed.', 'parse')
  }
}
