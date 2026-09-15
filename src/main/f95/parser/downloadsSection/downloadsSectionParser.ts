import { load, type CheerioAPI, type Cheerio } from 'cheerio'
import type { AnyNode } from 'domhandler'

const LABEL_SELECTOR = 'b, strong, u, h1, h2, h3, h4'
const LIGHTBOX_SELECTOR =
  'a.js-lbImage, a[data-fancybox], a.lbContainer, .lbContainer--inline, .lbContainer-zoomer, a.lbContainer-overlay'

const FILLER_TOKENS = new Set(['and', 'only', '32bit', '64bit', 'x86', 'x64'])
const PLATFORM_TOKENS = new Set([
  'win',
  'win32',
  'win64',
  'windows',
  'pc',
  'linux',
  'mac',
  'macos',
  'osx',
  'android',
  'apk',
  'ios',
  'web',
  'html',
  'joiplay'
])
const VARIANT_TOKENS = new Set([
  'hq',
  'lq',
  'hd',
  'sd',
  '4k',
  '1080p',
  '720p',
  'high',
  'low',
  'full',
  'lite',
  'mini',
  'compact',
  'compressed',
  'uncompressed',
  'uncensored',
  'incest'
])
const SECTION_TOKENS = new Set([
  'extra',
  'extras',
  'patch',
  'patches',
  'dlc',
  'mod',
  'mods',
  'walkthrough',
  'walkthroughs',
  'guide',
  'translation',
  'translations',
  'save',
  'saves',
  'cheat',
  'cheats',
  'unofficial',
  'other',
  'others',
  'misc',
  'all',
  'splits',
  'split',
  'parts'
])
const GROUP_TOKENS = new Set([...PLATFORM_TOKENS, ...VARIANT_TOKENS, ...SECTION_TOKENS, ...FILLER_TOKENS])

