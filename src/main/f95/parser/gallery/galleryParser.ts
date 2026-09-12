import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { AnyNode, Element } from 'domhandler'

const HOST = 'https://f95zone.to'
const LIGHTBOX_SELECTOR =
  'a.js-lbImage, a[data-fancybox], a.lbContainer, .lbContainer--inline, .lbContainer-zoomer, a.lbContainer-overlay'
const LABEL_SELECTOR = 'b, strong, u, h1, h2, h3, h4'

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

/**
 * Screenshot / preview image URLs from first-post HTML.
 * Keeps images under gallery headers plus the unlabelled strip after downloads.
 */
export function parseGallery(html: string): string[] {
  const $ = load(`<div id="gallery-root">${html}</div>`)
  const root = $('#gallery-root')
  return scanPostImages($, root).gallery
}

function normalize(raw: string): string {
  return raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
}

function labelText(raw: string): string {
  return normalize(raw).replace(/[:\s]+$/, '')
}

function elementText(el: Cheerio<AnyNode>): string {
  return normalize(el.text())
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const url of urls) {
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

function absolutize(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    return new URL(url, HOST).href
  } catch {
    return url
  }
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

function isDownloadsMarker(raw: string): boolean {
  const text = labelText(raw)
  return /^(downloads?|download links?|download here|download now|mirrors?|links?)$/i.test(text)
}

function opensDownloadArea(raw: string): boolean {
  const text = labelText(raw)
  return isDownloadsMarker(text) || /^downloads?\b|^download links?\b/i.test(text)
}

function isDecorationLabel(text: string): boolean {
  return /dev(eloper)?'?s? notes?|fan ?(art|signatures?)|^signatures?$|banners?|wallpapers?|fun stuff|credits?|special thanks|disclaimer|content warning|support (us|me)|donat|patreon/i.test(
    text
  )
}

function tokenizeLabel(raw: string): string[] {
  return labelText(raw)
    .toLowerCase()
    .split(/[\s/+&,|_-]+/)
    .filter(Boolean)
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

function isDownloadUrl(url: string): boolean {
  if (!url || url.startsWith('javascript:')) return false
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(url)) return false
  return /\/masked\/|mega\.nz|mediafire|drive\.google|docs\.google|dropbox|pixeldrain|workupload|gofile|send\.cm|datanodes|uploadhaven|buzzheavier|bzzhr|vikingfile|1fichier|rapidgator|nitroflare|anonfiles|file-upload|attachments\.f95zone|mixdrop/i.test(
    url
  )
}

function isWeakCover(url: string): boolean {
  return /^(data:)|\/styles\/|\/data\/avatars\/|\/data\/assets\/|\/data\/covers\/|favicon|default.?logo|xenforo|smilies?\//i.test(
    url
  )
}

