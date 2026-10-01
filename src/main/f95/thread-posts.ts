import { load } from 'cheerio'
import {
  lastReadNeedsPageFallback,
  type ThreadAttachment,
  type ThreadAttachmentUpload,
  type ThreadPostEditDraft,
  type ThreadPostLikeResult,
  type ThreadPostSearchPage,
  type ThreadPostsPage
} from '@shared/types'
import { F95Error, f95Fetch, f95PostForm, f95Url } from './http'
import { xfErrorMessage, xfTokenFromHtml } from './ignore-parse'
import { extractPostId, extractThreadId, threadUrl } from './parse'
import { parsePostEditForm, postsPageFromDocument } from './parser/posts/postsParser'
import { parsePostSearch } from './parser/postSearch/postSearchParser'

const HOST = 'https://f95zone.to'
const CACHE_VERSION = 1
const POSTS_TTL_MS = 5 * 60 * 1000

const postsCache = new Map<string, { at: number; value: ThreadPostsPage }>()
const postsInflight = new Map<string, Promise<ThreadPostsPage>>()
const tokenByThread = new Map<number, string>()

export type FetchThreadPostsOptions = {
  page?: number
  postId?: number
  latest?: boolean
}

export async function fetchThreadPosts(
  threadId: number,
  options: FetchThreadPostsOptions = {}
): Promise<ThreadPostsPage> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) {
    throw new F95Error('Invalid thread id.', 'parse')
  }

  const postId = Number(options.postId) || 0
  const latest = Boolean(options.latest)
  const page = Math.max(1, Math.floor(Number(options.page) || 1))
  const fallbackPage = Math.floor(Number(options.page) || 0)

  if (postId > 0) {
    try {
      const byPost = await loadThreadPostsCached(id, { postId })
      if (!lastReadNeedsPageFallback(postId, fallbackPage, byPost)) return byPost
    } catch (error) {
      if (!canFallbackLastRead(error) || fallbackPage < 1) throw error
    }
    return loadThreadPostsCached(id, { page: fallbackPage })
  }

  return loadThreadPostsCached(id, { page, latest })
}

async function loadThreadPostsCached(
  threadId: number,
  options: { page?: number; postId?: number; latest?: boolean }
): Promise<ThreadPostsPage> {
  const postId = Number(options.postId) || 0
  const latest = Boolean(options.latest)
  const page = Math.max(1, Math.floor(Number(options.page) || 1))
  const cacheKey =
    postId > 0
      ? cacheKeyForPost(threadId, postId)
      : latest
        ? cacheKeyForPage(threadId, -1)
        : cacheKeyForPage(threadId, page)
  if (!latest) {
    const cached = postsCache.get(cacheKey)
    if (cached && Date.now() - cached.at < POSTS_TTL_MS) return cached.value
  }

  const inflight = postsInflight.get(cacheKey)
  if (inflight) return inflight

  const promise = loadPostsPage(threadId, page, postId > 0 ? postId : null, latest)
    .then((value) => {
      rememberPage(value)
      return value
    })
    .finally(() => {
      postsInflight.delete(cacheKey)
    })

  postsInflight.set(cacheKey, promise)
  return promise
}

function canFallbackLastRead(error: unknown): boolean {
  return !(error instanceof F95Error) || error.code === 'parse' || error.code === 'network'
}

export function invalidateThreadPostsCache(threadId?: number): void {
  if (threadId == null) {
    postsCache.clear()
    return
  }
  const prefix = `${CACHE_VERSION}:${threadId}:`
  for (const key of postsCache.keys()) {
    if (key.startsWith(prefix)) postsCache.delete(key)
  }
}

export async function likeThreadPost(threadId: number, postId: number): Promise<ThreadPostLikeResult> {
  const id = Number(postId)
  if (!Number.isFinite(id) || id <= 0) {
    throw new F95Error('Invalid post id.', 'parse')
  }
  const referer = threadUrl(threadId)
  const token = await tokenForThread(threadId)
  const data = await xfJson(`/posts/${id}/react?reaction_id=1`, token, referer, {
    reaction_id: '1'
  })
  invalidateThreadPostsCache(threadId)
  const liked = Number(data.reactionId) > 0
  return { postId: id, liked, reactionCount: null }
}

