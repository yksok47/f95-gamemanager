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

export function stripBbCode(value: string): string {
  let text = value
  text = text.replace(/\[ATTACH(?:=[^\]]*)?\]\d+\[\/ATTACH\]/gi, '')
  for (let i = 0; i < 12; i++) {
    const next = text.replace(/\[([A-Z]+)(?:=[^\]]*)?\]([\s\S]*?)\[\/\1\]/gi, '$2')
    if (next === text) break
    text = next
  }
  text = text.replace(/\[\*\]\s?/g, '')
  text = text.replace(/\[\/?[A-Z]+(?:=[^\]]*)?\]/gi, '')
  return text.replace(/\n{3,}/g, '\n\n')
}

export function applyStripBbCode(value: string, start: number, end: number): BbCodeSelection {
  if (start === end) return exitBbCodeAtCaret(value, start)
  let from = Math.min(start, end)
  let to = Math.max(start, end)
  let current = value
  for (let i = 0; i < 12; i++) {
    const wrap = innermostOverlappingWrap(current, from, to)
    if (!wrap) break
    const next = rewriteWrapAroundSelection(current, wrap, from, to)
    if (next.value === current && next.start === from && next.end === to) break
    current = next.value
    from = next.start
    to = next.end
  }
  return { value: current, start: from, end: to }
}

export function exitBbCodeAtCaret(value: string, caret: number): BbCodeSelection {
  const wrap = findInnermostBbCodeWrap(value, caret)
  if (!wrap) return { value, start: caret, end: caret }
  const after = value.slice(caret, wrap.closeStart)
  if (!after) return { value, start: wrap.closeEnd, end: wrap.closeEnd }
  const prefix = value.slice(0, wrap.openStart)
  const open = value.slice(wrap.openStart, wrap.openEnd)
  const before = value.slice(wrap.openEnd, caret)
  const close = value.slice(wrap.closeStart, wrap.closeEnd)
  const suffix = value.slice(wrap.closeEnd)
  if (!before) {
    const next = `${prefix}${after}${suffix}`
    return { value: next, start: prefix.length, end: prefix.length }
  }
  const next = `${prefix}${open}${before}${close}${after}${suffix}`
  const nextCaret = prefix.length + open.length + before.length + close.length
  return { value: next, start: nextCaret, end: nextCaret }
}

export function moveCaretOutOfBbCodeTag(
  value: string,
  caret: number,
  direction: 'left' | 'right'
): number | null {
  const wrap = findInnermostBbCodeWrap(value, caret)
  if (!wrap) return null
  if (direction === 'right' && caret >= wrap.closeStart) return wrap.closeEnd
  if (direction === 'left' && caret <= wrap.openEnd) return wrap.openStart
  return null
}

type BbCodeWrap = { tag: string; openStart: number; openEnd: number; closeStart: number; closeEnd: number }

function innermostOverlappingWrap(value: string, from: number, to: number): BbCodeWrap | null {
  const wraps = findAllBbCodeWraps(value).filter((wrap) => from < wrap.closeEnd && to > wrap.openStart)
  wraps.sort((a, b) => a.closeEnd - a.openStart - (b.closeEnd - b.openStart))
  return wraps[0] ?? null
}

function rewriteWrapAroundSelection(value: string, wrap: BbCodeWrap, from: number, to: number): BbCodeSelection {
  const openTag = value.slice(wrap.openStart, wrap.openEnd)
  const closeTag = value.slice(wrap.closeStart, wrap.closeEnd)
  const hitsOpen = from < wrap.openEnd && to > wrap.openStart
  const hitsClose = from < wrap.closeEnd && to > wrap.closeStart
  const inner = value.slice(wrap.openEnd, wrap.closeStart)
  const prefix = value.slice(0, wrap.openStart)
  const suffix = value.slice(wrap.closeEnd)

  if (hitsOpen && hitsClose) {
    const next = `${prefix}${inner}${suffix}`
    return { value: next, start: mapIndexAfterRemovingTags(from, wrap), end: mapIndexAfterRemovingTags(to, wrap) }
  }

  if (hitsOpen) {
    const split = Math.max(0, Math.min(to, wrap.closeStart) - wrap.openEnd)
    const leftInner = inner.slice(0, split)
    const rightInner = inner.slice(split)
    const next = `${prefix}${leftInner}${rightInner ? `${openTag}${rightInner}${closeTag}` : ''}${suffix}`
    return { value: next, start: prefix.length, end: prefix.length + leftInner.length }
  }

  if (hitsClose) {
    const split = Math.max(0, Math.min(from, wrap.closeStart) - wrap.openEnd)
    const leftInner = inner.slice(0, split)
    const rightInner = inner.slice(split)
    const next = `${prefix}${leftInner ? `${openTag}${leftInner}${closeTag}` : ''}${rightInner}${suffix}`
    const start = prefix.length + (leftInner ? openTag.length + leftInner.length + closeTag.length : 0)
    return { value: next, start, end: start + rightInner.length }
  }

  const a = from - wrap.openEnd
  const b = to - wrap.openEnd
  const leftInner = inner.slice(0, a)
  const mid = inner.slice(a, b)
  const rightInner = inner.slice(b)
  const next = `${prefix}${leftInner ? `${openTag}${leftInner}${closeTag}` : ''}${mid}${
    rightInner ? `${openTag}${rightInner}${closeTag}` : ''
  }${suffix}`
  const start = prefix.length + (leftInner ? openTag.length + leftInner.length + closeTag.length : 0)
  return { value: next, start, end: start + mid.length }
}

