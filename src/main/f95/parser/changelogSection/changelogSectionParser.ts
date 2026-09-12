import { load, type CheerioAPI, type Cheerio } from 'cheerio'
import type { AnyNode, Element } from 'domhandler'

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

function classifySection(raw: string): 'description' | 'changelog' | 'downloads' | 'gallery' | null {
  const text = labelText(raw).toLowerCase()
  if (!text || text.length > 72) return null
  if (/^(overview|thread information|game information|information|game and thread)$/.test(text)) {
    return 'description'
  }
  if (/^(game )?description$|^synopsis$|^story$|^plot$|^about$|^summary$/.test(text)) return 'description'
  if (/change[\s-]*logs?|what'?s new|^updates?$|^update history$/.test(text)) return 'changelog'
  if (/^(downloads?|download links?|mirrors?)$/.test(text)) return 'downloads'
  if (/screenshots?|galler|previews?|^images?$/.test(text)) return 'gallery'
  return null
}

function isChangelogLabel(raw: string): boolean {
  const text = labelText(raw)
  return /^(change[\s-]*logs?|what'?s new|update history|patch notes?)$/i.test(text)
}

function isMetaFieldLabel(raw: string): boolean {
  const text = labelText(raw).toLowerCase()
  return /^(thread updated|thread update|updated|last updated|last update|update date|release date|released|publication date|published|first release|developer|developers|creator|author|developer\/publisher|publisher|modder|mod version|original game|prequel|sequel|version|release version|engine|status|censored|censorship|os|platform|language|languages|genre|installation|install|other games|related games|more games|also (?:try|check|play)|store|website|socials|resolution|voices|translation)$/.test(
    text
  )
}

function isDownloadsMarker(raw: string): boolean {
  const text = labelText(raw)
  return /^(downloads?|download links?|download here|download now|mirrors?|links?)$/i.test(text)
}

const VERSION_TOKEN = /\bv?\d+(?:[._]\d+)+[a-z0-9._+-]*/i

function isVersionHeading(raw: string): boolean {
  const text = labelText(raw)
  if (!text || text.length > 90) return false
  if (isMetaFieldLabel(text)) return false
  const startsWithVersion =
    /^(?:version|ver\.?|update|patch|hotfix|release|build)\s+v?\d/i.test(text) ||
    /^v?\d+(?:[._]\d+)+/i.test(text) ||
    /^v\d+[a-z]?\b/i.test(text) ||
    /^ch(?:apter)?\.?\s*\d+/i.test(text) ||
    /^(?:episode|ep\.?|season|day|week)\s*\d+/i.test(text)
  if (startsWithVersion) return true
  if (classifySection(text)) return false
  return /^(changes?|new|whats new|what'?s new)\b/i.test(text) && VERSION_TOKEN.test(text)
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

function isHardStop($: CheerioAPI, node: AnyNode): boolean {
  if (node.type !== 'tag') return false
  const el = $(node)
  if (el.is('.bbCodeSpoiler, .bbCodeBlock')) return false
  if (opensDownloads($, el) || hasMirrorLinks($, el)) return true
  const label = sectionLabel($, node)
  if (!label || isVersionHeading(label)) return false
  const section = classifySection(label)
  return isMetaFieldLabel(label) || Boolean(section && section !== 'changelog')
}

function hasVersionAhead($: CheerioAPI, from: AnyNode): boolean {
  let node = from.next
  while (node) {
    if (isHardStop($, node)) return false
    if (node.type === 'tag') {
      const el = $(node)
      const label = sectionLabel($, node)
      if (label && isVersionHeading(label)) return true
      if (el.is('.bbCodeSpoiler') && isVersionHeading(spoilerTitle($, node as Element))) return true
    }
    node = node.next
  }
  return false
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

function findChangelogMarker($: CheerioAPI, root: Cheerio<AnyNode>): AnyNode | null {
  let found: AnyNode | null = null

  function walk(list: AnyNode[]): void {
    for (const node of list) {
      if (found) return
      if (node.type === 'text') {
        if (isChangelogLabel(normalize(node.data || ''))) found = node
        continue
      }
      if (node.type !== 'tag') continue
      const el = $(node)
      if (el.is('.bbCodeSpoiler')) {
        if (isChangelogLabel(spoilerTitle($, node as Element))) found = node
        else walk(spoilerBody($, node as Element).contents().toArray())
        continue
      }
      if (el.is('.bbCodeSpoiler-button, a, img')) continue
      if (el.is(LABEL_SELECTOR) && isChangelogLabel(elementText(el))) {
        found = node
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

function changelogRegion($: CheerioAPI, marker: AnyNode, root: Cheerio<AnyNode>): AnyNode[] {
  if (marker.type === 'tag' && $(marker).is('.bbCodeSpoiler')) return [marker]
  let sawContainer = false
  return contentAfter(marker, root, (node) => {
    if (isHardStop($, node)) return true
    const label = sectionLabel($, node)
    if (label && !isVersionHeading(label) && (sawContainer || !hasVersionAhead($, node))) return true
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
    .replace(/^(?:\s|<br\s*\/?>)+/i, '')
    .replace(/(?:\s|<br\s*\/?>)+$/i, '')
    .trim()
}

/** Extract the changelog section HTML from first-post markup. */
export function parseChangelogSection(html: string): string {
  if (!html.trim()) return ''

  const $ = load(`<div id="changelog-root">${html}</div>`)
  const root = $('#changelog-root')
  const marker = findChangelogMarker($, root)
  if (!marker) return ''

  if (marker.type === 'tag' && $(marker).is('.bbCodeSpoiler')) {
    return serializeNodes($, [marker])
  }

  const start = markerElement(marker)
  const nodes = [start, ...changelogRegion($, start, root)]
  return serializeNodes($, nodes)
}
