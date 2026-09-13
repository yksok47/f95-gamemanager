import { load, type CheerioAPI } from 'cheerio'
import type { ThreadDetails, ThreadField, ThreadReviewsPage } from '@shared/types'
import { F95Error, f95Fetch, f95Url } from './http'
import { engineFromTitle, normalizeEngine } from '@shared/engines'
import { parseGameTitle } from './parse'
import { isWeakCover } from './lookup'
import { composeFirstPost, emptyFirstPost } from './parser/composeFirstPost'
import { parseFirstPostDocument } from './parser/firstPost/firstPostParser'
import {
  documentHasReviewNodes,
  reviewsPageFromDocument
} from './parser/reviews/reviewsParser'
import { parseThreadPageDocument } from './parser/threadPage/threadPageParser'

const HOST = 'https://f95zone.to'
const CACHE_VERSION = 27
const DETAILS_TTL_MS = 10 * 60 * 1000

const detailsCache = new Map<string, { at: number; value: ThreadDetails }>()
const reviewsCache = new Map<string, { at: number; value: ThreadReviewsPage }>()
/** Coalesce concurrent details loads for the same thread (one HTTP in flight). */
const detailsInflight = new Map<number, Promise<ThreadDetails>>()
const reviewsInflight = new Map<string, Promise<ThreadReviewsPage>>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load thread details for the details modal.
 * One HTTP GET of the thread page; page chrome, first post, and page-1 reviews
 * are all parsed from that document. Dedicated `/br-reviews` is only fetched
 * when paginating via `fetchThreadReviews`.
 */
export async function fetchThreadDetails(threadId: number): Promise<ThreadDetails> {
  const cacheKey = `${CACHE_VERSION}:${threadId}`
  const cached = detailsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < DETAILS_TTL_MS) return cached.value

  const inflight = detailsInflight.get(threadId)
  if (inflight) return inflight

  const promise = loadThreadDetails(threadId)
    .then((value) => {
      detailsCache.set(cacheKey, { at: Date.now(), value })
      seedReviewsCache(value)
      return value
    })
    .finally(() => {
      detailsInflight.delete(threadId)
    })

  detailsInflight.set(threadId, promise)
  return promise
}

/**
 * Dedicated reviews listing (pagination). Page 1 is usually already seeded by
 * `fetchThreadDetails`; only misses or later pages hit the network.
 */
export async function fetchThreadReviews(
  threadId: number,
  page = 1,
  options: { canonical?: string } = {}
): Promise<ThreadReviewsPage> {
  const safePage = Math.max(1, Math.floor(page) || 1)
  const cacheKey = reviewsCacheKey(threadId, safePage)
  const cached = reviewsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < DETAILS_TTL_MS) return cached.value

  const inflight = reviewsInflight.get(cacheKey)
  if (inflight) return inflight

  const promise = loadReviewsPage(threadId, safePage, options.canonical)
    .then((value) => {
      reviewsCache.set(cacheKey, { at: Date.now(), value })
      return value
    })
    .finally(() => {
      reviewsInflight.delete(cacheKey)
    })

  reviewsInflight.set(cacheKey, promise)
  return promise
}

// ---------------------------------------------------------------------------
// Details pipeline (single document)
// ---------------------------------------------------------------------------

async function loadThreadDetails(threadId: number): Promise<ThreadDetails> {
  const $ = await fetchThreadDocument(threadId)

  const page = parseThreadPageDocument($)
  const titleParts = parseGameTitle(page.title)
  const canonical = page.canonicalUrl || page.ogUrl || f95Url(`/threads/${threadId}/`)

  const firstPostHtml = parseFirstPostDocument($)
  const post = firstPostHtml ? composeFirstPost(firstPostHtml, threadId) : emptyFirstPost()

  const cover = resolveCover(post.banner, page.ogImage)
  // Reviews from the thread document only — no /br-reviews fetch on modal open.
  // Multi-page listings are loaded later via fetchThreadReviews when needed.
  const reviews = reviewsPageFromDocument($, threadId, false, 1)
  const reviewsTotal = reviews.total || reviews.reviews.length

  return {
    threadId,
    threadUrl: canonical,
    title: titleParts.title || page.title || `Thread ${threadId}`,
    creator: resolveCreator(post.fields, titleParts.creator, page.starter),
    version: fieldValue(post.fields, ['version', 'release version']) || titleParts.version,
    coverUrl: cover,
    tags: page.tags,
    fields: post.fields,
    creatorLinks: post.creatorLinks,
    relatedGames: post.relatedGames,
    releaseDate: post.releaseDate,
    updatedAt: post.updatedAt,
    descriptionHtml: post.descriptionHtml,
    notes: post.notes,
    changelog: post.changelog,
    gallery: post.gallery.filter(
      (url) => url !== cover && !isThumbnailUrl(url) && !isBannerUrl(url)
    ),
    downloads: post.downloads,
    reviews: reviews.reviews,
    reviewsTotal,
    // Keep pager off until a dedicated reviews page is fetched (page alignment).
    reviewsTotalPages: 1,
    engine: normalizeEngine(
      engineFromFields(post.fields) ||
        engineFromTitle(page.prefixes.join(' ')) ||
        engineFromTitle(page.title) ||
        engineFromTitle(page.ogTitle)
    ),
    likes: page.likes,
    views: page.views
  }
}