function mapIndexAfterRemovingTags(index: number, wrap: BbCodeWrap): number {
  const openLen = wrap.openEnd - wrap.openStart
  const closeLen = wrap.closeEnd - wrap.closeStart
  if (index <= wrap.openStart) return index
  if (index <= wrap.openEnd) return wrap.openStart
  if (index <= wrap.closeStart) return index - openLen
  if (index <= wrap.closeEnd) return wrap.closeStart - openLen
  return index - openLen - closeLen
}

function findInnermostBbCodeWrap(value: string, caret: number): BbCodeWrap | null {
  const wraps = findAllBbCodeWraps(value).filter((wrap) => caret >= wrap.openEnd && caret <= wrap.closeStart)
  wraps.sort((a, b) => a.closeStart - a.openEnd - (b.closeStart - b.openEnd))
  return wraps[0] ?? null
}

function findAllBbCodeWraps(value: string): BbCodeWrap[] {
  const wraps: BbCodeWrap[] = []
  const re = /\[(\/)?([A-Z]+)(?:=[^\]]*)?\]/gi
  const stack: { tag: string; openStart: number; openEnd: number }[] = []
  let match: RegExpExecArray | null
  while ((match = re.exec(value))) {
    const tag = match[2].toUpperCase()
    const isClose = Boolean(match[1])
    const start = match.index
    const end = start + match[0].length
    if (!isClose) {
      stack.push({ tag, openStart: start, openEnd: end })
      if (tag === 'CODE' || tag === 'ICODE') {
        const close = new RegExp(`\\[\\/${tag}\\]`, 'ig')
        close.lastIndex = end
        const closed = close.exec(value)
        stack.pop()
        if (!closed) continue
        wraps.push({
          tag,
          openStart: start,
          openEnd: end,
          closeStart: closed.index,
          closeEnd: closed.index + closed[0].length
        })
        re.lastIndex = closed.index + closed[0].length
      }
      continue
    }
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].tag !== tag) continue
      const open = stack[i]
      stack.length = i
      wraps.push({
        tag,
        openStart: open.openStart,
        openEnd: open.openEnd,
        closeStart: start,
        closeEnd: end
      })
      break
    }
  }
  return wraps
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
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\u200b/g, '')
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

  if (tag === 'strong' || tag === 'b') return wrapInline('B', inner)
  if (tag === 'em' || tag === 'i') return wrapInline('I', inner)
  if (tag === 'u') return wrapInline('U', inner)
  if (tag === 's' || tag === 'strike' || tag === 'del') return wrapInline('S', inner)
  if (classListContains(el, 'bbcode-preview-ispoiler')) return wrapInline('ISPOILER', inner)
  if (tag === 'code') return wrapInline('ICODE', inner)
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
  if (color && wrapped.trim()) {
    wrapped = `[COLOR=${toHexColor(el.style.color || el.getAttribute('color') || color)}]${wrapped}[/COLOR]`
  }
  if (size && wrapped.trim()) wrapped = `[SIZE=${size}]${wrapped}[/SIZE]`

  if (tag === 'div' || tag === 'p' || tag === 'h1' || tag === 'h2' || tag === 'h3') {
    return wrapped.replace(/\n$/, '') + '\n'
  }
  return wrapped
}

function serializeChildren(el: HTMLElement): string {
  return Array.from(el.childNodes).map(serializeNode).join('')
}

function wrapInline(tag: string, inner: string): string {
  return inner.trim() ? `[${tag}]${inner}[/${tag}]` : inner
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
