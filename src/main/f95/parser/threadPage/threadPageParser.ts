import { load, type CheerioAPI } from 'cheerio'
import { parseCountText, saneLikeCount, saneViewCount } from '../../../../shared/counts'
import { PREFIX_NODE_SELECTOR } from '../../parse'

const HOST = 'https://f95zone.to'

/** XenForo page chrome from a full thread HTML document (not first-post body). */
export type ThreadPageMeta = {
  title: string
  prefixes: string[]
  ogTitle: string
  tags: string[]
  starter: string
  likes: number
  views: number
  canonicalUrl: string
  ogUrl: string
  ogImage: string
}

export function parseThreadPage(html: string): ThreadPageMeta {
  return parseThreadPageDocument(load(html))
}

export function parseThreadPageDocument($: CheerioAPI): ThreadPageMeta {
  const counts = pageCounts($)
  return {
    title: pageTitle($),
    prefixes: headingPrefixes($),
    ogTitle: stripF95Suffix($('meta[property="og:title"]').attr('content') || ''),
    tags: pageTags($),
    starter: threadStarter($),
    likes: counts.likes,
    views: counts.views,
    canonicalUrl: absolutize($('link[rel="canonical"]').attr('href')) || '',
    ogUrl: absolutize($('meta[property="og:url"]').attr('content')) || '',
    ogImage: absolutize($('meta[property="og:image"]').attr('content')) || ''
  }
}

function normalize(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function stripF95Suffix(value: string): string {
  return value.replace(/\s+\|\s+F95zone.*$/i, '').trim()
}

function absolutize(url: string | undefined | null): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed, HOST).href
  } catch {
    return trimmed
  }
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

function pageTitle($: CheerioAPI): string {
  const heading = $('h1.p-title-value, h1.p-title-page, .p-title h1').first().clone()
  heading.find('.label, .label-append, [class^="pre-"], [class*=" pre-"]').remove()
  heading.find('a.labelLink').each((_, el) => {
    const node = $(el)
    const text = normalize(node.text())
    if (!text) node.remove()
    else node.replaceWith(node.contents())
  })
  const fromHeading = normalize(heading.text())
  const og = stripF95Suffix($('meta[property="og:title"]').attr('content') || '')
  const doc = stripF95Suffix($('title').first().text() || '')
  return fromHeading || og || doc
}

function headingPrefixes($: CheerioAPI): string[] {
  return unique(
    $('h1.p-title-value')
      .find(PREFIX_NODE_SELECTOR)
      .toArray()
      .map((el) => normalize($(el).text()))
      .filter(Boolean)
  )
}

function pageTags($: CheerioAPI): string[] {
  return unique(
    $('a.tagItem, .js-tagList a')
      .toArray()
      .map((el) => normalize($(el).text()))
      .filter(Boolean)
  )
}

function threadStarter($: CheerioAPI): string {
  const starter = $('.message-threadStarterPost').first()
  const post = starter.length ? starter : $('.message--post').first()
  return (
    post
      .find('.message-userDetails a.username, h4.message-name a.username, a.username')
      .first()
      .text()
      .trim() || $('.p-description').find('a.username').last().text().trim()
  )
}

function pageCounts($: CheerioAPI): { likes: number; views: number } {
  let views = 0
  let likes = 0

  // Thread pages often omit view counts; never read similar-thread / sidebar widgets.
  const viewBlocks = [
    $('.p-description').first().text(),
    $('.p-title-meta').first().text(),
    $('.p-description ul.listInline, .p-title ul.listInline').first().text()
  ]
  for (const text of viewBlocks) {
    const match = text.match(/Views?:\s*([\d,.]+(?:\.\d+)?\s*[kmb]?)/i)
    views = saneViewCount(parseCountText(match?.[1]))
    if (views) break
  }

  $('.p-body-header dt, .p-description dt, .p-title-meta dt, .p-title dt').each((_, el) => {
    const node = $(el)
    const label = node.text().replace(/\s+/g, ' ').trim()
    const value = (node.next('dd').text() || node.prev('dd').text()).replace(/\s+/g, ' ').trim()
    if (!views && /^views?$/i.test(label)) views = saneViewCount(parseCountText(value))
    if (!likes && /^(likes?|reactions?)$/i.test(label)) likes = saneLikeCount(parseCountText(value))
  })

  const starter = $('.message-threadStarterPost').first()
  const post = starter.length ? starter : $('article.message--post, .message--post').first()
  if (!likes) {
    likes = saneLikeCount(parseCountText(post.find('[data-reaction-count]').first().attr('data-reaction-count')))
  }
  if (!likes) {
    const link = post.find('a.reactionsBar-link, .message-attribution-opposite a[href*="/reactions"]').first()
    const text = link.text().replace(/\s+/g, ' ').trim()
    const others = text.match(/and\s+([\d,.]+)\s+others/i)
    let fromPeople = 0
    if (others) {
      const extra = parseCountText(others[1])
      const named = link.find('bdi, .username').length || Math.min(3, (text.match(/,/g) || []).length + 1)
      fromPeople = extra + Math.max(1, named)
    }
    likes = saneLikeCount(
      parseCountText(link.attr('data-reaction-count')) ||
        fromPeople ||
        parseCountText(link.attr('title')) ||
        parseCountText(text)
    )
  }

  return { likes, views }
}