function isThumbnailUrl(url: string): boolean {
  return (
    /preview\.f95zone\./i.test(url) ||
    /\.thumb\.|_thumb\b|\/thumb(nails?)?\/|\/data\/attachments\/[^/?#]+\/[^/?#]+\/thumb/i.test(url)
  )
}

function upgradeImageUrl(url: string): string {
  return url
    .replace(/^https?:\/\/preview\.f95zone\.(?:to|com|ninja)\//i, 'https://attachments.f95zone.to/')
    .replace(/\.thumb\.(jpe?g|png|gif|webp|avif)/i, '.$1')
    .replace(/([?&])thumb=\d+(?=&|$)/i, '')
    .replace(/\/thumb(nails?)?\//gi, '/')
}

function largestSrcset(srcset: string | undefined): string | null {
  if (!srcset) return null
  let best: { url: string; size: number } | null = null
  for (const part of srcset.split(',')) {
    const bits = part.trim().split(/\s+/)
    const raw = bits[0]
    if (!raw) continue
    const size = Number.parseInt(bits[1] || '0', 10) || 0
    if (!best || size >= best.size) best = { url: raw, size }
  }
  return best?.url || null
}

function isImageAsset(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/i.test(url) || /attachments\.f95zone|preview\.f95zone/.test(url)
}

function acceptImageUrl(url: string | undefined | null, allowNonFile = false): string | null {
  const abs = absolutize(url)
  if (!abs || isWeakCover(abs) || abs.startsWith('javascript:') || abs.startsWith('data:')) return null
  const upgraded = upgradeImageUrl(abs)
  if (isThumbnailUrl(upgraded) || /\.html?(\?|$)/i.test(upgraded)) return null
  if (isImageAsset(upgraded) || allowNonFile) return upgraded
  return null
}

function fullImageUrl($img: Cheerio<AnyNode>): string | null {
  if (!$img.length || $img.is('.smilie, .reaction, .avatar')) return null
  const $lb = $img.closest(LIGHTBOX_SELECTOR)
  const $zoomer = $img.closest('.lbContainer--inline, .lbContainer').find('.lbContainer-zoomer').first()
  const parentHref = $img.parent().is('a') ? $img.parent().attr('href') : undefined
  const candidates = [
    $lb.attr('href'),
    $lb.attr('data-src'),
    $lb.attr('data-url'),
    $lb.attr('data-lb-src'),
    $zoomer.attr('data-src'),
    $img.attr('data-url'),
    $img.attr('data-fullurl'),
    $img.attr('data-original'),
    $img.attr('data-zoom-image'),
    largestSrcset($img.attr('data-srcset') || $img.attr('srcset')),
    parentHref,
    $img.attr('data-src'),
    $img.attr('src')
  ]
  for (const candidate of candidates) {
    const url = acceptImageUrl(candidate, $lb.length > 0)
    if (url) return url
  }
  return null
}

function isNonGalleryLabel(raw: string): boolean {
  const text = labelText(raw).toLowerCase()
  if (!text) return false
  if (isMetaFieldLabel(text)) return true
  const section = classifySection(text)
  if (section && section !== 'gallery') return true
  return isDecorationLabel(text) || /soundtrack|^osts?$/i.test(text)
}

function isGalleryLabel(raw: string): boolean {
  return classifySection(raw) === 'gallery'
}

function isGenericSpoilerTitle(title: string): boolean {
  return !title || /^(spoiler|show|hide|reveal|expand|more|click.*)$/i.test(labelText(title))
}

function spoilerTitle($: CheerioAPI, el: Element): string {
  return normalize(
    $(el).find('.bbCodeSpoiler-button-title, .bbCodeSpoiler-button .button-text, button').first().text()
  )
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

function hasMirrorLinks($: CheerioAPI, el: Cheerio<AnyNode>): boolean {
  return el
    .find('a[href]')
    .addBack('a[href]')
    .toArray()
    .some((item) => isDownloadUrl(absolutize($(item).attr('href')) || ''))
}

/**
 * Images belong to whichever header precedes them, so the gallery only keeps
 * the ones a header marks as screenshots plus the unlabelled preview strip that
 * conventionally follows the download block.
 */
function scanPostImages($: CheerioAPI, root: Cheerio<AnyNode>): { all: string[]; gallery: string[] } {
  type ImageContext = 'gallery' | 'blocked' | 'open'
  const all: string[] = []
  const gallery: string[] = []
  let pastDownloads = false
  let lastLabel = ''

  function keepOpenImage(): boolean {
    if (isGalleryLabel(lastLabel)) return true
    if (pastDownloads && (!lastLabel || opensDownloadArea(lastLabel) || isDownloadGroupTitle(lastLabel))) {
      return true
    }
    if (isNonGalleryLabel(lastLabel)) return false
    return pastDownloads
  }

  function spoilerContext(current: ImageContext, title: string, body: Cheerio<AnyNode>): ImageContext {
    if (current === 'blocked') return 'blocked'
    if (isGalleryLabel(title)) return 'gallery'
    if (current === 'gallery') return 'gallery'
    if (isNonGalleryLabel(title)) return 'blocked'
    if (isGenericSpoilerTitle(title) && !hasMirrorLinks($, body)) {
      return keepOpenImage() ? 'gallery' : 'blocked'
    }
    return 'blocked'
  }

  function record(url: string, context: ImageContext): void {
    all.push(url)
    if (context === 'gallery' || (context === 'open' && keepOpenImage())) gallery.push(url)
  }

  function imageUrl(el: Cheerio<AnyNode>): string | null {
    if (el.is('img')) return fullImageUrl(el)
    return (
      acceptImageUrl(
        el.attr('href') || el.attr('data-src') || el.attr('data-url') || el.attr('data-lb-src'),
        true
      ) || fullImageUrl(el.find('img.bbImage, img').first())
    )
  }

  function walk(list: AnyNode[], context: ImageContext): void {
    for (const node of list) {
      if (node.type !== 'tag') continue
      const el = $(node)
      if (el.is('noscript, .smilie, .reaction, .avatar')) continue

      if (el.is(LIGHTBOX_SELECTOR) || el.is('img')) {
        const url = imageUrl(el)
        if (url) record(url, context)
        continue
      }

      if (el.is('a[href]') && isDownloadUrl(absolutize(el.attr('href')) || '')) continue

      if (el.is('.bbCodeSpoiler')) {
        const title = spoilerTitle($, node as Element)
        const body = spoilerBody($, node as Element)
        walk(body.contents().toArray(), spoilerContext(context, title, body))
        continue
      }

      if (el.is(LABEL_SELECTOR) && !el.find('a, img').length) {
        const text = labelText(elementText(el))
        if (text) {
          if (opensDownloadArea(text)) pastDownloads = true
          lastLabel = text
        }
        continue
      }

      walk(el.contents().toArray(), context)
    }
  }

  walk(root.contents().toArray(), 'open')
  return { all: uniqueUrls(all), gallery: uniqueUrls(gallery) }
}
