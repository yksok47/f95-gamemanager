import { load, type CheerioAPI, type Cheerio } from 'cheerio'
import type { AnyNode, Element } from 'domhandler'
import type { NoteSection } from '@shared/types'

export type { NoteSection } from '@shared/types'

const LABEL_SELECTOR = 'b, strong, u, h1, h2, h3, h4'
const HOST = 'https://f95zone.to'

function normalize(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function labelText(raw: string): string {
  return normalize(raw).replace(/[:\s]+$/, '')
}

function elementText(el: Cheerio<AnyNode>): string {
  return normalize(el.text())
}

function classifySection(raw: string): 'description' | 'changelog' | 'downloads' | 'gallery' | 'notes' | null {
  const text = labelText(raw).toLowerCase()
  if (!text || text.length > 72) return null
  if (/^(overview|thread information|game information|information|game and thread)$/.test(text)) {
    return 'description'
  }
  if (/^(game )?description$|^synopsis$|^story$|^plot$|^about$|^summary$/.test(text)) return 'description'
  if (/change[\s-]*logs?|what'?s new|^updates?$|^update history$/.test(text)) return 'changelog'
  if (/^(downloads?|download links?|mirrors?)$/.test(text)) return 'downloads'
  if (/screenshots?|galler|previews?|^images?$/.test(text)) return 'gallery'
  if (isNotesLabel(text)) return 'notes'
  return null
}

/** Top-level informational blocks: developer/android notes, installation, tutorial, FAQ, etc. */
export function isNotesLabel(raw: string): boolean {
  const text = labelText(raw).toLowerCase()
  if (!text || text.length > 72) return false
  if (/^patch notes?$/.test(text)) return false
  if (/^(?:dev(?:eloper)?(?:'?s)?\s+)?notes?(?:\s*\/\s*faq)?$/.test(text)) return true
  if (/^(?:android|ios|pc|windows?|mac|linux|win)\s+notes?$/.test(text)) return true
  if (/^compatibility\s+notes?$/.test(text)) return true
  if (/^(?:installation|install(?:ation)?(?:\s+instructions?)?)$/.test(text)) return true
  if (/^instructions?(?:\s+for\s+.+)?$/.test(text)) return true
  if (/^(?:tutorial|howto|how\s*to)(?:\s*\/\s*help)?$/.test(text)) return true
  if (/^(?:faq|help|troubleshooting)$/.test(text)) return true
  return false
}

function isMetaFieldLabel(raw: string): boolean {
  const text = labelText(raw).toLowerCase()
  return /^(thread updated|thread update|updated|last updated|last update|update date|release date|released|publication date|published|first release|developer|developers|creator|author|developer\/publisher|publisher|modder|mod version|original game|prequel|sequel|version|release version|engine|status|censored|censorship|os|platform|language|languages|genre|other games|related games|more games|also (?:try|check|play)|store|website|socials|resolution|voices|translation)$/.test(
    text
  )
}

function isDownloadsMarker(raw: string): boolean {
  const text = labelText(raw)
  return /^(downloads?|download links?|download here|download now|mirrors?|links?)$/i.test(text)
}

function absolutize(url: string | undefined | null): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed, HOST).href
  } catch {
    return null
  }
}

function isDownloadUrl(url: string): boolean {
  if (!url || url.startsWith('javascript:')) return false
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(url)) return false
  return /\/masked\/|mega\.nz|mediafire|drive\.google|docs\.google|dropbox|pixeldrain|workupload|gofile|send\.cm|datanodes|uploadhaven|buzzheavier|bzzhr|vikingfile|1fichier|rapidgator|nitroflare|anonfiles|file-upload|attachments\.f95zone|mixdrop/i.test(
    url
  )
}

function spoilerTitle($: CheerioAPI, el: Element): string {
  const node = $(el)
  const button = node.children('button.bbCodeSpoiler-button, button, .bbCodeSpoiler-button').first()
  const scope = button.length ? button : node
  const titled = normalize(scope.find('.bbCodeSpoiler-button-title').first().text())
  if (titled) return titled
  return normalize(scope.find('.button-text').first().text())
}

function spoilerBody($: CheerioAPI, el: Element): Cheerio<AnyNode> {
  const node = $(el)
  for (const selector of [
    '.bbCodeSpoiler-content .bbCodeBlock-content',
    '.bbCodeBlock-content',
    '.bbCodeSpoiler-content'
  ]) {
    const content = node.find(selector).first()
    if (content.length) return content
  }
  return node
}

function sectionLabel($: CheerioAPI, node: AnyNode): string | null {
  if (node.type !== 'tag') return null
  const el = $(node)
  if (!el.is(LABEL_SELECTOR) || el.find('a, img').length) return null
  const text = labelText(elementText(el))
  return text && text.length <= 72 ? text : null
}

function opensDownloads($: CheerioAPI, el: Cheerio<AnyNode>): boolean {
  return el
    .find(`${LABEL_SELECTOR}, span`)
    .addBack()
    .toArray()
    .some((item) => isDownloadsMarker(elementText($(item))))
}

function hasMirrorLinks($: CheerioAPI, el: Cheerio<AnyNode>): boolean {
  return el
    .find('a[href]')
    .addBack('a[href]')
    .toArray()
    .some((item) => isDownloadUrl(absolutize($(item).attr('href')) || ''))
}

function isHardStop($: CheerioAPI, node: AnyNode, currentTitle: string): boolean {
  if (node.type !== 'tag') return false
  const el = $(node)
  if (el.is('.bbCodeSpoiler, .bbCodeBlock')) return false
  if (opensDownloads($, el) || hasMirrorLinks($, el)) return true
  const label = sectionLabel($, node)
  if (!label) return false
  if (labelText(label).toLowerCase() === labelText(currentTitle).toLowerCase()) return false
  if (isNotesLabel(label)) return true
  const section = classifySection(label)
  return isMetaFieldLabel(label) || Boolean(section && section !== 'notes')
}

function contentAfter(
  marker: AnyNode,
  root: Cheerio<AnyNode>,
  stop: (node: AnyNode) => boolean
): AnyNode[] {
  const nodes: AnyNode[] = []
  let node: AnyNode | null = marker
  while (node) {
    let sibling = node.next
    while (sibling) {
      if (stop(sibling)) return nodes
      nodes.push(sibling)
      sibling = sibling.next
    }
    const parent: AnyNode | null = node.parent
    if (!parent || parent.type !== 'tag' || parent === root.get(0)) break
    node = parent
  }
  return nodes
}

function insideSpoiler($: CheerioAPI, node: AnyNode): boolean {
  let parent: AnyNode | null = node.parent
  while (parent) {
    if (parent.type === 'tag' && $(parent).is('.bbCodeSpoiler, .bbCodeSpoiler-content, .bbCodeBlock--spoiler')) {
      return true
    }
    parent = parent.parent
  }
  return false
}

function findNotesMarkers($: CheerioAPI, root: Cheerio<AnyNode>): AnyNode[] {
  const found: AnyNode[] = []

  function walk(list: AnyNode[]): void {
    for (const node of list) {
      if (node.type === 'text') {
        if (!insideSpoiler($, node) && isNotesLabel(normalize(node.data || ''))) found.push(node)
        continue
      }
      if (node.type !== 'tag') continue
      const el = $(node)
      // Headers live outside spoilers; skip nested FAQ/Help/Notes inside changelog bodies.
      if (el.is('.bbCodeSpoiler')) continue
      if (el.is('.bbCodeSpoiler-button, a, img')) continue
      if (el.is(LABEL_SELECTOR) && isNotesLabel(elementText(el)) && !insideSpoiler($, node)) {
        found.push(node)
        continue
      }
      walk(node.children ?? [])
    }
  }

  walk(root.contents().toArray())
  return found
}

function markerElement(marker: AnyNode): AnyNode {
  if (marker.type === 'tag') return marker
  const parent = marker.parent
  if (parent && parent.type === 'tag') return parent
  return marker
}

function notesRegion($: CheerioAPI, marker: AnyNode, root: Cheerio<AnyNode>, title: string): AnyNode[] {
  if (marker.type === 'tag' && $(marker).is('.bbCodeSpoiler')) return [marker]
  let sawContainer = false
  return contentAfter(marker, root, (node) => {
    if (isHardStop($, node, title)) return true
    const label = sectionLabel($, node)
    if (label && (sawContainer || isNotesLabel(label) || classifySection(label) || isMetaFieldLabel(label))) {
      return true
    }
    if (node.type === 'tag' && $(node).is('.bbCodeSpoiler, .bbCodeBlock')) sawContainer = true
    return false
  })
}

function serializeNodes($: CheerioAPI, nodes: AnyNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'text') return node.data || ''
      return $.html(node) || ''
    })
    .join('')
}