/** Fetch the thread HTML once; only follow to page 1 when the OP is missing. */
async function fetchThreadDocument(threadId: number): Promise<CheerioAPI> {
  const { body } = await f95Fetch(`/threads/${threadId}/`, {}, { timeoutMs: 45000 })
  const $ = load(body)
  if ($('.message-threadStarterPost').length) return $

  const firstPage = firstPageHref($)
  if (!firstPage) return $
  try {
    const next = await f95Fetch(firstPage, {}, { timeoutMs: 45000 })
    const parsed = load(next.body)
    if (parsed('.message-threadStarterPost, .message--post').length) return parsed
  } catch {
    // Keep the first response if the page-1 retry fails.
  }
  return $
}

// ---------------------------------------------------------------------------
// Reviews pagination (separate endpoint, on demand)
// ---------------------------------------------------------------------------

async function loadReviewsPage(
  threadId: number,
  page: number,
  canonical?: string
): Promise<ThreadReviewsPage> {
  for (const path of reviewListPaths(threadId, page, canonical)) {
    try {
      const { body, response } = await f95Fetch(path, {}, { timeoutMs: 25000 })
      if (response.status >= 400) continue
      const $ = load(body)
      const onReviewsPage = /br-reviews|\/reviews/i.test(response.url)
      if (!onReviewsPage && !documentHasReviewNodes($)) continue

      const value = reviewsPageFromDocument($, threadId, true, page)
      if (!value.reviews.length && page === 1) continue
      return value
    } catch {
      // Try the next reviews URL variant.
    }
  }

  if (page <= 1) {
    return { threadId, page: 1, totalPages: 1, total: 0, reviews: [] }
  }
  throw new F95Error('Could not load that reviews page.', 'network')
}

function seedReviewsCache(details: ThreadDetails): void {
  // Only seed when the thread page already has the full listing; otherwise
  // fetchThreadReviews(1) must hit /br-reviews so pagination stays aligned.
  if (details.reviewsTotal > details.reviews.length) return
  const value: ThreadReviewsPage = {
    threadId: details.threadId,
    page: 1,
    totalPages: 1,
    total: details.reviewsTotal,
    reviews: details.reviews
  }
  reviewsCache.set(reviewsCacheKey(details.threadId, 1), { at: Date.now(), value })
}

function reviewsCacheKey(threadId: number, page: number): string {
  return `${CACHE_VERSION}:reviews:${threadId}:${page}`
}

function reviewListPaths(threadId: number, page: number, canonical?: string): string[] {
  const extra = page > 1 ? `/page-${page}` : ''
  const bases = [`${HOST}/threads/${threadId}`]
  if (canonical) {
    bases.unshift(
      canonical.replace(/\/$/, '').replace(/\/(br-reviews|reviews)(?:\/page-\d+)?$/i, '')
    )
  }
  return unique(bases.flatMap((base) => [`${base}/br-reviews${extra}`, `${base}/reviews${extra}`]))
}

// ---------------------------------------------------------------------------
// Field / cover assembly
// ---------------------------------------------------------------------------

function resolveCreator(fields: ThreadField[], titleCreator: string, starter: string): string {
  const fromFields = fieldValue(fields, [
    'developer',
    'developers',
    'creator',
    'author',
    'developer/publisher'
  ])
  // Overview already strips link noise from developer fields.
  if (fromFields) return fromFields
  return stripCreatorExtras(titleCreator || starter)
}

function resolveCover(banner: string, ogImage: string): string | null {
  if (banner) return banner
  if (!ogImage || isWeakCover(ogImage) || isThumbnailUrl(ogImage)) return null
  return upgradeImageUrl(ogImage)
}

function fieldValue(fields: ThreadField[], names: string[]): string {
  for (const field of fields) {
    if (names.some((name) => field.label.toLowerCase() === name)) return field.value
  }
  return ''
}

function engineFromFields(fields: ThreadField[]): string {
  for (const field of fields) {
    if (/engine/i.test(field.label)) return field.value
  }
  return ''
}

function stripCreatorExtras(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, '')
    .replace(
      /\b(patreon|subscribestar|subscribe star|itch\.io|itchio|discord|ko-fi|kofi|boosty|gumroad|twitter|fanbox|linktree|carrd)\b/gi,
      ''
    )
    .replace(/[\s]*[|/\-–—·•]+[\s]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ---------------------------------------------------------------------------
// Small URL / DOM helpers
// ---------------------------------------------------------------------------

function firstPageHref($: CheerioAPI): string | null {
  const href = $('nav.pageNav a, .pageNav-main a, .pageNav-jump')
    .toArray()
    .map((el) => $(el))
    .find((node) => /^\s*1\s*$/.test(node.text()) || /page-1(?:\/|$)/i.test(node.attr('href') || ''))
    ?.attr('href')
  if (!href) return null
  try {
    return new URL(href, HOST).href
  } catch {
    return href
  }
}

function isBannerUrl(url: string): boolean {
  return /banner|_logo|title[-_]?card/i.test(url)
}

function isThumbnailUrl(url: string): boolean {
  return (
    /preview\.f95zone\./i.test(url) ||
    /\.thumb\.|_thumb\b|\/thumb(nails?)?\/|\/data\/attachments\/[^/?#]+\/[^/?#]+\/thumb/i.test(url)
  )
}

function upgradeImageUrl(url: string): string {
  return url
    .replace(/^https?:\/\/preview\.f95zone\.(?:to|com|ninja)\//i, 'https://attachments.f95zone.to/')
    .replace(/\.thumb\.(jpe?g|png|gif|webp|avif)/i, '.$1')
    .replace(/([?&])thumb=\d+(?=&|$)/i, '')
    .replace(/\/thumb(nails?)?\//gi, '/')
}

function unique(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of items) {
    if (!item || seen.has(item)) continue
    seen.add(item)
    out.push(item)
  }
  return out
}