function normalize(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function labelText(raw: string): string {
  return normalize(raw).replace(/[:\s]+$/, '')
}

function elementText(el: Cheerio<AnyNode>): string {
  return normalize(el.text())
}

function tokenizeLabel(raw: string): string[] {
  return labelText(raw)
    .toLowerCase()
    .split(/[\s/+&,|_-]+/)
    .filter(Boolean)
}

function isDownloadsMarker(raw: string): boolean {
  const text = labelText(raw)
  return /^(downloads?|download links?|download here|download now|mirrors?|links?)$/i.test(text)
}

function hasPlatformToken(raw: string): boolean {
  return tokenizeLabel(raw).some((token) => PLATFORM_TOKENS.has(token))
}

function opensDownloadArea(raw: string): boolean {
  const text = labelText(raw)
  if (isDownloadsMarker(text) || /^download links?\b/i.test(text)) return true
  if (!/^downloads?\b/i.test(text)) return false
  const rest = text.replace(/^downloads?\s*/i, '').trim()
  if (!rest) return true
  // "DOWNLOAD Win" / "Downloads HQ"
  if (isDownloadGroupTitle(rest)) return true
  // Unclosed <b>DOWNLOAD… wrapping following heading lines (Season / Win/Linux).
  // Reject short prose tips like "Download Google Keyboard".
  return (
    rest.length > 20 ||
    /^(?:season|chapter|ch\.?|episode|ep\.?|part|win|mac|linux|android|hq|lq)\b/i.test(rest)
  )
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

function isMetaFieldLabel(raw: string): boolean {
  const text = labelText(raw).toLowerCase()
  return /^(thread updated|thread update|updated|last updated|last update|update date|release date|released|publication date|published|first release|developer|developers|creator|author|developer\/publisher|publisher|modder|mod version|original game|prequel|sequel|version|release version|engine|status|censored|censorship|os|platform|language|languages|genre|installation|install|other games|related games|more games|also (?:try|check|play)|store|website|socials|resolution|voices|translation)$/.test(
    text
  )
}

function isDecorationLabel(text: string): boolean {
  return /dev(eloper)?'?s? notes?|(?:android|ios|pc|windows?|mac|linux|win)\s+notes?|^notes?$|compatibility\s+notes?|^installation$|^install$|instructions?(?:\s+for\s+.+)?|^(?:tutorial|faq|help|troubleshooting)$|fan ?(art|signatures?)|^signatures?$|banners?|wallpapers?|fun stuff|credits?|special thanks|disclaimer|content warning|support (us|me)|donat|patreon/i.test(
    text
  )
}

function isPartLabel(raw: string): boolean {
  const text = labelText(raw)
  return (
    /^(?:parts?|files?|rars?|vol(?:ume)?|archives?|discs?)\s*\.?\s*\d+(?:\s*\/\s*\d+)?$/i.test(text) ||
    /^\d+\s*\/\s*\d+$/.test(text)
  )
}

function isDownloadGroupTitle(raw: string): boolean {
  const text = labelText(raw)
  if (!text || text.length > 50 || isMetaFieldLabel(text)) return false
  if (isPartLabel(text)) return true
  const tokens = tokenizeLabel(text)
  if (!tokens.length || tokens.length > 6) return false
  const meaningful = tokens.filter((token) => !FILLER_TOKENS.has(token))
  return meaningful.length > 0 && meaningful.every((token) => GROUP_TOKENS.has(token))
}

function isForeignSectionLabel(raw: string): boolean {
  const text = labelText(raw).toLowerCase()
  if (!text) return false
  if (isDownloadGroupTitle(text) || isPartLabel(text)) return false
  if (isMetaFieldLabel(text)) return true
  const section = classifySection(text)
  if (section && section !== 'downloads') return true
  return isDecorationLabel(text)
}

function isDownloadUrl(url: string): boolean {
  if (!url || url.startsWith('javascript:')) return false
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(url)) return false
  return /\/masked\/|mega\.nz|mediafire|drive\.google|docs\.google|dropbox|pixeldrain|workupload|gofile|send\.cm|datanodes|uploadhaven|buzzheavier|bzzhr|vikingfile|1fichier|rapidgator|nitroflare|anonfiles|file-upload|attachments\.f95zone|mixdrop/i.test(
    url
  )
}