/** Body HTML for the UI: unwrap spoilers, no chrome, no repeated section title. */
function sanitizeHtml(html: string): string {
  const $ = load(`<div id="root">${html}</div>`)
  const root = $('#root')
  root.find('.bbCodeSpoiler-button, button').remove()
  for (let guard = 0; guard < 500; guard++) {
    const el = root.find('.bbCodeSpoiler, .bbCodeBlock--spoiler').get(0)
    if (!el) break
    const node = $(el)
    const body = node.find('.bbCodeBlock-content').first().length
      ? node.find('.bbCodeBlock-content').first()
      : node.find('.bbCodeSpoiler-content').first()
    node.replaceWith(body.length ? body.contents() : node.contents())
  }
  root.find('script, style, form, input, svg, noscript').remove()
  root.find('a[href]').each((_, el) => {
    const node = $(el)
    const href = node.attr('href') || ''
    if (href.startsWith('javascript:') || href.startsWith('data:')) {
      node.removeAttr('href')
      return
    }
    const abs = absolutize(href)
    if (!abs) return
    node.attr('href', abs)
    node.attr('target', '_blank')
    node.attr('rel', 'noreferrer')
  })
  return (root.html() || '')
    .replace(/^(?:\s|:|<br\s*\/?>)+/i, '')
    .replace(/(?:\s|<br\s*\/?>)+$/i, '')
    .trim()
}