export async function quoteThreadPost(threadId: number, postId: number): Promise<string> {
  const id = Number(postId)
  if (!Number.isFinite(id) || id <= 0) {
    throw new F95Error('Invalid post id.', 'parse')
  }
  const referer = threadUrl(threadId)
  const token = await tokenForThread(threadId)
  let data = await xfJson(`/posts/${id}/quote`, token, referer, {}, 'GET')
  let quote = typeof data.quote === 'string' ? data.quote.trim() : ''
  if (!quote) {
    data = await xfJson(`/posts/${id}/quote`, token, referer, {})
    quote = typeof data.quote === 'string' ? data.quote.trim() : ''
  }
  if (!quote) {
    throw new F95Error('Could not quote that post.', 'parse')
  }
  return quote
}

export async function uploadThreadAttachment(
  threadId: number,
  hash: string,
  file: ThreadAttachmentUpload,
  postId?: number
): Promise<ThreadAttachment> {
  const id = Number(threadId)
  const tokenHash = String(hash || '').trim()
  const name = String(file?.name || 'file').trim() || 'file'
  const existingPostId = Number(postId) || 0
  if (!Number.isFinite(id) || id <= 0) {
    throw new F95Error('Invalid thread id.', 'parse')
  }
  if (!/^[a-f0-9]{32}$/i.test(tokenHash)) {
    throw new F95Error('Invalid attachment hash.', 'parse')
  }
  const bytes = toBytes(file?.data)
  if (!bytes.byteLength) {
    throw new F95Error('That file is empty.', 'parse')
  }

  const referer = threadUrl(id)
  const token = await tokenForThread(id)
  const mime = String(file?.mime || 'application/octet-stream') || 'application/octet-stream'
  const fields: Record<string, string> = {
    _xfToken: token,
    _xfResponseType: 'json',
    _xfWithData: '1',
    type: 'post',
    hash: tokenHash,
    'context[thread_id]': String(id)
  }
  if (existingPostId > 0) fields['context[post_id]'] = String(existingPostId)

  const query = new URLSearchParams({
    type: 'post',
    hash: tokenHash,
    'context[thread_id]': String(id)
  })
  if (existingPostId > 0) query.set('context[post_id]', String(existingPostId))
  const { body, response } = await f95PostForm(
    `/attachments/upload?${query.toString()}`,
    {
      fields,
      file: {
        fieldName: 'upload',
        filename: name,
        mime,
        bytes
      }
    },
    {
      referer,
      timeoutMs: 120000
    }
  )
  if (response.status >= 400) {
    throw new F95Error(xfJsonError(body) || 'F95zone rejected that upload.', 'network')
  }
  const error = xfJsonError(body)
  if (error) throw new F95Error(error, 'parse')
  const attachment = attachmentFromXfJson(parseXfJson(body))
  if (!attachment) {
    throw new F95Error('F95zone did not return an attachment id.', 'parse')
  }
  return attachment
}

export async function replyToThread(
  threadId: number,
  message: string,
  attachmentHash?: string
): Promise<ThreadPostsPage> {
  const id = Number(threadId)
  const text = message.trim()
  if (!Number.isFinite(id) || id <= 0) {
    throw new F95Error('Invalid thread id.', 'parse')
  }
  if (!text) {
    throw new F95Error('Write a message before posting.', 'parse')
  }

  const referer = threadUrl(id)
  const token = await tokenForThread(id)
  const hash = String(attachmentHash || '').trim()
  const fields: Record<string, string> = { message: text }
  if (/^[a-f0-9]{32}$/i.test(hash)) {
    fields.attachment_hash = hash
    fields['attachment_hash_combined[hash]'] = hash
    fields['attachment_hash_combined[type]'] = 'post'
    fields['attachment_hash_combined[context][thread_id]'] = String(id)
    fields['attachment_hash_combined[json]'] = JSON.stringify({
      type: 'post',
      context: { thread_id: id },
      hash
    })
  }
  const data = await xfJson(`/threads/${id}/add-reply`, token, referer, fields)
  invalidateThreadPostsCache(id)

  const postedId =
    extractPostId(typeof data.redirect === 'string' ? data.redirect : '') ||
    extractPostId(typeof data.message === 'string' ? data.message : '')
  if (postedId) {
    return fetchThreadPosts(id, { postId: postedId })
  }
  return fetchThreadPosts(id, { latest: true })
}

