import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { ThreadReview, ThreadReviewsPage } from '@shared/types'
import { extractThreadId } from '../../parse'

export type { ThreadReview } from '@shared/types'

const REVIEW_NODE_SELECTOR =
  '.lfsReview, .message--review, .structItem--review, [class*="br-review"]'

const HOST = 'https://f95zone.to'
const LIGHTBOX_SELECTOR =
  'a.js-lbImage, a[data-fancybox], a.lbContainer, .lbContainer--inline, .lbContainer-zoomer, a.lbContainer-overlay'
const EMBED_ID = /^[\w-]{2,64}$/
const SHIM_PATH = /(?:^|\/)([a-z0-9_-]+?)(?:\.min)?\.html?$/i

/**
 * Parse review cards from a dedicated `/br-reviews` (or `/reviews`) page HTML.
 * `html` is the full page document.
 */
export function parseReviews(html: string, threadId = 0): ThreadReview[] {
  if (!html.trim()) return []
  return parseReviewsDocument(load(html), threadId, true)
}

/** Same extraction against an already-loaded document (reviews page or thread fallback). */
export function parseReviewsDocument(
  $: CheerioAPI,
  threadId = 0,
  isReviewsPage = false
): ThreadReview[] {
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
    if (!review) return
    const text = reviewText(review.html)
    if (text.length > 20 || review.rating) reviews.push(review)
  })
  if (reviews.length) return unique(reviews, reviewKey)

  if (!isReviewsPage) return []

  $('.p-body-pageContent h2, .p-body-pageContent h3, .p-body-pageContent h4').each((_, el) => {
    const heading = $(el)
    if (heading.closest('.p-title, .p-description, .tabs').length) return
    const author = heading.find('a.username').text().trim() || normalize(heading.text())
    if (!author || /review/i.test(author)) return
    const chunk = heading.nextUntil('h2, h3, h4')
    const html = sanitizeHtml(chunk.toArray().map((item) => $.html(item) || '').join(''), threadId)
    if (!reviewText(html)) return
    const nearby = heading.prevAll().toArray().slice(0, 3).map((item) => $(item).text()).join(' ')
    const rating = Number((nearby + heading.parent().text()).match(/(\d+(?:\.\d+)?)\s*star/i)?.[1] || 0)
    reviews.push({ author, rating, date: '', html })
  })
  return unique(reviews, reviewKey)
}

export function parseReviewsPageNav(html: string): { page: number; totalPages: number } {
  return parseReviewsPageNavDocument(load(html))
}

