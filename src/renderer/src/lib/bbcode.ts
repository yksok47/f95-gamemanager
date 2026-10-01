import type { ThreadAttachment } from '@shared/types'

export type BbCodeSelection = { value: string; start: number; end: number }

export function newAttachmentHash(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

const FONT_SIZE_STEPS = ['9px', '10px', '12px', '15px', '18px', '22px', '26px']

export function applyBbCode(
  value: string,
  start: number,
  end: number,
  open: string,
  close: string,
  placeholder = ''
): BbCodeSelection {
  const selected = value.slice(start, end)
  const inner = selected || placeholder
  const next = `${value.slice(0, start)}${open}${inner}${close}${value.slice(end)}`
  const innerStart = start + open.length
  return { value: next, start: innerStart, end: innerStart + inner.length }
}

export function applyListBbCode(
  value: string,
  start: number,
  end: number,
  ordered: boolean
): BbCodeSelection {
  const selected = value.slice(start, end)
  const open = ordered ? '[LIST=1]\n' : '[LIST]\n'
  const close = '\n[/LIST]'
  const items = selected.trim()
    ? selected
        .split(/\r\n|\n|\r/)
        .map((line) => `[*] ${line.replace(/^\s*\[\*\]\s*/, '')}`)
        .join('\n')
    : '[*] '
  const next = `${value.slice(0, start)}${open}${items}${close}${value.slice(end)}`
  if (!selected.trim()) {
    const caret = start + open.length + 4
    return { value: next, start: caret, end: caret }
  }
  return { value: next, start: start + open.length, end: start + open.length + items.length }
}

export function bbcodeToHtml(raw: string, attachments: readonly ThreadAttachment[] = []): string {
  let html = escapeHtml(raw)
  const codeBlocks: string[] = []
  html = replacePair(html, 'CODE', (body) => {
    const index = codeBlocks.length
    codeBlocks.push(`<pre class="bbcode-preview-code">${body}</pre>`)
    return `\u0000CODE${index}\u0000`
  })
  html = replacePair(html, 'SPOILER', (body, arg) => {
    const label = arg || 'Spoiler'
    return `<details class="bbcode-preview-spoiler"><summary>${label}</summary>${body}</details>`
  })
  html = replacePair(html, 'QUOTE', (body, arg) => renderQuote(body, arg))
  html = replacePair(html, 'B', (body) => `<strong>${body}</strong>`)
  html = replacePair(html, 'I', (body) => `<em>${body}</em>`)
  html = replacePair(html, 'U', (body) => `<u>${body}</u>`)
  html = replacePair(html, 'S', (body) => `<s>${body}</s>`)
  html = replacePair(html, 'ISPOILER', (body) => `<span class="bbcode-preview-ispoiler">${body}</span>`)
  html = replacePair(html, 'ICODE', (body) => `<code class="bbcode-preview-icode">${body}</code>`)
  html = replacePair(html, 'COLOR', (body, arg) => {
    const color = sanitizeColor(arg)
    return color ? `<span style="color:${color}">${body}</span>` : body
  })
  html = replacePair(html, 'SIZE', (body, arg) => {
    const size = sanitizeSize(arg)
    return size ? `<span style="font-size:${size}">${body}</span>` : body
  })
  html = html.replace(/\[URL=(https?:\/\/[^\]]+)\]([\s\S]*?)\[\/URL\]/gi, (_match, href, label) => {
    return `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`
  })
  html = html.replace(/\[URL\](https?:\/\/[^\[]+)\[\/URL\]/gi, (_match, href) => {
    return `<a href="${href}" target="_blank" rel="noreferrer">${href}</a>`
  })
  html = html.replace(/\[IMG\](https?:\/\/[^\[]+)\[\/IMG\]/gi, (_match, src) => {
    return `<img src="${src}" alt="" referrerpolicy="no-referrer">`
  })
  html = html.replace(
    /\[ATTACH(?:(?:=|\s+type=)(?:&quot;|["'])?(full|thumb)(?:&quot;|["'])?)?\](\d+)\[\/ATTACH\]/gi,
    (_match, type: string | undefined, idText: string) => {
      const id = Number(idText)
      const meta = attachments.find((item) => item.id === id)
      const href = escapeAttr(meta?.url || `https://f95zone.to/attachments/${id}/`)
      const full = (type || '').toLowerCase() === 'full' || Boolean(meta?.isImage)
      if (full) {
        const kind = (type || 'full').toLowerCase() === 'thumb' ? 'thumb' : 'full'
        return `<img src="${href}" alt="${escapeAttr(meta?.filename || '')}" data-attachment="${kind}:${id}" referrerpolicy="no-referrer">`
      }
      return `<a class="bbcode-preview-attach" href="${href}" data-attachment="${id}">${escapeHtml(meta?.filename || `Attachment ${id}`)}</a>`
    }
  )
  html = html.replace(/\[LIST(?:=([^\]]+))?\]([\s\S]*?)\[\/LIST\]/gi, (_match, arg: string | undefined, body: string) => {
    const ordered = Boolean(arg && arg !== '0' && !/^disc$/i.test(arg))
    const items = body
      .split(/\[\*\]/)
      .slice(1)
      .map((item) => item.replace(/^(?:<br>|\s)+|(?:<br>|\s)+$/g, ''))
      .map((item) => `<li>${item}</li>`)
      .join('')
    return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`
  })
  html = html.replace(/\u0000CODE(\d+)\u0000/g, (_match, index) => codeBlocks[Number(index)] || '')
  return html.replace(/\r\n|\n|\r/g, '<br>')
}

export function htmlToBbcode(html: string): string {
  const trimmed = html.replace(/&nbsp;/g, ' ').trim()
  if (!trimmed || /^<(?:div|p)><br><\/(?:div|p)>$/i.test(trimmed) || trimmed === '<br>') return ''
  if (typeof DOMParser === 'undefined') return stripTags(html)
  const doc = new DOMParser().parseFromString(trimmed, 'text/html')
  const root = doc.body
  if (!root) return stripTags(html)
  return collapseBlankLines(serializeNode(root).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim())
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return ''
  const el = node as HTMLElement
  const tag = el.tagName.toLowerCase()
  if (tag === 'br') return '\n'
  if (tag === 'pre' || classListContains(el, 'bbcode-preview-code')) {
    return `[CODE]${el.textContent ?? ''}[/CODE]`
  }

  if (
    classListContains(el, 'bbCodeBlock-title') ||
    classListContains(el, 'bbCodeBlock-expandLink') ||
    classListContains(el, 'bbCodeBlock-expandToggle')
  ) {
    return ''
  }

  const inner = serializeChildren(el)

  if (tag === 'strong' || tag === 'b') return `[B]${inner}[/B]`
  if (tag === 'em' || tag === 'i') return `[I]${inner}[/I]`
  if (tag === 'u') return `[U]${inner}[/U]`
  if (tag === 's' || tag === 'strike' || tag === 'del') return `[S]${inner}[/S]`
  if (classListContains(el, 'bbcode-preview-ispoiler')) return `[ISPOILER]${inner}[/ISPOILER]`
  if (tag === 'code') return `[ICODE]${inner}[/ICODE]`
  if (tag === 'blockquote' || classListContains(el, 'bbCodeBlock--quote')) {
    const arg = quoteArgFromElement(el)
    return arg ? `[QUOTE=${arg}]${inner}[/QUOTE]` : `[QUOTE]${inner}[/QUOTE]`
  }
  if (tag === 'details' || classListContains(el, 'bbcode-preview-spoiler')) {
    const label = queryText(el, 'summary') || 'Spoiler'
    const content = Array.from(el.childNodes)
      .filter((child) => child.nodeType !== Node.ELEMENT_NODE || (child as HTMLElement).tagName.toLowerCase() !== 'summary')
      .map(serializeNode)
      .join('')
    return label === 'Spoiler' ? `[SPOILER]${content}[/SPOILER]` : `[SPOILER=${label}]${content}[/SPOILER]`
  }
  if (tag === 'a') {
    const attach = el.getAttribute('data-attachment') || ''
    if (/^\d+$/.test(attach)) return `[ATTACH]${attach}[/ATTACH]`
    const href = el.getAttribute('href') || ''
    if (!href) return inner
    if (inner && inner !== href) return `[URL=${href}]${inner}[/URL]`
    return `[URL]${href}[/URL]`
  }
  if (tag === 'img') {
    const attach = el.getAttribute('data-attachment') || ''
    const attachMatch = attach.match(/^(full|thumb):(\d+)$/i)
    if (attachMatch) {
      return attachMatch[1].toLowerCase() === 'full'
        ? `[ATTACH=full]${attachMatch[2]}[/ATTACH]`
        : `[ATTACH]${attachMatch[2]}[/ATTACH]`
    }
    const src = el.getAttribute('src') || ''
    return src ? `[IMG]${src}[/IMG]` : ''
  }
  if (tag === 'ul') return `[LIST]\n${listItems(el)}[/LIST]`
  if (tag === 'ol') return `[LIST=1]\n${listItems(el)}[/LIST]`
  if (tag === 'li') return `[*] ${inner.trim()}\n`

  let wrapped = inner
  const color = sanitizeColor(el.style.color || el.getAttribute('color') || '')
  const size = sanitizeSize(el.style.fontSize || fontSizeFromAttr(el.getAttribute('size')))
  if (color) wrapped = `[COLOR=${toHexColor(el.style.color || el.getAttribute('color') || color)}]${wrapped}[/COLOR]`
  if (size) wrapped = `[SIZE=${size}]${wrapped}[/SIZE]`

  if (tag === 'div' || tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3') {
    return wrapped.replace(/\n$/, '') + '\n'
  }
  return wrapped
}

function serializeChildren(el: HTMLElement): string {
  return Array.from(el.childNodes).map(serializeNode).join('')
}

function classListContains(el: HTMLElement, name: string): boolean {
  return Boolean(el.classList?.contains(name) || (el.getAttribute('class') || '').split(/\s+/).includes(name))
}

function queryText(el: HTMLElement, selector: string): string {
  const node = el.querySelector?.(selector)
  return node?.textContent?.trim() || ''
}

function listItems(el: HTMLElement): string {
  return Array.from(el.children)
    .filter((child) => child.tagName.toLowerCase() === 'li')
    .map((child) => `[*] ${serializeChildren(child as HTMLElement).trim()}\n`)
    .join('')
}

function fontSizeFromAttr(value: string | null): string {
  const n = Number(value)
  if (n >= 1 && n <= 7) return FONT_SIZE_STEPS[n - 1] ?? ''
  return ''
}

function sanitizeColor(raw: string): string {
  const value = raw.trim()
  if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value)) return value
  if (/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}/i.test(value)) return value
  if (/^[a-z]{1,20}$/i.test(value)) return value
  return ''
}

function toHexColor(raw: string): string {
  const rgb = raw.trim().match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i)
  if (!rgb) return raw.trim()
  return `#${[rgb[1], rgb[2], rgb[3]]
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('')}`
}

function sanitizeSize(raw: string): string {
  const value = raw.trim()
  if (/^\d{1,3}(?:\.\d+)?px$/i.test(value)) return `${Math.round(Number.parseFloat(value))}px`
  const n = Number(value)
  if (n >= 1 && n <= 7) return FONT_SIZE_STEPS[n - 1] ?? ''
  if (n >= 8 && n <= 72) return `${Math.round(n)}px`
  return ''
}

function renderQuote(body: string, escapedArg: string): string {
  const meta = parseQuoteArg(escapedArg)
  const arg = formatQuoteTagArg(meta)
  const attrs = [
    'class="bbCodeBlock bbCodeBlock--quote"',
    meta.name ? `data-author="${escapeAttr(meta.name)}"` : '',
    meta.postId ? `data-post-id="${meta.postId}"` : '',
    meta.memberId ? `data-member-id="${meta.memberId}"` : '',
    arg ? `data-quote="${escapeAttr(arg)}"` : ''
  ]
    .filter(Boolean)
    .join(' ')
  let title = ''
  if (meta.name || meta.postId) {
    const said = `${escapeHtml(meta.name || 'Quote')} said:`
    const label = meta.postId
      ? `<a href="https://f95zone.to/posts/${meta.postId}/" class="bbCodeBlock-sourceJump" data-post-id="${meta.postId}" title="Go to quoted post">${said}</a>`
      : said
    title = `<div class="bbCodeBlock-title" contenteditable="false">${label}</div>`
  }
  return `<blockquote ${attrs}>${title}${body.replace(/^\s+|\s+$/g, '')}</blockquote>`
}

type QuoteMeta = { name: string; postId: number; memberId: number }

function parseQuoteArg(escapedArg: string): QuoteMeta {
  const raw = unescapeHtml(escapedArg)
    .trim()
    .replace(/^"+|"+$/g, '')
    .replace(/^'+|'+$/g, '')
  let name = ''
  let postId = 0
  let memberId = 0
  for (const part of raw.split(',')) {
    const trimmed = part.trim()
    const named = trimmed.match(/^(post|member)\s*:\s*(\d+)$/i)
    if (named) {
      const value = Number(named[2])
      if (/^post$/i.test(named[1])) postId = value
      else memberId = value
      continue
    }
    if (!name && trimmed) name = trimmed
  }
  return { name, postId, memberId }
}

function formatQuoteTagArg(meta: QuoteMeta): string {
  const parts: string[] = []
  if (meta.name) parts.push(meta.name)
  if (meta.postId) parts.push(`post: ${meta.postId}`)
  if (meta.memberId) parts.push(`member: ${meta.memberId}`)
  if (!parts.length) return ''
  const joined = parts.join(', ')
  return /[,\s]/.test(joined) ? `"${joined}"` : joined
}

function quoteArgFromElement(el: HTMLElement): string {
  const stored = el.getAttribute('data-quote')?.trim()
  if (stored) return stored
  return formatQuoteTagArg({
    name: el.getAttribute('data-author')?.trim() || authorFromQuoteTitle(el),
    postId:
      Number(el.getAttribute('data-post-id') || 0) ||
      Number(el.querySelector?.('.bbCodeBlock-sourceJump')?.getAttribute('data-post-id') || 0) ||
      postIdFromHref(el.querySelector?.('.bbCodeBlock-sourceJump')?.getAttribute('href') || ''),
    memberId: Number(el.getAttribute('data-member-id') || 0)
  })
}

function authorFromQuoteTitle(el: HTMLElement): string {
  return queryText(el, '.bbCodeBlock-title')
    .replace(/\s*said:\s*$/i, '')
    .replace(/[↑\u2191]/g, '')
    .trim()
}

function postIdFromHref(href: string): number {
  return (
    Number(
      (href.match(/\/posts\/(\d+)/i) ||
        href.match(/\/post-(\d+)/i) ||
        href.match(/goto\/post\?id=(\d+)/i) ||
        href.match(/#(?:js-)?post-(\d+)/i))?.[1] || 0
    ) || 0
  )
}

function unescapeHtml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function replacePair(html: string, tag: string, render: (body: string, arg: string) => string): string {
  const pattern = new RegExp(`\\[${tag}(?:=([^\\]]+))?\\]([\\s\\S]*?)\\[\\/${tag}\\]`, 'gi')
  let current = html
  for (let i = 0; i < 8; i++) {
    const next = current.replace(pattern, (_match, arg: string | undefined, body: string) =>
      render(body, arg?.trim() || '')
    )
    if (next === current) break
    current = next
  }
  return current
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;')
}

function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

function collapseBlankLines(value: string): string {
  return value.replace(/\n{3,}/g, '\n\n')
}
