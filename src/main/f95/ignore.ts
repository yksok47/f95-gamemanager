import { load } from 'cheerio'
import type { IgnoredThread } from '@shared/types'
import { F95Error, f95Fetch, f95Url } from './http'
import { sleep, threadUrl } from './parse'
import {
  absUrl,
  asHtml,
  isThreadIgnoreHref,
  looksLikeThreadPage,
  nextIgnoredPageHref,
  parseConfirmationForm,
  parseThreadIgnoreAction,
  parseThreadIgnoreActionFromDocument,
  scrapeIgnoredThreads,
  uniqueIgnoredThreads,
  xfErrorMessage,
  xfTokenFromHtml,
  type ThreadIgnoreAction,
  type XfConfirmForm
} from './ignore-parse'

const HOST = 'https://f95zone.to'
const PAGE_DELAY_MS = 1200
const MAX_PAGES = 80

export {
  isThreadIgnoreHref,
  nextIgnoredPageHref,
  parseConfirmationForm,
  parseThreadIgnoreAction,
  parseThreadIgnoreActionFromDocument,
  scrapeIgnoredThreads
}

function pageUrlOf(response: Response, fallback: string): string {
  const url = typeof response.url === 'string' ? response.url.trim() : ''
  return url || fallback
}

async function postForm(form: XfConfirmForm, referer: string): Promise<string> {
  const url =
    form.method === 'get'
      ? `${form.action}${form.action.includes('?') ? '&' : '?'}${form.fields.toString()}`
      : form.action
  const { body } = await f95Fetch(url, {
    method: form.method.toUpperCase(),
    headers: {
      ...(form.method === 'post'
        ? { 'Content-Type': 'application/x-www-form-urlencoded' }
        : {}),
      Origin: HOST,
      Referer: referer,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    body: form.method === 'get' ? undefined : form.fields.toString()
  })
  const error = xfErrorMessage(body)
  if (error) throw new F95Error(error, 'parse')
  return body
}

async function followIgnoreLink(
  href: string,
  threadId: number,
  wantIgnored: boolean
): Promise<void> {
  if (!isThreadIgnoreHref(href, threadId)) {
    throw new F95Error('That ignore link does not match this thread.', 'parse')
  }

  const requestUrl = absUrl(href)
  const { body, response } = await f95Fetch(requestUrl, {
    headers: {
      Origin: HOST,
      Referer: threadUrl(threadId)
    }
  })
  const pageUrl = pageUrlOf(response, requestUrl)
  const html = asHtml(body)
  const form = parseConfirmationForm(html, pageUrl)
  if (form) {
    await postForm(form, pageUrl)
    return
  }

  const $ = load(html)
  if (looksLikeThreadPage($)) {
    const state = parseThreadIgnoreActionFromDocument($, threadId)
    if (state?.ignored === wantIgnored) return
  }

  const token = xfTokenFromHtml(html)
  if (!token) {
    throw new F95Error(
      'Could not read the F95zone ignore confirmation. The site layout may have changed.',
      'parse'
    )
  }

  const fallbackUrl = new URL(requestUrl)
  const fields = new URLSearchParams(fallbackUrl.searchParams)
  fields.set('_xfToken', token)
  fields.set('_xfConfirm', '1')
  if (!fields.get('content_type')) fields.set('content_type', 'thread')
  if (!fields.get('content_id')) fields.set('content_id', String(threadId))
  await postForm(
    { action: `${fallbackUrl.origin}${fallbackUrl.pathname}`, method: 'post', fields },
    pageUrl
  )
}

async function threadIgnoreAction(threadId: number): Promise<ThreadIgnoreAction> {
  const { body } = await f95Fetch(`/threads/${threadId}/`, {}, { timeoutMs: 45000 })
  const action = parseThreadIgnoreAction(body, threadId)
  if (!action) {
    throw new F95Error('Could not find the ignore control on this thread.', 'parse')
  }
  return action
}

export async function setThreadIgnored(
  threadId: number,
  ignored: boolean,
  href?: string | null
): Promise<boolean> {
  if (!Number.isFinite(threadId) || threadId <= 0) {
    throw new F95Error('Invalid thread id.', 'parse')
  }

  if (href) {
    if (!isThreadIgnoreHref(href, threadId)) {
      throw new F95Error('That ignore link does not match this thread.', 'parse')
    }
    await followIgnoreLink(href, threadId, ignored)
    return ignored
  }

  const action = await threadIgnoreAction(threadId)
  if (action.ignored === ignored) return ignored
  await followIgnoreLink(action.href, threadId, ignored)
  return ignored
}

export async function listIgnoredThreads(): Promise<IgnoredThread[]> {
  const all: IgnoredThread[] = []
  let path = '/account/ignored?key=thread'
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { body, response } = await f95Fetch(path)
    const pageUrl = pageUrlOf(response, f95Url(path))
    const threads = scrapeIgnoredThreads(body)
    all.push(...threads)
    const next = nextIgnoredPageHref(body, pageUrl)
    if (!next || !threads.length) break
    path = next
    await sleep(PAGE_DELAY_MS)
  }
  return uniqueIgnoredThreads(all)
}