export async function fetchThreadPostEdit(
  threadId: number,
  postId: number
): Promise<ThreadPostEditDraft> {
  const id = Number(postId)
  if (!Number.isFinite(id) || id <= 0) {
    throw new F95Error('Invalid post id.', 'parse')
  }
  const referer = threadUrl(threadId)
  const token = await tokenForThread(threadId)
  const data = await xfJson(`/posts/${id}/edit`, token, referer, {}, 'GET')
  let parsed = parsePostEditForm(xfHtmlContent(data))
  if (!parsed) {
    const { body } = await f95Fetch(
      `/posts/${id}/edit`,
      { headers: { Referer: referer } },
      { timeoutMs: 45000 }
    )
    rememberToken(threadId, body)
    const error = xfJsonError(body)
    if (error) throw new F95Error(error, 'parse')
    parsed = parsePostEditForm(xfHtmlContent(parseXfJson(body))) || parsePostEditForm(body)
  }
  if (!parsed) {
    throw new F95Error(
      'Could not load that post for editing. The site layout may have changed.',
      'parse'
    )
  }
  return { postId: id, message: parsed.message, attachmentHash: parsed.attachmentHash }
}

export async function editThreadPost(
  threadId: number,
  postId: number,
  message: string,
  attachmentHash?: string
): Promise<ThreadPostsPage> {
  const tid = Number(threadId)
  const id = Number(postId)
  const text = message.trim()
  if (!Number.isFinite(tid) || tid <= 0) {
    throw new F95Error('Invalid thread id.', 'parse')
  }
  if (!Number.isFinite(id) || id <= 0) {
    throw new F95Error('Invalid post id.', 'parse')
  }
  if (!text) {
    throw new F95Error('Write a message before saving.', 'parse')
  }

  const referer = threadUrl(tid)
  const token = await tokenForThread(tid)
  const hash = String(attachmentHash || '').trim()
  const fields: Record<string, string> = { message: text }
  if (/^[a-f0-9]{32}$/i.test(hash)) {
    fields.attachment_hash = hash
    fields['attachment_hash_combined[hash]'] = hash
    fields['attachment_hash_combined[type]'] = 'post'
    fields['attachment_hash_combined[context][post_id]'] = String(id)
    fields['attachment_hash_combined[json]'] = JSON.stringify({
      type: 'post',
      context: { post_id: id },
      hash
    })
  }
  await xfJson(`/posts/${id}/edit`, token, referer, fields)
  invalidateThreadPostsCache(tid)
  return fetchThreadPosts(tid, { postId: id })
}

export async function deleteThreadPost(
  threadId: number,
  postId: number,
  page?: number
): Promise<ThreadPostsPage> {
  const tid = Number(threadId)
  const id = Number(postId)
  if (!Number.isFinite(tid) || tid <= 0) {
    throw new F95Error('Invalid thread id.', 'parse')
  }
  if (!Number.isFinite(id) || id <= 0) {
    throw new F95Error('Invalid post id.', 'parse')
  }
  const referer = threadUrl(tid)
  const token = await tokenForThread(tid)
  await xfJson(`/posts/${id}/delete`, token, referer, {
    reason: '',
    hard_delete: '0',
    _xfConfirm: '1'
  })
  invalidateThreadPostsCache(tid)
  return fetchThreadPosts(tid, { page: Math.max(1, Math.floor(Number(page) || 1)) })
}

export type SearchThreadPostsOptions = {
  page?: number
  searchId?: number
}

export async function searchThreadPosts(
  threadId: number,
  keywords: string,
  options: SearchThreadPostsOptions = {}
): Promise<ThreadPostSearchPage> {
  const id = Number(threadId)
  const query = String(keywords || '').trim()
  if (!Number.isFinite(id) || id <= 0) {
    throw new F95Error('Invalid thread id.', 'parse')
  }
  if (!query) {
    return {
      threadId: id,
      query: '',
      page: 1,
      totalPages: 1,
      searchId: null,
      results: []
    }
  }

  const page = Math.max(1, Math.floor(Number(options.page) || 1))
  const searchId = Number(options.searchId) || 0
  const html =
    searchId > 0
      ? await loadSavedSearchPage(id, searchId, page)
      : await runThreadSearch(id, query)
  const parsed = parsePostSearch(html, id)
  return {
    ...parsed,
    threadId: id,
    query,
    page: parsed.page || page
  }
}