function hasContent(html: string): boolean {
  if (!html) return false
  const $ = load(`<div id="x">${html}</div>`)
  if ($('#x').find('img, a[href], iframe, ul, ol, li').length) return true
  return normalize($('#x').text()).replace(/[:;.,\-–—·•|]/g, '').length > 0
}

function markerTitle($: CheerioAPI, marker: AnyNode): string {
  if (marker.type === 'tag') {
    const el = $(marker)
    if (el.is('.bbCodeSpoiler')) return labelText(spoilerTitle($, marker as Element)) || 'Notes'
    if (el.is(LABEL_SELECTOR)) return labelText(elementText(el))
  }
  return labelText(normalize(marker.type === 'text' ? marker.data || '' : ''))
}

/**
 * Extract informational note sections from first-post markup
 * (developer notes, android notes, installation, tutorial, FAQ, …).
 * `html` is body content only — the UI renders `title` separately.
 */
export function parseNotes(html: string): NoteSection[] {
  if (!html.trim()) return []

  const $ = load(`<div id="notes-root">${html}</div>`)
  const root = $('#notes-root')
  const markers = findNotesMarkers($, root)
  if (!markers.length) return []

  const sections: NoteSection[] = []
  const consumed = new Set<AnyNode>()

  for (const marker of markers) {
    const start = markerElement(marker)
    if (consumed.has(start)) continue

    const title = markerTitle($, marker)
    if (!title || !isNotesLabel(title)) continue

    let nodes: AnyNode[]
    if (start.type === 'tag' && $(start).is('.bbCodeSpoiler')) {
      nodes = spoilerBody($, start as Element).contents().toArray()
    } else {
      nodes = notesRegion($, start, root, title)
    }

    consumed.add(start)
    for (const node of nodes) consumed.add(node)

    const serialized = sanitizeHtml(serializeNodes($, nodes))
    if (!hasContent(serialized)) continue
    sections.push({ title, html: serialized })
  }

  return sections
}
