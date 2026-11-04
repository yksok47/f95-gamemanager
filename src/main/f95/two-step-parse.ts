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
    providers.push({ id, label: cleanText(node.text()) || id, href: absUrl(href, pageUrl) })
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