async function loadSavedSearchPage(threadId: number, searchId: number, page: number): Promise<string> {
  const path = page > 1 ? `/search/${searchId}/page-${page}` : `/search/${searchId}/`
  const { body } = await f95Fetch(
    path,
    {
      headers: { Referer: threadUrl(threadId) }
    },
    { timeoutMs: 45000 }
  )
  rememberToken(threadId, body)
  return body
}

async function runThreadSearch(threadId: number, query: string): Promise<string> {
  const referer = threadUrl(threadId)
  const token = await tokenForThread(threadId)
  const params = new URLSearchParams({
    keywords: query,
    'c[thread]': String(threadId),
    search_type: 'post',
    grouped: '0',
    _xfToken: token,
    _xfResponseType: 'json',
    _xfWithData: '1',
    _xfRequestUri: new URL(referer, HOST).pathname
  })
  const { body, response } = await f95Fetch(
    '/search/search',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        Origin: HOST,
        Referer: referer
      },
      body: params.toString()
    },
    { timeoutMs: 45000 }
  )
  if (response.status >= 400) {
    throw new F95Error(xfJsonError(body) || 'F95zone rejected that search.', 'network')
  }
  rememberToken(threadId, body)
  if (looksLikeSearchHtml(body)) return body

  const error = xfJsonError(body)
  if (error) throw new F95Error(error, 'parse')

  const data = parseXfJson(body)
  const redirect = typeof data.redirect === 'string' ? data.redirect.trim() : ''
  if (redirect) {
    const { body: html } = await f95Fetch(
      redirect,
      { headers: { Referer: referer } },
      { timeoutMs: 45000 }
    )
    rememberToken(threadId, html)
    return html
  }
  const overlay = xfHtmlContent(data)
  if (overlay) return overlay
  throw new F95Error('Could not read search results. The site layout may have changed.', 'parse')
}

function looksLikeSearchHtml(body: string): boolean {
  const trimmed = body.trim()
  return trimmed.startsWith('<') || /class="[^"]*contentRow/.test(trimmed)
}

type XfJson = {
  quote?: string
  reactionId?: number
  redirect?: string
  error?: string
  errors?: string[] | Record<string, string>
  status?: string
  message?: string
  html?: { content?: string; message?: string }
}

function xfHtmlContent(data: XfJson): string {
  if (typeof data.html?.content === 'string' && data.html.content.trim()) return data.html.content
  if (typeof data.html?.message === 'string' && data.html.message.trim()) return data.html.message
  if (typeof data.message === 'string' && /contentRow|block-row/.test(data.message)) return data.message
  return ''
}

async function loadPostsPage(
  threadId: number,
  page: number,
  postId: number | null,
  latest = false
): Promise<ThreadPostsPage> {
  const path = postId
    ? `/posts/${postId}/`
    : latest
      ? `/threads/${threadId}/latest`
      : page > 1
        ? `/threads/${threadId}/page-${page}`
        : `/threads/${threadId}/`
  const { body, response } = await f95Fetch(path, {}, { timeoutMs: 45000 })
  const $ = load(body)
  rememberToken(threadId, body)

  const pageThreadId =
    extractThreadId($('link[rel="canonical"]').attr('href') || '') ||
    extractThreadId($('meta[property="og:url"]').attr('content') || '') ||
    extractThreadId(typeof response.url === 'string' ? response.url : '') ||
    threadId

  if (pageThreadId && pageThreadId !== threadId) {
    throw new F95Error('That post belongs to a different thread.', 'parse')
  }

  const requestedPage = postId ? 1 : page
  const value = postsPageFromDocument($, threadId, requestedPage, postId)
  if (postId && !value.posts.length && page === 1) {
    return postsPageFromDocument($, threadId, 1, null)
  }
  return value
}

function rememberPage(value: ThreadPostsPage): void {
  const at = Date.now()
  postsCache.set(cacheKeyForPage(value.threadId, value.page), { at, value })
  if (value.focusPostId) {
    postsCache.set(cacheKeyForPost(value.threadId, value.focusPostId), { at, value })
  }
}

