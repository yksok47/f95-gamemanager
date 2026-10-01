import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { ThreadPost, ThreadPostReaction, ThreadPostsPage } from '@shared/types'
import { parseCountText, saneLikeCount } from '../../../../shared/counts'
import { extractPostId, extractThreadId } from '../../parse'
import { sanitizeHtml } from '../reviews/reviewsParser'

const HOST = 'https://f95zone.to'
const POST_SELECTOR = 'article.message--post.js-post, article.message--post[data-content^="post-"]'

/**
 * Discussion posts from a full thread page. Skips the OP (already shown in
 * Overview/About) and signature blocks.
 */
export function parsePosts(html: string): ThreadPost[] {
  if (!html.trim()) return []
  const $ = load(html)
  const threadId = threadIdFromDocument($)
  return parsePostsDocument($, threadId)
}

export function parsePostsDocument($: CheerioAPI, threadId = 0): ThreadPost[] {
  const posts: ThreadPost[] = []
  $(POST_SELECTOR).each((_, el) => {
    const node = $(el)
    if (node.closest('.js-quickReply, .message--quickReply').length) return
    if (node.hasClass('message-threadStarterPost')) return
    const post = postFromNode(node, threadId, $)
    if (post) posts.push(post)
  })
  return unique(posts, (post) => String(post.postId))
}

export function parsePostsPageNav(html: string): { page: number; totalPages: number } {
  return parsePostsPageNavDocument(load(html))
}