function sectionLabel($: CheerioAPI, node: AnyNode): string | null {
  if (node.type !== 'tag') return null
  const el = $(node)
  if (!el.is(LABEL_SELECTOR) || el.find('a, img').length) return null
  const text = labelText(elementText(el))
  return text && text.length <= 72 ? text : null
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

function nodeHasDownloadLinks($: CheerioAPI, node: AnyNode): boolean {
  const el = $(node)
  const parent = el.parent()
  const scope = parent.length ? parent : el
  return scope.find('a[href]').toArray().some((item) => isDownloadUrl($(item).attr('href') || ''))
}

function isImplicitDownloadHeading(raw: string): boolean {
  const text = labelText(raw)
  if (!text || text.length > 80) return false
  if (isMetaFieldLabel(text) || isForeignSectionLabel(text)) return false
  // Bare "Win/Linux" / "Mac", or a release line that still names a platform
  // ("Final Mix Win/Linux", "Chapter 5 Win/Linux") sitting next to hoster links.
  return hasPlatformToken(text)
}

function previousContentSibling(node: AnyNode): AnyNode | null {
  let sibling = node.prev
  while (sibling) {
    if (sibling.type === 'text' && !normalize(sibling.data || '')) {
      sibling = sibling.prev
      continue
    }
    if (sibling.type === 'tag' && (sibling as { name?: string }).name === 'br') {
      sibling = sibling.prev
      continue
    }
    return sibling
  }
  return null
}

/** Prefer a release title immediately above the first platform+mirrors line. */
function expandImplicitMarker($: CheerioAPI, marker: AnyNode): AnyNode {
  const previous = previousContentSibling(marker)
  if (!previous) return marker
  const label = sectionLabel($, previous)
  if (!label || isForeignSectionLabel(label) || hasPlatformToken(label) || isDownloadGroupTitle(label)) {
    return marker
  }
  return previous
}

function findDownloadsMarker($: CheerioAPI, root: Cheerio<AnyNode>): AnyNode | null {
  let explicit: AnyNode | null = null
  let implicit: AnyNode | null = null

  function walk(list: AnyNode[], inSpoiler: boolean): void {
    for (const node of list) {
      if (explicit) return
      if (node.type === 'text') {
        // Bare text only when it is exactly a downloads header — not "Download Google Keyboard".
        if (isDownloadsMarker(normalize(node.data || ''))) explicit = node
        continue
      }
      if (node.type !== 'tag') continue
      const el = $(node)
      if (el.is('.bbCodeSpoiler-button, a, img')) continue
      if (el.is(LABEL_SELECTOR)) {
        const text = elementText(el)
        if (opensDownloadArea(text)) {
          explicit = node
          continue
        }
        if (!implicit && !inSpoiler && isImplicitDownloadHeading(text) && nodeHasDownloadLinks($, node)) {
          implicit = expandImplicitMarker($, node)
        }
      }
      walk(node.children ?? [], inSpoiler || el.is('.bbCodeSpoiler'))
    }
  }

  walk(root.contents().toArray(), false)
  return explicit || implicit
}

/** Prefer a real element so serialization includes the DOWNLOAD header markup. */
function markerElement(marker: AnyNode): AnyNode {
  if (marker.type === 'tag') return marker
  const parent = marker.parent
  if (parent && parent.type === 'tag') return parent
  return marker
}

function isImageStripNode($: CheerioAPI, node: AnyNode): boolean {
  if (node.type !== 'tag') return false
  const el = $(node)
  if (el.is('img') || el.is(LIGHTBOX_SELECTOR)) return true

  if (el.is('a[href]') && el.find('img').length) {
    const href = el.attr('href') || ''
    if (isDownloadUrl(href)) return false
    if (/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(href)) return true
    if (/attachments\.f95zone|\/thumb\//i.test(href)) return true
    if (el.find('img.bbImage').length) return true
  }

  // Some posts wrap the trailing preview strip in a bare <b>…</b> or centered div.
  if (el.find('img.bbImage, img').length) {
    if (el.find('.messageHide').length) return false
    const hasTextLinks = el.find('a[href]').toArray().some((item) => !$(item).find('img').length)
    if (hasTextLinks) return false
    const text = normalize(el.clone().find('img, a').remove().end().text())
    if (!text) return true
  }

  return false
}

function shouldStop($: CheerioAPI, node: AnyNode): boolean {
  if (isImageStripNode($, node)) return true
  const label = sectionLabel($, node)
  if (label && isForeignSectionLabel(label)) return true
  if (node.type === 'tag') {
    const el = $(node)
    // A presentational wrapper whose first meaningful child is a foreign label.
    if (el.is('div, span, center, p') && !el.is('.bbCodeSpoiler, .bbCodeBlock, .messageHide')) {
      for (const child of el.contents().toArray()) {
        if (child.type === 'text' && !normalize(child.data || '')) continue
        if (child.type === 'tag' && $(child).is('br')) continue
        const childLabel = sectionLabel($, child)
        if (childLabel && isForeignSectionLabel(childLabel)) return true
        if (isImageStripNode($, child)) return true
        break
      }
    }
  }
  return false
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

export function parseDownloadsSection(html: string): string {
  if (!html.trim()) return ''

  const $ = load(`<div id="downloads-root">${html}</div>`)
  const root = $('#downloads-root')
  const marker = findDownloadsMarker($, root)
  if (!marker) return ''

  const start = markerElement(marker)
  const nodes = [start, ...contentAfter(start, root, (node) => shouldStop($, node))]
  return serializeNodes($, nodes)
}