function cacheKeyForPage(threadId: number, page: number): string {
  return `${CACHE_VERSION}:${threadId}:page:${page}`
}

function cacheKeyForPost(threadId: number, postId: number): string {
  return `${CACHE_VERSION}:${threadId}:post:${postId}`
}

function rememberToken(threadId: number, html: string): void {
  const token = xfTokenFromHtml(html)
  if (token) tokenByThread.set(threadId, token)
}

async function tokenForThread(threadId: number): Promise<string> {
  const cached = tokenByThread.get(threadId)
  if (cached) return cached
  const { body } = await f95Fetch(`/threads/${threadId}/`, {}, { timeoutMs: 45000 })
  rememberToken(threadId, body)
  const token = tokenByThread.get(threadId)
  if (!token) {
    throw new F95Error(
      'Could not read the F95zone reply form. The site layout may have changed.',
      'parse'
    )
  }
  return token
}

async function xfJson(
  path: string,
  token: string,
  referer: string,
  fields: Record<string, string> = {},
  method: 'GET' | 'POST' = 'POST'
): Promise<XfJson> {
  const params = new URLSearchParams({
    ...fields,
    _xfToken: token,
    _xfResponseType: 'json',
    _xfWithData: '1',
    _xfRequestUri: new URL(referer, HOST).pathname
  })
  const url =
    method === 'GET' ? `${path}${path.includes('?') ? '&' : '?'}${params.toString()}` : f95Url(path)
  const { body, response } = await f95Fetch(url, {
    method,
    headers: {
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' } : {}),
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: HOST,
      Referer: referer
    },
    body: method === 'POST' ? params.toString() : undefined
  })
  if (response.status >= 400) {
    throw new F95Error(xfJsonError(body) || 'F95zone rejected that request.', 'network')
  }
  const error = xfJsonError(body)
  if (error) throw new F95Error(error, 'parse')
  return parseXfJson(body)
}

function parseXfJson(body: string): XfJson {
  const trimmed = body.trim()
  if (!trimmed.startsWith('{')) return {}
  try {
    return JSON.parse(trimmed) as XfJson
  } catch {
    return {}
  }
}

export function attachmentFromXfJson(data: unknown): ThreadAttachment | null {
  if (!data || typeof data !== 'object') return null
  const record = data as Record<string, unknown>
  const nested = record.attachment
  if (nested && typeof nested === 'object') {
    return attachmentFromXfJson(nested)
  }
  const id = Number(record.attachment_id ?? record.id)
  if (!Number.isFinite(id) || id <= 0) return null
  const filename = String(record.filename || record.filename_display || `attachment-${id}`)
  const relative =
    (typeof record.thumbnail_url === 'string' && record.thumbnail_url) ||
    (typeof record.direct_url === 'string' && record.direct_url) ||
    (typeof record.link === 'string' && record.link) ||
    `/attachments/${id}/`
  let url = relative
  try {
    url = new URL(relative, HOST).href
  } catch {
    url = `https://f95zone.to/attachments/${id}/`
  }
  const width = Number(record.width) || 0
  const isImage = width > 0 || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(filename) || /\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(url)
  return { id, filename, url, isImage }
}

function toBytes(data: ArrayBuffer | Uint8Array | undefined): Uint8Array {
  if (data instanceof Uint8Array) return data.byteLength ? new Uint8Array(data) : new Uint8Array()
  if (data instanceof ArrayBuffer && data.byteLength > 0) return new Uint8Array(data)
  return new Uint8Array()
}

function xfJsonError(body: string): string | null {
  const htmlError = xfErrorMessage(body)
  if (htmlError) return htmlError
  const data = parseXfJson(body)
  if (typeof data.error === 'string' && data.error.trim()) return data.error.trim()
  if (Array.isArray(data.errors)) {
    const first = data.errors.find((item) => typeof item === 'string' && item.trim())
    if (first) return first.trim()
  }
  if (data.errors && typeof data.errors === 'object' && !Array.isArray(data.errors)) {
    const first = Object.values(data.errors).find((item) => typeof item === 'string' && item.trim())
    if (first) return first.trim()
  }
  return null
}
