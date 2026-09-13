import { load, type CheerioAPI, type Cheerio } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type {
  ChangelogEntry,
  DownloadSection,
  NoteSection,
  RelatedGame,
  ThreadDetails,
  ThreadField,
  ThreadLink,
  ThreadReview,
  ThreadReviewsPage
} from '@shared/types'
import { F95Error, f95Fetch, f95Url } from './http'
import { engineFromTitle, normalizeEngine } from '@shared/engines'
import { extractThreadId, parseGameTitle, PREFIX_NODE_SELECTOR } from './parse'
import { isWeakCover, parseThreadCounts, headingTitle } from './lookup'
import { parseBanner } from './parser/banner/bannerParser'
import { parseDescription } from './parser/description/descriptionParser'
import { parseDownloads } from './parser/downloads/downloadsParser'
import { parseDownloadsSection } from './parser/downloadsSection/downloadsSectionParser'
import { parseGallery } from './parser/gallery/galleryParser'
import { parseNotes } from './parser/notes/notesParser'
import { parseOverview } from './parser/overview/overviewParser'
import { parseChangelogSection } from './parser/changelogSection/changelogSectionParser'
import { parseChangelog } from './parser/changelog/changelogParser'

const HOST = 'https://f95zone.to'
const CACHE_VERSION = 23
const LIGHTBOX_SELECTOR =
  'a.js-lbImage, a[data-fancybox], a.lbContainer, .lbContainer--inline, .lbContainer-zoomer, a.lbContainer-overlay'

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

function uniqueUrls(urls: string[]): string[] {
  return unique(urls)
}

