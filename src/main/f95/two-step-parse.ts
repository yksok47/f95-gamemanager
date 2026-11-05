import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { AnyNode } from 'domhandler'

export type TwoStepProviderLink = {
  id: string
  label: string
  href: string
}

export type TwoStepForm = {
  action: string
  fields: [string, string][]
  provider: string
  prompt: string | null
  canTrust: boolean
  providers: TwoStepProviderLink[]
}

const TWO_STEP_PATH_RE = /\/login\/two-step/i

function absUrl(href: string, pageUrl: string): string {
  try {
    return new URL(href, pageUrl).href
  } catch {
    return href
  }
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function providerFromHref(href: string, pageUrl: string): string | null {
  try {
    return new URL(href, pageUrl).searchParams.get('provider')
  } catch {
    return null
  }
}

function readPrompt($: CheerioAPI, form: Cheerio<AnyNode>): string | null {
  const codeRow = form.find('input[name="code"]').first().closest('.formRow')
  const parts = [
    ...form
      .find('.formInfoRow')
      .toArray()
      .map((el) => cleanText($(el).text())),
    cleanText(codeRow.find('.formRow-explain').first().text())
  ].filter(Boolean)
  return parts.length ? parts.join(' ') : null
}

export function parseTwoStepForm(html: string, pageUrl: string): TwoStepForm | null {
  const $ = load(html)
  const form = $('form')
    .toArray()
    .map((el) => $(el))
    .find(
      (item) =>
        TWO_STEP_PATH_RE.test(item.attr('action') || '') &&
        item.find('input[name="code"]').length > 0
    )
  if (!form) return null

  const fields: [string, string][] = []
  form.find('input[type="hidden"]').each((_, el) => {
    const node = $(el)
    const name = node.attr('name')
    if (!name) return
    fields.push([name, node.attr('value') ?? ''])
  })

  const provider = fields.find(([name]) => name === 'provider')?.[1] || ''
  const seen = new Set<string>(provider ? [provider] : [])
  const providers: TwoStepProviderLink[] = []
  $('a[href]').each((_, el) => {
    const node = $(el)
    const href = node.attr('href') || ''
    if (!TWO_STEP_PATH_RE.test(href)) return
    const id = providerFromHref(href, pageUrl)
    if (!id || seen.has(id)) return
    seen.add(id)
    const label = cleanText(node.text()).replace(/^use\s+/i, '')
    providers.push({ id, label: label || id, href: absUrl(href, pageUrl) })
  })

  return {
    action: absUrl(form.attr('action') || pageUrl, pageUrl),
    fields,
    provider,
    prompt: readPrompt($, form),
    canTrust: form.find('input[name="trust"]').length > 0,
    providers
  }
}

export function parseTwoStepError(html: string): string | null {
  const $ = load(html)
  const candidates = [
    '.blockMessage--error',
    '.p-body-pageContent .blockMessage',
    '.overlay .blockMessage',
    '.blockMessage'
  ]
  $('.js-browserWarning, .u-noJsOnly, noscript').remove()
  for (const selector of candidates) {
    const node = $(selector).first()
    if (!node.length) continue
    const listItems = node
      .find('li')
      .toArray()
      .map((el) => cleanText($(el).text()))
      .filter(Boolean)
    const text = listItems.length ? listItems.join(' ') : cleanText(node.text())
    if (text) return text
  }
  return null
}

const LOGIN_WALL_RE = /Sorry, you have to be <a href="\/login">logged in<\/a> to access this page/
const SIGNED_OUT_RE = /<html[^>]*\sdata-logged-in="false"/i

export function isTwoStepUrl(url: string): boolean {
  try {
    return TWO_STEP_PATH_RE.test(new URL(url).pathname)
  } catch {
    return TWO_STEP_PATH_RE.test(url)
  }
}

export function isLoginWall(body: string): boolean {
  return LOGIN_WALL_RE.test(body)
}

export function looksSignedOut(url: string, body: string): boolean {
  return isTwoStepUrl(url) || isLoginWall(body) || SIGNED_OUT_RE.test(body)
}

export function signedInAfterAuthStep(body: string, url: string): boolean {
  return !parseTwoStepForm(body, url) && !looksSignedOut(url, body)
}

const SIGNED_IN_RE = /<html[^>]*\sdata-logged-in="true"/i

export function looksSignedIn(body: string): boolean {
  return SIGNED_IN_RE.test(body)
}

/** Display name from the signed-in account button in the page header. */
export function signedInUsername(html: string): string | null {
  if (!looksSignedIn(html)) return null
  const $ = load(html)
  const account = $('.p-navgroup-link--user').first()
  const name =
    cleanText(account.find('.p-navgroup-linkText').first().text()) ||
    cleanText(account.attr('title') || '') ||
    cleanText(account.find('img[alt]').first().attr('alt') || '')
  return name || null
}
