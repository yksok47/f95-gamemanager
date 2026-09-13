import { load, type CheerioAPI } from 'cheerio'
import type {
  ChangelogEntry,
  DownloadSection,
  NoteSection,
  RelatedGame,
  ThreadDetails,
  ThreadField,
  ThreadLink,
  ThreadReviewsPage
} from '@shared/types'
import { F95Error, f95Fetch, f95Url } from './http'
import { engineFromTitle, normalizeEngine } from '@shared/engines'
import { parseGameTitle } from './parse'
import { isWeakCover } from './lookup'
import { parseBanner } from './parser/banner/bannerParser'
import { parseDescription } from './parser/description/descriptionParser'
import { parseDownloads } from './parser/downloads/downloadsParser'
import { parseDownloadsSection } from './parser/downloadsSection/downloadsSectionParser'
import { parseFirstPost } from './parser/firstPost/firstPostParser'
import { parseGallery } from './parser/gallery/galleryParser'
import { parseNotes } from './parser/notes/notesParser'
import { parseOverview } from './parser/overview/overviewParser'
import { parseChangelogSection } from './parser/changelogSection/changelogSectionParser'
import { parseChangelog } from './parser/changelog/changelogParser'
import {
  parseReviewsDocument,
  parseReviewsPageNavDocument,
  parseReviewsTotalDocument
} from './parser/reviews/reviewsParser'
import { parseThreadPageDocument } from './parser/threadPage/threadPageParser'

const HOST = 'https://f95zone.to'
const CACHE_VERSION = 26

function absolutize(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    return new URL(url, HOST).href
  } catch {
    return url
  }
}

function unique<T>(items: T[], keyFn: (item: T) => string = String): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = keyFn(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** Header art rather than a screenshot, so it stays out of the gallery. */
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

function firstPageHref($: CheerioAPI): string | null {
  const href = $('nav.pageNav a, .pageNav-main a, .pageNav-jump')
    .toArray()
    .map((el) => $(el))
    .find((node) => /^\s*1\s*$/.test(node.text()) || /page-1(?:\/|$)/i.test(node.attr('href') || ''))
    ?.attr('href')
  return href ? absolutize(href) : null
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

type PostMeta = {
  fields: ThreadField[]
  creatorLinks: ThreadLink[]
  relatedGames: RelatedGame[]
  releaseDate: string
  updatedAt: string
}

type ParsedPost = {
  descriptionHtml: string
  notes: NoteSection[]
  changelog: ChangelogEntry[]
  /** Screenshots only. */
  gallery: string[]
  /** Header / cover art URL from the first post. */
  banner: string
  downloads: DownloadSection[]
  meta: PostMeta
}

function changelogEntriesFromParser(html: string): ChangelogEntry[] {
  return parseChangelog(parseChangelogSection(html)).map((row) => {
    const [version, text] = Object.entries(row)[0] ?? ['', '']
    return { version: version || 'Changes', text: text || '' }
  })
}

function overviewMeta(html: string, threadId: number): PostMeta {
  const overview = parseOverview(html)
  return {
    fields: overview.fields,
    creatorLinks: overview.creatorLinks,
    relatedGames: overview.relatedGames.filter((game) => game.threadId !== threadId),
    releaseDate: overview.releaseDate,
    updatedAt: overview.updatedAt
  }
}

export function parsePost(html: string, threadId: number): ParsedPost {
  return {
    descriptionHtml: parseDescription(html),
    notes: parseNotes(html),
    changelog: changelogEntriesFromParser(html),
    gallery: parseGallery(html),
    banner: parseBanner(html),
    downloads: parseDownloads(parseDownloadsSection(html)),
    meta: overviewMeta(html, threadId)
  }
}

function emptyPost(): ParsedPost {
  return {
    descriptionHtml: '',
    notes: [],
    changelog: [],
    gallery: [],
    banner: '',
    downloads: [],
    meta: { fields: [], creatorLinks: [], relatedGames: [], releaseDate: '', updatedAt: '' }
  }
}

function reviewListPaths(threadId: number, page: number, canonical?: string): string[] {
  const extra = page > 1 ? `/page-${page}` : ''
  const bases = [`${HOST}/threads/${threadId}`]
  if (canonical) {
    bases.unshift(canonical.replace(/\/$/, '').replace(/\/(br-reviews|reviews)(?:\/page-\d+)?$/i, ''))
  }
  return unique(bases.flatMap((base) => [`${base}/br-reviews${extra}`, `${base}/reviews${extra}`]))
}

const reviewsCache = new Map<string, { at: number; value: ThreadReviewsPage }>()
const detailsCache = new Map<string, { at: number; value: ThreadDetails }>()
const DETAILS_TTL_MS = 10 * 60 * 1000

export async function fetchThreadReviews(
  threadId: number,
  page = 1,
  options: { canonical?: string; fallback$?: CheerioAPI } = {}
): Promise<ThreadReviewsPage> {
  const safePage = Math.max(1, Math.floor(page) || 1)
  const cacheKey = `${CACHE_VERSION}:reviews:${threadId}:${safePage}`
  const cached = reviewsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < DETAILS_TTL_MS) return cached.value

  for (const path of reviewListPaths(threadId, safePage, options.canonical)) {
    try {
      const { body, response } = await f95Fetch(path, {}, { timeoutMs: 25000 })
      if (response.status >= 400) continue
      const $ = load(body)
      const onReviewsPage = /br-reviews|\/reviews/i.test(response.url)
      if (
        !onReviewsPage &&
        !$('.lfsReview, .message--review, .structItem--review, [class*="br-review"]').length
      ) {
        continue
      }
      const reviews = parseReviewsDocument($, threadId, true)
      if (!reviews.length && safePage === 1) continue
      const nav = parseReviewsPageNavDocument($)
      const total = parseReviewsTotalDocument($, reviews.length)
      const estimatedPages =
        reviews.length && total > reviews.length ? Math.ceil(total / reviews.length) : 1
      const totalPages = nav.totalPages > 1 ? nav.totalPages : Math.max(1, estimatedPages)
      const value: ThreadReviewsPage = {
        threadId,
        page: nav.page || safePage,
        totalPages,
        total: total || reviews.length,
        reviews
      }
      reviewsCache.set(cacheKey, { at: Date.now(), value })
      return value
    } catch {
      // Try the next reviews URL.
    }
  }

  const fallback =
    options.fallback$ && safePage <= 1
      ? parseReviewsDocument(options.fallback$, threadId, false)
      : []
  const value: ThreadReviewsPage = {
    threadId,
    page: safePage,
    totalPages: 1,
    total: fallback.length,
    reviews: fallback
  }
  if (fallback.length) reviewsCache.set(cacheKey, { at: Date.now(), value })
  if (fallback.length || safePage <= 1) return value
  throw new F95Error('Could not load that reviews page.', 'network')
}

async function loadThreadDocument(threadId: number): Promise<ReturnType<typeof load>> {
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
    // Keep the first response if pagination retry fails.
  }
  return $
}