function normalize(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
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

function largestSrcset(srcset: string | undefined): string | null {
  if (!srcset) return null
  let best: { url: string; size: number } | null = null
  for (const part of srcset.split(',')) {
    const bits = part.trim().split(/\s+/)
    const raw = bits[0]
    if (!raw) continue
    const size = Number.parseInt(bits[1] || '0', 10) || 0
    if (!best || size >= best.size) best = { url: raw, size }
  }
  return best?.url || null
}

function isImageAsset(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/i.test(url) || /attachments\.f95zone|preview\.f95zone/.test(url)
}

function acceptImageUrl(url: string | undefined | null, allowNonFile = false): string | null {
  const abs = absolutize(url)
  if (!abs || isWeakCover(abs) || abs.startsWith('javascript:') || abs.startsWith('data:')) return null
  const upgraded = upgradeImageUrl(abs)
  if (isThumbnailUrl(upgraded) || /\.html?(\?|$)/i.test(upgraded)) return null
  if (isImageAsset(upgraded) || allowNonFile) return upgraded
  return null
}

function fullImageUrl($img: Cheerio<AnyNode>): string | null {
  if (!$img.length || $img.is('.smilie, .reaction, .avatar')) return null
  const $lb = $img.closest(LIGHTBOX_SELECTOR)
  const $zoomer = $img.closest('.lbContainer--inline, .lbContainer').find('.lbContainer-zoomer').first()
  const parentHref = $img.parent().is('a') ? $img.parent().attr('href') : undefined
  const candidates = [
    $lb.attr('href'),
    $lb.attr('data-src'),
    $lb.attr('data-url'),
    $lb.attr('data-lb-src'),
    $zoomer.attr('data-src'),
    $img.attr('data-url'),
    $img.attr('data-fullurl'),
    $img.attr('data-original'),
    $img.attr('data-zoom-image'),
    largestSrcset($img.attr('data-srcset') || $img.attr('srcset')),
    parentHref,
    $img.attr('data-src'),
    $img.attr('src')
  ]
  for (const candidate of candidates) {
    const url = acceptImageUrl(candidate, $lb.length > 0)
    if (url) return url
  }
  return null
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

const EMBED_ID = /^[\w-]{2,64}$/

function youtubeEmbed(id: string, start?: string | null): string {
  if (!EMBED_ID.test(id)) return ''
  const seconds = start && /^\d+$/.test(start) ? `?start=${start}` : ''
  return `https://www.youtube.com/embed/${id}${seconds}`
}

/** Player URL from a site name plus a bare video id. */
function playerUrl(site: string, id: string, start?: string | null): string {
  if (!id) return ''
  if (site === 'youtube' || site === 'youtube-nocookie') return youtubeEmbed(id, start)
  if (site === 'vimeo') return /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : ''
  if (site === 'dailymotion') {
    return EMBED_ID.test(id) ? `https://geo.dailymotion.com/player.html?video=${id}` : ''
  }
  if (site === 'streamable') return EMBED_ID.test(id) ? `https://streamable.com/e/${id}` : ''
  return ''
}

/**
 * Embeds rarely point straight at the video host. s9e MediaEmbed uses its own shim
 * (`.../iframe/2/youtube.min.html#<id>`) and F95 proxies through one of its own pages
 * (`https://zonerz.net/youtube.html?v=<id>`), so the player is rebuilt from the shim's
 * filename plus whatever carries the id.
 */
const SHIM_PATH = /(?:^|\/)([a-z0-9_-]+?)(?:\.min)?\.html?$/i

function fromPlayerShim(url: URL): string {
  const site = SHIM_PATH.exec(url.pathname)?.[1]?.toLowerCase()
  if (!site) return ''
  const query = url.searchParams
  let payload = url.hash.replace(/^#/, '') || query.get('v') || query.get('video') || query.get('id') || ''
  try {
    payload = decodeURIComponent(payload)
  } catch {
    // A malformed escape sequence is not worth discarding the id over.
  }
  const id = payload.split(/[;&,]/)[0] ?? ''
  const start = query.get('t') || query.get('start') || /[;&](?:t|start)=(\d+)/.exec(payload)?.[1]
  return playerUrl(site, id, start)
}

/**
 * Canonical player URL for a supported host, or '' when the link is not an embeddable
 * video. The result has to stay in step with the frame-src allowlist in index.html.
 */
function toEmbedUrl(raw: string): string {
  if (!raw) return ''
  let url: URL
  try {
    url = new URL(raw.startsWith('//') ? `https:${raw}` : raw)
  } catch {
    return ''
  }
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:') return ''

  const shim = fromPlayerShim(url)
  if (shim) return shim

  const host = url.hostname.replace(/^(www|m)\./i, '').toLowerCase()
  const path = url.pathname

  if (host === 'youtu.be') {
    return youtubeEmbed(path.slice(1), url.searchParams.get('t'))
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (path.startsWith('/embed/')) {
      return youtubeEmbed(path.slice(7), url.searchParams.get('start'))
    }
    if (path.startsWith('/shorts/')) return youtubeEmbed(path.slice(8))
    if (path === '/watch') return youtubeEmbed(url.searchParams.get('v') ?? '')
    return ''
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = /(\d{6,})/.exec(path)?.[1]
    return id ? `https://player.vimeo.com/video/${id}` : ''
  }
  if (host === 'dailymotion.com' || host === 'geo.dailymotion.com' || host === 'dai.ly') {
    const id =
      /\/(?:embed\/)?video\/([\w-]+)/.exec(path)?.[1] ??
      url.searchParams.get('video') ??
      (host === 'dai.ly' ? path.slice(1) : '')
    return id && EMBED_ID.test(id) ? `https://geo.dailymotion.com/player.html?video=${id}` : ''
  }
  if (host === 'streamable.com') {
    const id = path.replace(/^\/(?:e\/)?/, '').split('/')[0]
    return id && EMBED_ID.test(id) ? `https://streamable.com/e/${id}` : ''
  }
  if (host === 'odysee.com') {
    if (path.startsWith('/$/embed/')) return `https://odysee.com${path}`
    return path.length > 1 ? `https://odysee.com/$/embed${path}` : ''
  }
  return ''
}

/** XenForo keeps the video id on the wrapper, which survives even when the iframe is lazy. */
function embedFromMediaKey(wrapper: Cheerio<AnyNode>): string {
  const site = (wrapper.attr('data-media-site-id') || '').toLowerCase()
  const key = wrapper.attr('data-media-key') || ''
  if (!site || !key) return ''
  const [id, start] = key.split('/')
  return playerUrl(site, id, start)
}

/** Site name the forum tagged the embed with, independent of the iframe URL. */
function embedSiteName(node: Cheerio<AnyNode>): string {
  return (
    node.attr('data-s9e-mediaembed') ||
    node.parents('[data-s9e-mediaembed]').last().attr('data-s9e-mediaembed') ||
    node.parents('[data-media-site-id]').last().attr('data-media-site-id') ||
    ''
  ).toLowerCase()
}

/** Inactive miniplayers carry the video id in their poster image. */
function embedFromThumbnail(node: Cheerio<AnyNode>): string {
  const style = `${node.attr('style') || ''} ${node.parent().attr('style') || ''}`
  const id = /i\.ytimg\.com\/vi\/([\w-]{4,64})\//.exec(style)?.[1]
  return id ? youtubeEmbed(id) : ''
}

/** Last resort: the forum says which site this is, so mine the URL for an id. */
function embedFromSiteHint(node: Cheerio<AnyNode>, raw: string): string {
  const site = embedSiteName(node)
  if (!site || !raw) return ''
  const id = /[#/=]([\w-]{4,64})(?:[;&?#].*)?$/.exec(raw)?.[1] ?? ''
  return playerUrl(site, id)
}

function rawEmbedSrc(node: Cheerio<AnyNode>): string {
  return (
    node.attr('src') ||
    node.attr('data-s9e-mediaembed-src') ||
    node.attr('data-src') ||
    node.attr('data-url') ||
    ''
  )
}

/**
 * A bare iframe we control the sizing of. The s9e/XenForo wrappers rely on inline styles
 * and scripts that never run here, which is what left an empty box in the description.
 */
function buildEmbed($: CheerioAPI, src: string): Cheerio<AnyNode> {
  return $('<iframe></iframe>')
    .attr('src', src)
    .attr('class', 'details-embed')
    .attr('loading', 'lazy')
    .attr('referrerpolicy', 'strict-origin-when-cross-origin')
    .attr('allowfullscreen', 'true')
    .attr('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen')
    .attr('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups')
}

/** Outermost media wrapper around an embed, so the whole shell is replaced or dropped. */
function embedShell(node: Cheerio<AnyNode>): Cheerio<AnyNode> {
  const wrapper = node.parents('.bbMediaWrapper, [data-s9e-mediaembed]').last()
  return wrapper.length ? wrapper : node
}

/** A video we recognise but cannot play stays reachable instead of vanishing. */
function buildEmbedFallback($: CheerioAPI, href: string): Cheerio<AnyNode> {
  return $('<a></a>')
    .attr('href', href)
    .attr('class', 'details-embed-link')
    .text('Open video in browser')
}

function replaceMediaEmbeds($: CheerioAPI, root: Cheerio<AnyNode>): void {
  root.find('iframe, object, embed').each((_, el) => {
    const node = $(el)
    const shell = embedShell(node)
    const raw = rawEmbedSrc(node)
    const src =
      toEmbedUrl(raw) ||
      embedFromMediaKey(node.parents('[data-media-key]').last()) ||
      embedFromMediaKey(node) ||
      embedFromSiteHint(node, raw) ||
      embedFromThumbnail(node)
    if (src) {
      shell.replaceWith(buildEmbed($, src))
      return
    }
    // Tagged as media by the forum but unrecognised: keep a way to reach it.
    if (embedSiteName(node) && /^https?:\/\//i.test(raw)) {
      shell.replaceWith(buildEmbedFallback($, raw))
      return
    }
    shell.remove()
  })

  // Wrappers whose iframe is only created by XenForo's lazy-load script.
  root.find('.bbMediaWrapper[data-media-key]').each((_, el) => {
    const wrapper = $(el)
    if (wrapper.find('iframe').length) return
    const src = embedFromMediaKey(wrapper)
    if (!src) return
    wrapper.replaceWith(buildEmbed($, src))
  })
}

function sanitizeHtml(html: string, currentThreadId?: number): string {
  const $ = load(`<div id="root">${html}</div>`)
  const root = $('#root')
  root.find('.bbCodeSpoiler-button, button').remove()
  root.find('.bbCodeSpoiler, .bbCodeBlock--spoiler').each((_, el) => {
    const body = $(el).find('.bbCodeBlock-content, .bbCodeSpoiler-content').first()
    $(el).replaceWith(body.length ? body.contents() : $(el).contents())
  })
  replaceMediaEmbeds($, root)
  root.find('script, style, form, input, svg, noscript').remove()
  root.find('[onclick], [onload], [onerror], [srcdoc]').each((_, el) => {
    const node = $(el)
    for (const attr of Object.keys(el.attribs ?? {})) {
      if (attr.toLowerCase().startsWith('on')) node.removeAttr(attr)
    }
  })
  root.find('a[href]').each((_, el) => {
    const node = $(el)
    const href = node.attr('href') || ''
    if (href.startsWith('javascript:') || href.startsWith('data:')) {
      node.removeAttr('href')
      return
    }
    const abs = absolutize(href)
    if (!abs) return
    node.attr('href', abs)
    const threadId = extractThreadId(abs)
    if (threadId && threadId !== currentThreadId) {
      node.attr('data-thread-id', String(threadId))
      node.attr('data-thread-title', normalize(node.text()))
    }
    node.attr('target', '_blank')
    node.attr('rel', 'noreferrer')
  })
  root.find('img').each((_, el) => {
    const node = $(el)
    const src = fullImageUrl(node)
    if (!src) {
      node.remove()
      return
    }
    node.attr('src', src)
    node.removeAttr('srcset')
    node.attr('referrerpolicy', 'no-referrer')
  })
  return root.html()?.trim() ?? ''
}

function firstPost($: CheerioAPI): Cheerio<AnyNode> {
  const starter = $('.message-threadStarterPost').first()
  if (starter.length) return starter
  return $('.message--post').first()
}

function firstPageHref($: CheerioAPI): string | null {
  const href = $('nav.pageNav a, .pageNav-main a, .pageNav-jump')
    .toArray()
    .map((el) => $(el))
    .find((node) => /^\s*1\s*$/.test(node.text()) || /page-1(?:\/|$)/i.test(node.attr('href') || ''))
    ?.attr('href')
  return href ? absolutize(href) : null
}

function threadStarter($: CheerioAPI): string {
  return (
    firstPost($)
      .find('.message-userDetails a.username, h4.message-name a.username, a.username')
      .first()
      .text()
      .trim() || $('.p-description').find('a.username').last().text().trim()
  )
}

function firstWrapper($: CheerioAPI): Cheerio<AnyNode> {
  const post = firstPost($)
  const wrapper = post.find('.message-body .bbWrapper').first()
  if (wrapper.length) return wrapper
  return post.find('.message-body').first()
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

function headingPrefixText($: CheerioAPI): string {
  return $('h1.p-title-value')
    .find(PREFIX_NODE_SELECTOR)
    .toArray()
    .map((el) => normalize($(el).text()))
    .filter(Boolean)
    .join(' ')
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

function jsonLdReviewCount($: CheerioAPI): number {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(el).text() || '{}') as {
        aggregateRating?: { reviewCount?: string | number; ratingCount?: string | number }
      }
      const count = Number(data.aggregateRating?.reviewCount || data.aggregateRating?.ratingCount || 0)
      if (count) return count
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return 0
}

function reviewContent(node: Cheerio<AnyNode>): Cheerio<AnyNode> {
  const content = node
    .find(
      '.bbWrapper, .message-body, .lfsReview-content, .structItem-cell--main, .br-review-content, blockquote'
    )
    .first()
  if (content.length) return content.clone()
  return node.clone().children('h1, h2, h3, h4, .ratingStars, .username').remove().end()
}

function reviewFromNode(node: Cheerio<AnyNode>, threadId: number): ThreadReview | null {
  const author =
    node.find('a.username').first().text().trim() ||
    normalize(
      node.find('.message-name, .message-attribution-user, .structItem-parts, h2, h3, h4').first().text()
    )
  const content = reviewContent(node)
  content.find('.ratingStars, .br-rating, [data-score], [data-rating]').remove()
  const html = sanitizeHtml(content.html() || '', threadId)
  const body = normalize(content.text())
  if (!author && !body) return null
  const ratingText =
    node.find('.ratingStars, [data-score], [data-rating], .br-rating').first().attr('title') ||
    node.find('[data-score]').attr('data-score') ||
    node.find('[data-rating]').attr('data-rating') ||
    node.find('.ratingStars').attr('aria-label') ||
    node.text().match(/(\d+(?:\.\d+)?)\s*star/i)?.[0] ||
    ''
  const rating = Number(String(ratingText).match(/(\d+(?:\.\d+)?)/)?.[1] || 0)
  const date =
    node.find('time').first().attr('datetime') || normalize(node.find('time, .u-dt').first().text())
  return { author: author || 'Anonymous', rating, date: date || '', body, html }
}

function parseReviewNodes($: CheerioAPI, isReviewsPage = false, threadId = 0): ThreadReview[] {
  const reviews: ThreadReview[] = []
  const selectors = [
    '.lfsReview',
    '.structItem--review',
    '.message--review',
    '.brmsReview',
    '[class*="br-review"]'
  ]
  if (isReviewsPage) {
    selectors.push('.p-body-pageContent .block-row', '.p-body-pageContent article.message')
  }
  $(selectors.join(', ')).each((_, el) => {
    const node = $(el)
    if (node.find('.bbCodeSpoiler').length && node.closest('.message--post').length) return
    const review = reviewFromNode(node, threadId)
    if (review && (review.body.length > 20 || review.rating)) reviews.push(review)
  })
  if (reviews.length) return unique(reviews, (item) => `${item.author}:${item.body.slice(0, 80)}`)

  if (!isReviewsPage) return []

  $('.p-body-pageContent h2, .p-body-pageContent h3, .p-body-pageContent h4').each((_, el) => {
    const heading = $(el)
    if (heading.closest('.p-title, .p-description, .tabs').length) return
    const author = heading.find('a.username').text().trim() || normalize(heading.text())
    if (!author || /review/i.test(author)) return
    const chunk = heading.nextUntil('h2, h3, h4')
    const html = sanitizeHtml(chunk.toArray().map((item) => $.html(item) || '').join(''), threadId)
    const body = normalize(chunk.text())
    if (!body) return
    const nearby = heading.prevAll().toArray().slice(0, 3).map((item) => $(item).text()).join(' ')
    const rating = Number((nearby + heading.parent().text()).match(/(\d+(?:\.\d+)?)\s*star/i)?.[1] || 0)
    reviews.push({ author, rating, date: '', body, html })
  })
  return unique(reviews, (item) => `${item.author}:${item.body.slice(0, 80)}`)
}

function pageFromHref(href: string | undefined | null): number {
  if (!href) return 0
  return Number(href.match(/\/page-(\d+)(?:\/|$|\?)/i)?.[1] || 0)
}

function parsePageNav($: CheerioAPI): { page: number; totalPages: number } {
  const current =
    Number(
      normalize(
        $('.pageNav-page--current a, .pageNav-page--current, .pageNavSimple-el--current').first().text()
      ).match(/(\d+)/)?.[1] || 1
    ) || 1
  let totalPages = current
  $('.pageNav a[href], .pageNavSimple a[href], link[rel="next"], link[rel="prev"]').each((_, el) => {
    totalPages = Math.max(totalPages, pageFromHref($(el).attr('href')))
  })
  return { page: current, totalPages: Math.max(1, totalPages) }
}

function reviewListPaths(threadId: number, page: number, canonical?: string): string[] {
  const extra = page > 1 ? `/page-${page}` : ''
  const bases = [`${HOST}/threads/${threadId}`]
  if (canonical) {
    bases.unshift(canonical.replace(/\/$/, '').replace(/\/(br-reviews|reviews)(?:\/page-\d+)?$/i, ''))
  }
  return unique(bases.flatMap((base) => [`${base}/br-reviews${extra}`, `${base}/reviews${extra}`]))
}

function reviewsTotalFrom($: CheerioAPI, fallback: number): number {
  const tabText = $('a.tabs-tab[href*="br-reviews"], a.tabs-tab[href*="/reviews"], a[href*="br-reviews"]').first().text()
  const heading = $('h1, h2, h3, .p-title-value').first().text()
  return Number(
    tabText.match(/(\d+)/)?.[1] || heading.match(/(\d+)\s*review/i)?.[1] || jsonLdReviewCount($) || fallback
  )
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
      const reviews = parseReviewNodes($, true, threadId)
      if (!reviews.length && safePage === 1) continue
      const nav = parsePageNav($)
      const total = reviewsTotalFrom($, reviews.length)
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
    options.fallback$ && safePage <= 1 ? parseReviewNodes(options.fallback$, false, threadId) : []
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
  const rawTitle = headingTitle($)
  const parsed = parseGameTitle(rawTitle)
  const canonical =
    $('link[rel="canonical"]').attr('href') ||
    $('meta[property="og:url"]').attr('content') ||
    f95Url(`/threads/${threadId}/`)

  const wrapper = firstWrapper($)
  const post = wrapper.length ? parsePost(wrapper.html() || '', threadId) : emptyPost()
  const version = fieldValue(post.meta.fields, ['version', 'release version']) || parsed.version
  const creator = stripCreatorExtras(
    fieldValue(post.meta.fields, ['developer', 'developers', 'creator', 'author', 'developer/publisher']) ||
      parsed.creator ||
      threadStarter($)
  )
  const ogCover = absolutize($('meta[property="og:image"]').attr('content'))
  const og =
    ogCover && !isWeakCover(ogCover) && !isThumbnailUrl(ogCover) ? upgradeImageUrl(ogCover) : null
  const cover = post.banner || og
  const tags = $('a.tagItem, .js-tagList a')
    .toArray()
    .map((el) => normalize($(el).text()))
    .filter(Boolean)

  const reviewPage = await fetchThreadReviews(threadId, 1, { canonical, fallback$: $ })

  const counts = parseThreadCounts($)
  const details: ThreadDetails = {
    threadId,
    threadUrl: canonical,
    title: parsed.title || rawTitle || `Thread ${threadId}`,
    creator,
    version,
    coverUrl: cover,
    tags: uniqueUrls(tags),
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
        engineFromTitle(headingPrefixText($)) ||
        engineFromTitle(rawTitle) ||
        engineFromTitle(
          ($('meta[property="og:title"]').attr('content') || '').replace(/\s+\|\s+F95zone.*$/i, '')
        )
    ),
    likes: counts.likes,
    views: counts.views
  }
  detailsCache.set(cacheKey, { at: Date.now(), value: details })
  return details
}