export function parsePostsPageNavDocument($: CheerioAPI): { page: number; totalPages: number } {
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

export function documentCanPost($: CheerioAPI): boolean {
  return $('.js-quickReply, form[action*="/add-reply"]').length > 0
}

export function postsPageFromDocument(
  $: CheerioAPI,
  threadId: number,
  requestedPage = 1,
  focusPostId: number | null = null
): ThreadPostsPage {
  const nav = parsePostsPageNavDocument($)
  const posts = parsePostsDocument($, threadId)
  const focus =
    focusPostId && posts.some((post) => post.postId === focusPostId)
      ? focusPostId
      : (posts[0]?.postId ?? null)
  return {
    threadId,
    page: nav.page || requestedPage,
    totalPages: nav.totalPages,
    posts,
    canPost: documentCanPost($),
    focusPostId: focus
  }
}

function postFromNode(node: Cheerio<AnyNode>, threadId: number, $: CheerioAPI): ThreadPost | null {
  const postId = postIdFromNode(node)
  if (!postId) return null

  const authorLink = node
    .find('.message-userDetails a.username, h4.message-name a.username, a.username')
    .first()
  const author = authorLink.text().trim() || normalize(node.attr('data-author') || '') || 'Anonymous'
  const authorId = Number(authorLink.attr('data-user-id') || 0) || null
  const date =
    node.find('.message-attribution time').first().attr('datetime') ||
    normalize(node.find('.message-attribution time, .message-attribution .u-dt').first().text())
  const position = positionFromNode(node)
  const permalink = permalinkFromNode(node, postId)
  const html = sanitizePostHtml(postBodyHtml(node), threadId)
  const likeBtn = node.find('a.actionBar-action--reaction').first()
  const quoteBtn = node.find('a.actionBar-action--mq, a[data-quote-href]').first()
  const replyBtn = node.find('a.actionBar-action--reply').first()

  return {
    postId,
    author,
    authorId,
    date: date || '',
    position,
    url: permalink,
    html,
    liked: likeBtn.hasClass('has-reaction') || /has-reaction/.test(likeBtn.attr('class') || ''),
    canLike: likeBtn.length > 0,
    canQuote: quoteBtn.length > 0,
    canReply: replyBtn.length > 0 || quoteBtn.length > 0,
    canEdit: hasPostAction($, node, postId, 'edit'),
    canDelete: hasPostAction($, node, postId, 'delete'),
    reactions: reactionsFromNode($, node),
    reactionCount: reactionCountFromNode(node)
  }
}

export function parsePostEditForm(html: string): { message: string; attachmentHash: string | null } | null {
  if (!html.trim()) return null
  const $ = load(html)
  const message = editorBbCode($)
  if (message == null) return null
  const hash = normalize(
    $('input[name="attachment_hash"]').first().attr('value') ||
      $('input[name="attachment_hash_combined[hash]"]').first().attr('value') ||
      hashFromCombined($('input[name="attachment_hash_combined"]').first().attr('value') || '') ||
      ''
  )
  return {
    message,
    attachmentHash: /^[a-f0-9]{32}$/i.test(hash) ? hash : null
  }
}

function editorBbCode($: CheerioAPI): string | null {
  const named = $('textarea[name="message"], input[name="message"]').first()
  const namedValue = named.length ? formValue(named) : null
  const bb = $('input[data-bb-code="message"]').first()
  const bbValue = bb.length ? formValue(bb) : null

  if (namedValue != null && namedValue.trim()) return namedValue
  if (bbValue != null) return bbValue
  if (namedValue != null) return namedValue

  for (const el of $('noscript').toArray()) {
    const inner = $(el).html() || $(el).text() || ''
    if (!/name\s*=\s*["']message["']/i.test(inner)) continue
    const nested = parsePostEditForm(inner)
    if (nested) return nested.message
  }

  return null
}

function formValue(node: Cheerio<AnyNode>): string {
  const raw = node.val() ?? node.attr('value') ?? ''
  return typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join('') : ''
}

function hashFromCombined(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{')) return ''
  try {
    const parsed = JSON.parse(trimmed) as { hash?: unknown }
    return typeof parsed.hash === 'string' ? parsed.hash : ''
  } catch {
    return ''
  }
}

function hasPostAction(
  $: CheerioAPI,
  node: Cheerio<AnyNode>,
  postId: number,
  action: 'edit' | 'delete'
): boolean {
  if (action === 'edit' && node.find('a[data-xf-click="quick-edit"]').length) return true
  if (node.find(`a.actionBar-action--${action}`).length) return true
  const match = new RegExp(`/posts/${postId}/${action}(?:/|$|\\?)`, 'i')
  let found = false
  node.find('a[href], a[data-href]').each((_, el) => {
    if (found) return
    const href = $(el).attr('href') || $(el).attr('data-href') || ''
    if (match.test(href)) found = true
  })
  return found
}

function postIdFromNode(node: Cheerio<AnyNode>): number {
  const fromContent = Number((node.attr('data-content') || '').replace(/^post-/i, ''))
  if (fromContent > 0) return fromContent
  const fromId = Number((node.attr('id') || '').replace(/^js-post-/i, ''))
  if (fromId > 0) return fromId
  return extractPostId(node.find('span.u-anchorTarget').first().attr('id') || '') || 0
}

function positionFromNode(node: Cheerio<AnyNode>): number {
  const text = normalize(
    node.find('.message-attribution-opposite a[href*="/post-"]').last().text()
  )
  return Number(text.replace(/^#/, '').match(/^(\d+)$/)?.[1] || 0)
}

function permalinkFromNode(node: Cheerio<AnyNode>, postId: number): string {
  const href =
    node.find('.message-attribution-main a[href]').first().attr('href') ||
    node.find(`a[href*="/post-${postId}"]`).first().attr('href') ||
    `/posts/${postId}/`
  return absolutize(href) || `https://f95zone.to/posts/${postId}/`
}

function postBodyHtml(node: Cheerio<AnyNode>): string {
  const body = node.find('.message-body').first().clone()
  body.find('.message-signature, aside.message-signature, .js-selectToQuoteEnd').remove()
  const wrapper = body.find('.bbWrapper').first()
  const html = wrapper.length ? wrapper.html() : body.html()
  return html?.trim() ?? ''
}

function sanitizePostHtml(html: string, threadId: number): string {
  const cleaned = sanitizeHtml(html, threadId)
  if (!cleaned) return ''
  const $ = load(`<div id="root">${cleaned}</div>`)
  const root = $('#root')
  // XenForo always injects "Click to expand..."; we collapse long quotes ourselves.
  root.find('.bbCodeBlock-expandLink').remove()
  root.find('.lbContainer-zoomer').remove()
  root.find('img, .lbContainer, .lbContainer--inline').each((_, el) => {
    const node = $(el)
    node.removeAttr('width')
    node.removeAttr('height')
    const style = node.attr('style')
    if (style == null) return
    const next = style
      .replace(/(?:max-|min-)?width\s*:[^;]+;?/gi, '')
      .replace(/(?:max-|min-)?height\s*:[^;]+;?/gi, '')
      .replace(/^\s*;\s*|\s*;\s*$/g, '')
      .trim()
    if (next) node.attr('style', next)
    else node.removeAttr('style')
  })
  root.find('a[href]').each((_, el) => {
    const node = $(el)
    const postId = extractPostId(node.attr('href') || '')
    if (postId) node.attr('data-post-id', String(postId))
  })
  return root.html()?.trim() ?? ''
}

function reactionsFromNode($: CheerioAPI, node: Cheerio<AnyNode>): ThreadPostReaction[] {
  const seen = new Set<number>()
  const out: ThreadPostReaction[] = []
  node
    .find('.reactionsBar .reaction[data-reaction-id], .reactionSummary .reaction[data-reaction-id]')
    .each((_, el) => {
      const item = $(el)
      const id = Number(item.attr('data-reaction-id') || 0)
      if (!id || seen.has(id)) return
      seen.add(id)
      const title =
        item.attr('title') ||
        item.find('img').first().attr('title') ||
        item.find('img').first().attr('alt') ||
        ''
      out.push({ id, title: title.trim() || `Reaction ${id}` })
    })
  out.sort((a, b) => a.id - b.id)
  return out
}

function reactionCountFromNode(node: Cheerio<AnyNode>): number {
  const bar = node.find('.reactionsBar, .js-reactionsList').first()
  const counted = saneLikeCount(bar.find('[data-reaction-count]').first().attr('data-reaction-count'))
  if (counted) return counted

  const link = bar.find('a.reactionsBar-link, a[href*="/reactions"]').first()
  const text = normalize(link.text())
  const others = text.match(/and\s+([\d,.]+)\s+others/i)
  if (others) {
    const extra = parseCountText(others[1])
    const named = link.find('bdi, .username').length || Math.min(3, (text.match(/,/g) || []).length + 1)
    return saneLikeCount(extra + Math.max(1, named))
  }
  if (link.length) {
    const named = link.find('bdi, .username').length
    if (named) return named
    return saneLikeCount(parseCountText(link.attr('data-reaction-count')) || parseCountText(text))
  }
  return 0
}

function threadIdFromDocument($: CheerioAPI): number {
  return (
    extractThreadId($('link[rel="canonical"]').attr('href') || '') ||
    extractThreadId($('meta[property="og:url"]').attr('content') || '') ||
    0
  )
}

function pageFromHref(href: string | undefined | null): number {
  if (!href) return 0
  return Number(href.match(/\/page-(\d+)(?:\/|$|\?)/i)?.[1] || 0)
}

function unique<T>(items: T[], keyFn: (item: T) => string): T[] {
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