export function parseReviewsPageNavDocument($: CheerioAPI): { page: number; totalPages: number } {
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

export function parseReviewsTotal(html: string, fallback: number): number {
  return parseReviewsTotalDocument(load(html), fallback)
}

export function parseReviewsTotalDocument($: CheerioAPI, fallback: number): number {
  const tabText = $(
    'a.tabs-tab[href*="br-reviews"], a.tabs-tab[href*="/reviews"], a[href*="br-reviews"]'
  )
    .first()
    .text()
  const heading = $('h1, h2, h3, .p-title-value').first().text()
  const fromTab = Number(tabText.match(/([\d,]+)/)?.[1]?.replace(/,/g, '') || 0)
  const fromHeading = Number(heading.match(/([\d,]+)\s*review/i)?.[1]?.replace(/,/g, '') || 0)
  return fromTab || fromHeading || jsonLdReviewCount($) || fallback
}

/** True when the document is (or clearly contains) a reviews listing. */
export function documentHasReviewNodes($: CheerioAPI): boolean {
  return $(REVIEW_NODE_SELECTOR).length > 0
}

/**
 * Build a reviews page payload from one already-loaded document.
 * Pass `isReviewsPage=false` for the thread page (embedded / fallback reviews).
 */
export function reviewsPageFromDocument(
  $: CheerioAPI,
  threadId: number,
  isReviewsPage: boolean,
  requestedPage = 1
): ThreadReviewsPage {
  const reviews = parseReviewsDocument($, threadId, isReviewsPage)
  const nav = isReviewsPage
    ? parseReviewsPageNavDocument($)
    : { page: requestedPage, totalPages: 1 }
  const total = parseReviewsTotalDocument($, reviews.length)
  const estimatedPages =
    reviews.length && total > reviews.length ? Math.ceil(total / reviews.length) : 1
  const totalPages = nav.totalPages > 1 ? nav.totalPages : Math.max(1, estimatedPages)
  return {
    threadId,
    page: nav.page || requestedPage,
    totalPages,
    total: total || reviews.length,
    reviews
  }
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
  const text = reviewText(html)
  if (!author && !text) return null
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
  return { author: author || 'Anonymous', rating, date: date || '', html }
}

function reviewText(html: string): string {
  if (!html.trim()) return ''
  return normalize(load(`<div id="x">${html}</div>`)('#x').text())
}

function reviewKey(review: ThreadReview): string {
  return `${review.author}:${reviewText(review.html).slice(0, 80)}`
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

function pageFromHref(href: string | undefined | null): number {
  if (!href) return 0
  return Number(href.match(/\/page-(\d+)(?:\/|$|\?)/i)?.[1] || 0)
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

function normalize(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function absolutize(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    return new URL(url, HOST).href
  } catch {
    return url
  }
}

function youtubeEmbed(id: string, start?: string | null): string {
  if (!EMBED_ID.test(id)) return ''
  const seconds = start && /^\d+$/.test(start) ? `?start=${start}` : ''
  return `https://www.youtube.com/embed/${id}${seconds}`
}

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

function fromPlayerShim(url: URL): string {
  const site = SHIM_PATH.exec(url.pathname)?.[1]?.toLowerCase()
  if (!site) return ''
  const query = url.searchParams
  let payload = url.hash.replace(/^#/, '') || query.get('v') || query.get('video') || query.get('id') || ''
  try {
    payload = decodeURIComponent(payload)
  } catch {
    // Keep the raw payload when decoding fails.
  }
  const id = payload.split(/[;&,]/)[0] ?? ''
  const start = query.get('t') || query.get('start') || /[;&](?:t|start)=(\d+)/.exec(payload)?.[1]
  return playerUrl(site, id, start)
}

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

function embedFromMediaKey(wrapper: Cheerio<AnyNode>): string {
  const site = (wrapper.attr('data-media-site-id') || '').toLowerCase()
  const key = wrapper.attr('data-media-key') || ''
  if (!site || !key) return ''
  const [id, start] = key.split('/')
  return playerUrl(site, id, start)
}

function embedSiteName(node: Cheerio<AnyNode>): string {
  return (
    node.attr('data-s9e-mediaembed') ||
    node.parents('[data-s9e-mediaembed]').last().attr('data-s9e-mediaembed') ||
    node.parents('[data-media-site-id]').last().attr('data-media-site-id') ||
    ''
  ).toLowerCase()
}

function embedFromThumbnail(node: Cheerio<AnyNode>): string {
  const style = `${node.attr('style') || ''} ${node.parent().attr('style') || ''}`
  const id = /i\.ytimg\.com\/vi\/([\w-]{4,64})\//.exec(style)?.[1]
  return id ? youtubeEmbed(id) : ''
}

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

function embedShell(node: Cheerio<AnyNode>): Cheerio<AnyNode> {
  const wrapper = node.parents('.bbMediaWrapper, [data-s9e-mediaembed]').last()
  return wrapper.length ? wrapper : node
}

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
    if (embedSiteName(node) && /^https?:\/\//i.test(raw)) {
      shell.replaceWith(buildEmbedFallback($, raw))
      return
    }
    shell.remove()
  })

  root.find('.bbMediaWrapper[data-media-key]').each((_, el) => {
    const wrapper = $(el)
    if (wrapper.find('iframe').length) return
    const src = embedFromMediaKey(wrapper)
    if (!src) return
    wrapper.replaceWith(buildEmbed($, src))
  })
}

function isWeakCover(url: string): boolean {
  return /^(data:)|\/styles\/|\/data\/avatars\/|\/data\/assets\/|\/data\/covers\/|favicon|default.?logo|xenforo|smilies?\//i.test(
    url
  )
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
