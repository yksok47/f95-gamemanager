import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { ThreadPostSearchHit, ThreadPostSearchPage } from '@shared/types'
import { extractPostId, extractThreadId } from '../../parse'
import { sanitizeHtml } from '../reviews/reviewsParser'

const HOST = 'https://f95zone.to'
const SEARCH_ID_RE = /\/search\/(\d+)(?:\/|$|\?)/i
const GOTO_POST_RE = /goto\/post\?id=(\d+)/i

/**
 * XenForo search-results page (or overlay HTML) for a thread-constrained
 * post query. Skips thread-only hits that have no post id.
 */
export function parsePostSearch(html: string, threadId = 0): ThreadPostSearchPage {
  if (!html.trim()) return emptyPage(threadId, '')
  return postSearchPageFromDocument(load(html), threadId, '')
}

export function postSearchPageFromDocument(
  $: CheerioAPI,
  threadId = 0,
  query = ''
): ThreadPostSearchPage {
  const nav = parseSearchPageNavDocument($)
  const searchId = searchIdFromDocument($)
  const keywords = query.trim() || keywordsFromDocument($)
  const results = parsePostSearchDocument($, threadId)
  const inferredThread =
    threadId ||
    results.reduce((id, hit) => id || extractThreadId(hit.url) || 0, 0)
  return {
    threadId: inferredThread,
    query: keywords,
    page: nav.page,
    totalPages: nav.totalPages,
    searchId,
    results
  }
}

export function parsePostSearchDocument($: CheerioAPI, threadId = 0): ThreadPostSearchHit[] {
  const hits: ThreadPostSearchHit[] = []
  searchRows($).each((_, el) => {
    const hit = hitFromNode($(el), threadId)
    if (hit) hits.push(hit)
  })
  return unique(hits, (hit) => String(hit.postId))
}

function searchRows($: CheerioAPI): Cheerio<AnyNode> {
  const scoped = $('.p-body-pageContent .contentRow, .overlay-content .contentRow')
  if (scoped.length) return scoped
  const block = $('.block-body .contentRow, li.block-row .contentRow')
  if (block.length) return block
  return $('.contentRow')
}

function hitFromNode(node: Cheerio<AnyNode>, threadId: number): ThreadPostSearchHit | null {
  const titleLink = node.find('.contentRow-title a[href]').first()
  const snippetNode = node.find('.contentRow-snippet').first()
  const href =
    titleLink.attr('href') ||
    node.find('a[href*="/post-"], a[href*="/posts/"], a[href*="goto/post"]').first().attr('href') ||
    ''
  const postId =
    postIdFromHref(href) ||
    postIdFromHref(node.attr('data-content') || '') ||
    postIdFromHref(snippetNode.find('a[href]').first().attr('href') || '')
  if (!postId) return null

  const url = absolutize(href) || `https://f95zone.to/posts/${postId}/`
  const hitThread = extractThreadId(url) || 0
  if (threadId && hitThread && hitThread !== threadId) return null

  const authorLink = node.find('a.username, .username').first()
  const author = authorLink.text().trim() || 'Anonymous'
  const date =
    node.find('time').first().attr('datetime') ||
    normalize(node.find('time, .u-dt').first().text())
  const snippetHtml = sanitizeSnippet(snippetNode.length ? snippetNode.html() || '' : '', threadId)

  return {
    postId,
    author,
    date: date || '',
    snippetHtml,
    url
  }
}

function sanitizeSnippet(html: string, threadId: number): string {
  const cleaned = sanitizeHtml(html, threadId)
  if (!cleaned) return ''
  const $ = load(`<div id="root">${cleaned}</div>`)
  const root = $('#root')
  root.find('a[href]').each((_, el) => {
    const node = $(el)
    node.replaceWith(node.contents())
  })
  return root.html()?.trim() ?? ''
}

function keywordsFromDocument($: CheerioAPI): string {
  return String(
    $('input[name="keywords"]').first().attr('value') ||
      $('input[type="search"]').first().attr('value') ||
      ''
  ).trim()
}

function searchIdFromDocument($: CheerioAPI): number | null {
  const candidates = [
    $('link[rel="canonical"]').attr('href') || '',
    $('meta[property="og:url"]').attr('content') || '',
    $('form[action*="/search/"]').attr('action') || '',
    $('.pageNav a[href*="/search/"]').first().attr('href') || ''
  ]
  for (const value of candidates) {
    const id = extractSearchId(value)
    if (id) return id
  }
  return null
}

export function extractSearchId(value: string | undefined | null): number | null {
  if (!value) return null
  const match = value.match(SEARCH_ID_RE)
  if (!match) return null
  const id = Number(match[1])
  return Number.isFinite(id) && id > 0 ? id : null
}

export function parseSearchPageNavDocument($: CheerioAPI): { page: number; totalPages: number } {
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

function postIdFromHref(href: string): number {
  return extractPostId(href) || Number(href.match(GOTO_POST_RE)?.[1] || 0) || 0
}

function pageFromHref(href: string | undefined | null): number {
  if (!href) return 0
  return (
    Number(href.match(/\/page-(\d+)(?:\/|$|\?)/i)?.[1] || 0) ||
    Number(href.match(/[?&]page=(\d+)(?:&|$)/i)?.[1] || 0)
  )
}

function emptyPage(threadId: number, query: string): ThreadPostSearchPage {
  return {
    threadId,
    query,
    page: 1,
    totalPages: 1,
    searchId: null,
    results: []
  }
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
