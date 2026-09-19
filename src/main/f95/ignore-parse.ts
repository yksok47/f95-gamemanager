import { load, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'
import type { Cheerio } from 'cheerio'
import type { IgnoredThread } from '@shared/types'
import { F95Error } from './errors'
import { extractThreadId, parseGameTitle, PREFIX_NODE_SELECTOR, threadUrl } from './parse'

const HOST = 'https://f95zone.to'
const TOKEN_RE = /name="_xfToken"\s+value="([^"]+)"/
const IGNORE_PATH_RE = /\/tic-ignore\/(un)?ignore(?:\/|$)/i

export type ThreadIgnoreAction = {
  ignored: boolean
  href: string
}

export type XfConfirmForm = {
  action: string
  method: 'get' | 'post'
  fields: URLSearchParams
}

function titleFrom(node: Cheerio<AnyNode>): string {
  const clone = node.clone()
  clone.find(PREFIX_NODE_SELECTOR).remove()
  return clone.text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

export function uniqueIgnoredThreads(threads: IgnoredThread[]): IgnoredThread[] {
  const seen = new Set<number>()
  const out: IgnoredThread[] = []
  for (const thread of threads) {
    if (seen.has(thread.threadId)) continue
    seen.add(thread.threadId)
    out.push(thread)
  }
  return out
}

export function xfTokenFromHtml(html: string): string | null {
  return html.match(TOKEN_RE)?.[1] ?? null
}

export function absUrl(href: string, base = HOST): string {
  try {
    return new URL(href, base).href
  } catch {
    return href
  }
}

export function isThreadIgnoreHref(href: string, threadId?: number): boolean {
  try {
    const url = new URL(href, HOST)
    if (url.origin !== HOST) return false
    if (!IGNORE_PATH_RE.test(url.pathname)) return false
    if (url.searchParams.get('content_type') !== 'thread') return false
    const contentId = Number(url.searchParams.get('content_id'))
    if (!Number.isFinite(contentId) || contentId <= 0) return false
    if (threadId != null && contentId !== threadId) return false
    return true
  } catch {
    return false
  }
}

function isIgnoredControl(href: string, text: string): boolean {
  return /unignore/i.test(href) || /unignore/i.test(text)
}

export function parseThreadIgnoreActionFromDocument(
  $: CheerioAPI,
  threadId: number
): ThreadIgnoreAction | null {
  const nodes = [
    ...$('.block-outer-opposite a[href*="tic-ignore"]').toArray(),
    ...$(`a.tic--button[href*="content_id=${threadId}"]`).toArray(),
    ...$(`a[href*="tic-ignore"][href*="content_id=${threadId}"]`).toArray()
  ]

  for (const el of nodes) {
    const node = $(el)
    const href = node.attr('href')?.trim()
    if (!href || !isThreadIgnoreHref(href, threadId)) continue
    const text = node.text().replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
    return { ignored: isIgnoredControl(href, text), href }
  }
  return null
}

export function parseThreadIgnoreAction(html: string, threadId: number): ThreadIgnoreAction | null {
  return parseThreadIgnoreActionFromDocument(load(asHtml(html)), threadId)
}

function overlayHtmlFromJson(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  const json = value as { html?: unknown; errors?: unknown }
  if (Array.isArray(json.errors) && json.errors.length) {
    const message = json.errors
      .map((item) => (typeof item === 'string' ? item : ''))
      .filter(Boolean)
      .join(' ')
    throw new F95Error(message || 'F95zone rejected the ignore request.', 'parse')
  }
  if (typeof json.html === 'string') return json.html
  if (json.html && typeof json.html === 'object' && 'content' in json.html) {
    const content = (json.html as { content?: unknown }).content
    if (typeof content === 'string') return content
  }
  return null
}

export function asHtml(body: string): string {
  const trimmed = body.trim()
  if (!trimmed.startsWith('{')) return body
  try {
    const html = overlayHtmlFromJson(JSON.parse(trimmed))
    return html ?? body
  } catch (error) {
    if (error instanceof F95Error) throw error
    return body
  }
}

export function looksLikeThreadPage($: CheerioAPI): boolean {
  return Boolean($('.message-threadStarterPost, article.message--post, .p-title-value').length)
}

function isSearchOrLogoutForm(action: string): boolean {
  return /\/search(?:\/|$)/i.test(action) || /\/logout(?:\/|$)/i.test(action)
}

function inputValue(node: Cheerio<AnyNode>): string {
  const raw = node.attr('value')
  if (raw != null) return raw
  const val = node.val()
  if (Array.isArray(val)) return val[0] ?? ''
  return typeof val === 'string' ? val : ''
}

export function parseConfirmationForm(html: string, pageUrl: string): XfConfirmForm | null {
  const $ = load(asHtml(html))
  const forms = $('form').toArray().map((el) => $(el))
  const form =
    forms.find((item) => /tic-ignore/i.test(item.attr('action') || '')) ??
    forms.find(
      (item) =>
        item.find('input[name="content_id"], input[name="_xfConfirm"]').length > 0 &&
        !isSearchOrLogoutForm(item.attr('action') || '')
    ) ??
    $('.p-body-pageContent form, .overlay-container form, .overlay form, form.block')
      .toArray()
      .map((el) => $(el))
      .find((item) => !isSearchOrLogoutForm(item.attr('action') || ''))

  if (!form?.length) return null

  const action = absUrl(form.attr('action') || pageUrl, pageUrl)
  if (isSearchOrLogoutForm(action)) return null
  const method = (form.attr('method') || 'post').trim().toLowerCase() === 'get' ? 'get' : 'post'
  const fields = new URLSearchParams()

  form.find('input, select, textarea').each((_, el) => {
    const node = $(el)
    const name = node.attr('name')
    if (!name) return
    const type = (node.attr('type') || '').toLowerCase()
    if (type === 'button' || type === 'image' || type === 'reset') return
    if (type === 'submit') {
      if (/cancel/i.test(inputValue(node)) || /cancel/i.test(node.text())) return
      if (!fields.has(name)) fields.append(name, inputValue(node))
      return
    }
    if ((type === 'checkbox' || type === 'radio') && !node.is('[checked]')) return
    fields.append(name, inputValue(node))
  })

  form.find('button[type="submit"], button:not([type])').each((_, el) => {
    const node = $(el)
    const name = node.attr('name')
    if (!name || fields.has(name)) return
    if (/cancel/i.test(node.text()) || /cancel/i.test(inputValue(node))) return
    fields.append(name, inputValue(node) || '1')
  })

  const token = fields.get('_xfToken') || xfTokenFromHtml(html)
  if (token && !fields.get('_xfToken')) fields.set('_xfToken', token)
  if (!fields.has('_xfConfirm')) fields.set('_xfConfirm', '1')

  return { action, method, fields }
}

export function xfErrorMessage(html: string): string | null {
  const $ = load(asHtml(html))
  const node = $('.blockMessage--error, .overlay-title + .blockMessage').first()
  const text = node.text().replace(/\s+/g, ' ').trim()
  return text || null
}

function unignoreHrefFromRow($: CheerioAPI, row: Cheerio<AnyNode>, threadId: number): string | null {
  const links = row.find('a[href*="tic-ignore"]').toArray()
  for (const el of links) {
    const node = $(el)
    const href = node.attr('href')?.trim()
    if (!href || !isThreadIgnoreHref(href, threadId)) continue
    const text = node.text().replace(/\s+/g, ' ').trim()
    if (isIgnoredControl(href, text) || /unignore/i.test(href)) return href
  }
  return null
}

function pushIgnored(
  threads: IgnoredThread[],
  threadId: number,
  title: string,
  unignoreHref: string | null
): void {
  const parsed = parseGameTitle(title)
  threads.push({
    threadId,
    title: parsed.title || title || `Thread ${threadId}`,
    threadUrl: threadUrl(threadId),
    unignoreHref
  })
}

export function scrapeIgnoredThreads(html: string): IgnoredThread[] {
  const $ = load(asHtml(html))
  const threads: IgnoredThread[] = []

  $('.p-body-pageContent .contentRow').each((_, el) => {
    const row = $(el)
    const link = row
      .find('.contentRow-title a[href*="/threads/"], a[href*="/threads/"]')
      .filter((_, node) => Boolean(extractThreadId($(node).attr('href'))))
      .first()
    const threadId = extractThreadId(link.attr('href'))
    const title = titleFrom(link)
    if (!threadId || !title) return
    pushIgnored(threads, threadId, title, unignoreHrefFromRow($, row, threadId))
  })

  if (threads.length) return uniqueIgnoredThreads(threads)

  $('.p-body-pageContent .structItem-title').each((_, el) => {
    const node = $(el)
    const row = node.closest('.structItem')
    const link = node
      .find('a[href*="/threads/"]')
      .filter((_, item) => Boolean(extractThreadId($(item).attr('href'))))
      .last()
    const href = node.attr('uix-data-href') || link.attr('href')
    const title = titleFrom(link.length ? link : node)
    const threadId = extractThreadId(href)
    if (!threadId || !title) return
    pushIgnored(threads, threadId, title, unignoreHrefFromRow($, row, threadId))
  })

  if (threads.length) return uniqueIgnoredThreads(threads)

  $('.p-body-pageContent .block-row').each((_, el) => {
    const row = $(el)
    const link = row
      .find('a[href*="/threads/"]')
      .filter((_, node) => Boolean(extractThreadId($(node).attr('href'))))
      .first()
    const threadId = extractThreadId(link.attr('href'))
    const title = titleFrom(link)
    if (!threadId || !title) return
    pushIgnored(threads, threadId, title, unignoreHrefFromRow($, row, threadId))
  })

  return uniqueIgnoredThreads(threads)
}

export function nextIgnoredPageHref(html: string, pageUrl: string): string | null {
  const $ = load(asHtml(html))
  const href =
    $('a.pageNav-jump--next, a.pageNavSimple-el--next').first().attr('href') ||
    $('.pageNav-main li.pageNav-page--current + li a').first().attr('href')
  if (!href) return null
  return absUrl(href, pageUrl)
}