export async function fetchThreadDetails(threadId: number): Promise<ThreadDetails> {
  const cacheKey = `${CACHE_VERSION}:${threadId}`
  const cached = detailsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < DETAILS_TTL_MS) return cached.value

  const $ = await loadThreadDocument(threadId)
  const page = parseThreadPageDocument($)
  const parsed = parseGameTitle(page.title)
  const canonical = page.canonicalUrl || page.ogUrl || f95Url(`/threads/${threadId}/`)

  const firstPostHtml = parseFirstPost($.html())
  const post = firstPostHtml ? parsePost(firstPostHtml, threadId) : emptyPost()
  const version = fieldValue(post.meta.fields, ['version', 'release version']) || parsed.version
  const creator = stripCreatorExtras(
    fieldValue(post.meta.fields, ['developer', 'developers', 'creator', 'author', 'developer/publisher']) ||
      parsed.creator ||
      page.starter
  )
  const ogCover =
    page.ogImage && !isWeakCover(page.ogImage) && !isThumbnailUrl(page.ogImage)
      ? upgradeImageUrl(page.ogImage)
      : null
  const cover = post.banner || ogCover

  const reviewPage = await fetchThreadReviews(threadId, 1, { canonical, fallback$: $ })

  const details: ThreadDetails = {
    threadId,
    threadUrl: canonical,
    title: parsed.title || page.title || `Thread ${threadId}`,
    creator,
    version,
    coverUrl: cover,
    tags: page.tags,
    fields: post.meta.fields,
    creatorLinks: post.meta.creatorLinks,
    relatedGames: post.meta.relatedGames,
    releaseDate: post.meta.releaseDate,
    updatedAt: post.meta.updatedAt,
    descriptionHtml: post.descriptionHtml,
    notes: post.notes,
    changelog: post.changelog,
    gallery: post.gallery.filter(
      (url) => url !== cover && !isThumbnailUrl(url) && !isBannerUrl(url)
    ),
    downloads: post.downloads,
    reviews: reviewPage.reviews,
    reviewsTotal: reviewPage.total || reviewPage.reviews.length,
    reviewsTotalPages: reviewPage.totalPages,
    engine: normalizeEngine(
      engineFromFields(post.meta.fields) ||
        engineFromTitle(page.prefixes.join(' ')) ||
        engineFromTitle(page.title) ||
        engineFromTitle(page.ogTitle)
    ),
    likes: page.likes,
    views: page.views
  }
  detailsCache.set(cacheKey, { at: Date.now(), value: details })
  return details
}
