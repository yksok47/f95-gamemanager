import { load } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { Cheerio } from 'cheerio'
import type { ImportResult, Subscription, SubscriptionSource } from '@shared/types'
import { addSubscriptions, enrichIncompleteSubscriptions } from '../subscriptions-store'
import { f95Fetch } from './http'
import { parseGameTitle, PREFIX_NODE_SELECTOR, extractThreadId, sleep, threadUrl } from './parse'
import { engineFromTitle } from '@shared/engines'

const PAGE_DELAY_MS = 1200
const MAX_PAGES = 80

type ScrapedThread = {
  threadId: number
  title: string
}

function uniqueThreads(threads: ScrapedThread[]): ScrapedThread[] {
  const seen = new Set<number>()
  const out: ScrapedThread[] = []
  for (const thread of threads) {
    if (seen.has(thread.threadId)) continue
    seen.add(thread.threadId)
    out.push(thread)
  }
  return out
}

function titleFrom(node: Cheerio<AnyNode>): string {
  const clone = node.clone()
  clone.find(PREFIX_NODE_SELECTOR).remove()
  return clone.text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function scrapeBookmarks(html: string): ScrapedThread[] {
  const $ = load(html)
  const threads: ScrapedThread[] = []
  $('.p-body-pageContent .listPlain .contentRow-title a').each((_, el) => {
    const node = $(el)
    const threadId = extractThreadId(node.attr('href'))
    const title = titleFrom(node)
    if (threadId && title) threads.push({ threadId, title })
  })
  return threads
}

function scrapeWatched(html: string): ScrapedThread[] {
  const $ = load(html)
  const threads: ScrapedThread[] = []
  $('.p-body-pageContent .structItem-title').each((_, el) => {
    const node = $(el)
    const link = node
      .find('a[href*="/threads/"]')
      .filter((_, el) => Boolean(extractThreadId($(el).attr('href'))))
      .last()
    const href = node.attr('uix-data-href') || link.attr('href')
    const title = titleFrom(link.length ? link : node)
    const threadId = extractThreadId(href)
    if (threadId && title) threads.push({ threadId, title })
  })
  return threads
}

async function paginate(
  buildUrl: (page: number) => string,
  scrape: (html: string) => ScrapedThread[],
  startPage: number
): Promise<ScrapedThread[]> {
  const all: ScrapedThread[] = []
  for (let page = startPage; page < startPage + MAX_PAGES; page += 1) {
    const { body } = await f95Fetch(buildUrl(page))
    const threads = scrape(body)
    if (!threads.length) break
    all.push(...threads)
    await sleep(PAGE_DELAY_MS)
  }
  return uniqueThreads(all)
}

function toSubscriptions(
  threads: ScrapedThread[],
  source: Exclude<SubscriptionSource, 'manual'>
): Subscription[] {
  const now = Date.now()
  return threads.map((thread) => {
    const parsed = parseGameTitle(thread.title)
    return {
      threadId: thread.threadId,
      title: parsed.title || thread.title,
      creator: parsed.creator,
      version: parsed.version,
      coverUrl: null,
      rating: 0,
      likes: 0,
      views: 0,
      updatedAt: '',
      timestamp: 0,
      threadUrl: threadUrl(thread.threadId),
      source,
      addedAt: now,
      rarity: 'regular' as const,
      tags: [],
      prefixes: [],
      screens: [],
      engine: engineFromTitle(thread.title),
      lastPlayedVersion: '',
      lastPlayedAt: 0,
      playtimeMs: 0,
      playedVersions: [],
      checkedAt: 0
    }
  })
}

async function importThreads(
  source: Exclude<SubscriptionSource, 'manual'>,
  threads: ScrapedThread[]
): Promise<ImportResult> {
  const { added, alreadyFollowed } = await addSubscriptions(toSubscriptions(threads, source))
  await enrichIncompleteSubscriptions()
  return { source, found: threads.length, added, alreadyFollowed }
}

export async function importWatchedThreads(): Promise<ImportResult> {
  const threads = await paginate(
    (page) => `/watched/threads?unread=0&page=${page}`,
    scrapeWatched,
    1
  )
  return importThreads('watched', threads)
}

export async function importBookmarks(): Promise<ImportResult> {
  let threads = await paginate(
    (page) => `/account/bookmarks?difference=0&page=${page}`,
    scrapeBookmarks,
    1
  )
  if (!threads.length) {
    threads = await paginate(
      (page) => `/account/bookmarks?difference=0&page=${page}`,
      scrapeBookmarks,
      0
    )
  }
  return importThreads('bookmark', threads)
}
