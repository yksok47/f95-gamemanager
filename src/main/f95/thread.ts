import { load, type CheerioAPI, type Cheerio } from 'cheerio'
import type { AnyNode, Element } from 'domhandler'
import type {
  ChangelogEntry,
  RelatedGame,
  ThreadDetails,
  ThreadDownloadGroup,
  ThreadDownloadLink,
  ThreadField,
  ThreadLink,
  ThreadReview,
  ThreadReviewsPage
} from '@shared/types'
import { F95Error, f95Fetch, f95Url } from './http'
import { engineFromTitle, normalizeEngine } from '@shared/engines'
import { extractThreadId, parseGameTitle, PREFIX_NODE_SELECTOR } from './parse'
import { isWeakCover, parseThreadCounts, headingTitle } from './lookup'

const HOST = 'https://f95zone.to'
const CACHE_VERSION = 19
const LIGHTBOX_SELECTOR =
  'a.js-lbImage, a[data-fancybox], a.lbContainer, .lbContainer--inline, .lbContainer-zoomer, a.lbContainer-overlay'

/** Inline elements F95 posts use as labels: `<b>Version</b>: 1.2`. */
const LABEL_SELECTOR = 'b, strong, u, h1, h2, h3, h4'

function absolutize(url: string | undefined | null): string | null {
  if (!url) return null
  try {
    return new URL(url, HOST).href
  } catch {
    return url
  }
}

function unique<T>(items: T[], keyFn: (item: T) => string = String): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const key = keyFn(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

function uniqueUrls(urls: string[]): string[] {
  return unique(urls)
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

function isDateField(label: string): boolean {
  return /thread updated|thread update|^updated$|last updated|last update|update date|release date|^released$|publication date|^published$|first release/i.test(
    label
  )
}

function isRelatedField(label: string): boolean {
  return /other games|related games|more games|also (?:try|check|play)|similar/i.test(label)
}

function isDeveloperField(label: string): boolean {
  return /^(developer|developers|creator|author|developer\/publisher|publisher)$/i.test(label)
}

/** Headers that open the download area, e.g. a bold `DOWNLOAD` line. */
function isDownloadsMarker(raw: string): boolean {
  const text = labelText(raw)
  return /^(downloads?|download links?|download here|download now|mirrors?|links?)$/i.test(text)
}

/**
 * Opens the download area, tolerating headers that name a platform on the same
 * bold line, e.g. `DOWNLOAD Win`. Kept apart from {@link isDownloadsMarker} so
 * the description still ends at a plain `DOWNLOAD` line only.
 */
function opensDownloadArea(raw: string): boolean {
  const text = labelText(raw)
  return isDownloadsMarker(text) || /^downloads?\b|^download links?\b/i.test(text)
}

/** Post decoration: art, notes, credits — never game data. */
function isDecorationLabel(text: string): boolean {
  return /dev(eloper)?'?s? notes?|fan ?(art|signatures?)|^signatures?$|banners?|wallpapers?|fun stuff|credits?|special thanks|disclaimer|content warning|support (us|me)|donat|patreon/i.test(
    text
  )
}

/** Headers that close the download area; their links belong to another section. */
function isForeignSectionLabel(raw: string): boolean {
  const text = labelText(raw).toLowerCase()
  if (!text) return false
  if (isDownloadGroupTitle(text) || isPartLabel(text)) return false
  if (isMetaFieldLabel(text)) return true
  const section = classifySection(text)
  if (section && section !== 'downloads') return true
  return isDecorationLabel(text)
}

/** Platform/category words used to split download links into groups. */
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

function tokenizeLabel(raw: string): string[] {
  return labelText(raw)
    .toLowerCase()
    .split(/[\s/+&,|_-]+/)
    .filter(Boolean)
}

function prettyDownloadToken(token: string): string {
  const names: Record<string, string> = {
    win: 'Win',
    win32: 'Win32',
    win64: 'Win64',
    windows: 'Win',
    pc: 'Win',
    linux: 'Linux',
    mac: 'Mac',
    macos: 'Mac',
    osx: 'Mac',
    android: 'Android',
    apk: 'Android',
    ios: 'iOS',
    web: 'Web',
    html: 'HTML',
    joiplay: 'JoiPlay',
    hq: 'HQ',
    lq: 'LQ',
    hd: 'HD',
    sd: 'SD',
    extra: 'Extras',
    extras: 'Extras',
    patch: 'Patches',
    patches: 'Patches',
    splits: 'Splits',
    split: 'Splits',
    parts: 'Parts'
  }
  return names[token] || token.charAt(0).toUpperCase() + token.slice(1)
}

function uniqueJoin(values: string[], sep: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const key = value.toLowerCase()
    if (!value || seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }
  return out.join(sep)
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

const VERSION_TOKEN = /\bv?\d+(?:[._]\d+)+[a-z0-9._+-]*/i

/** True for changelog headers such as `v2.50_022`, `V241 Main Features`, `Ch. 7`. */
function isVersionHeading(raw: string): boolean {
  const text = labelText(raw)
  if (!text || text.length > 90) return false
  if (isDownloadGroupTitle(text) || isMetaFieldLabel(text)) return false
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

function isDownloadUrl(url: string): boolean {
  if (!url || url.startsWith('javascript:')) return false
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(url)) return false
  return /\/masked\/|mega\.nz|mediafire|drive\.google|docs\.google|dropbox|pixeldrain|workupload|gofile|send\.cm|datanodes|uploadhaven|buzzheavier|bzzhr|vikingfile|1fichier|rapidgator|nitroflare|anonfiles|file-upload|attachments\.f95zone|mixdrop/i.test(
    url
  )
}

/** Header art rather than a screenshot, so it stays out of the gallery. */
function isBannerUrl(url: string): boolean {
  return /banner|_logo|title[-_]?card/i.test(url)
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

function imageIdentity(url: string): string[] {
  const upgraded = upgradeImageUrl(url).split('#')[0].split('?')[0]
  const name = upgraded.split('/').pop() || ''
  return [upgraded.toLowerCase(), name.toLowerCase()].filter(Boolean)
}

function imagesInHtml(html: string): Set<string> {
  const $ = load(`<div id="x">${html}</div>`)
  const keys = new Set<string>()
  $('#x')
    .find('img, a[href]')
    .each((_, el) => {
      const node = $(el)
      const url = acceptImageUrl(node.attr('src') || node.attr('href'), true)
      if (!url) return
      for (const key of imageIdentity(url)) keys.add(key)
    })
  return keys
}

function galleryWithoutDescription(gallery: string[], descriptionHtml: string): string[] {
  const skip = imagesInHtml(descriptionHtml)
  if (!skip.size) return gallery
  return gallery.filter((url) => !imageIdentity(url).some((key) => skip.has(key)))
}

/** True for headers whose images decorate the post instead of previewing the game. */
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

/**
 * Images belong to whichever header precedes them, so the gallery only keeps
 * the ones a header marks as screenshots plus the unlabelled preview strip that
 * conventionally follows the download block. Everything else — banner art,
 * overview images, developer notes, fan signatures, wallpapers — is skipped,
 * while `all` keeps every image so the cover can still be picked from the post.
 */
function scanPostImages($: CheerioAPI, root: Cheerio<AnyNode>): { all: string[]; gallery: string[] } {
  type ImageContext = 'gallery' | 'blocked' | 'open'
  const all: string[] = []
  const gallery: string[] = []
  let pastDownloads = false
  let lastLabel = ''

  /** Whether an image outside any section is part of the trailing preview strip. */
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
    // An untitled spoiler inherits its header; one holding mirrors is a
    // download block, not a preview strip.
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

      // Mirror links sometimes wrap host logos; those are not screenshots.
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

function pickCoverUrl(ogCover: string | null, gallery: string[]): string | null {
  const fromPost = gallery.find((url) => {
    const upgraded = upgradeImageUrl(url)
    return !isWeakCover(upgraded) && !isThumbnailUrl(upgraded)
  })
  if (fromPost) return upgradeImageUrl(fromPost)
  const og = ogCover ? upgradeImageUrl(ogCover) : null
  if (og && !isWeakCover(og) && !isThumbnailUrl(og)) return og
  return gallery[0] || og
}

function dedupeLinks(links: ThreadDownloadLink[]): ThreadDownloadLink[] {
  return unique(links, (link) => link.url)
}

function isCreatorHost(url: string): boolean {
  try {
    const parsed = new URL(url)
    const masked = parsed.pathname.match(/^\/masked\/([^/]+)/i)?.[1]?.toLowerCase() || ''
    const host = (masked || parsed.hostname.replace(/^www\./, '')).toLowerCase()
    const allowed = [
      'patreon.com',
      'itch.io',
      'subscribestar.adult',
      'subscribestar.com',
      'discord.gg',
      'discord.com',
      'twitter.com',
      'x.com',
      'ko-fi.com',
      'boosty.to',
      'gumroad.com',
      'steamcommunity.com',
      'steampowered.com',
      'bsky.app',
      'pixiv.net',
      'dlsite.com',
      'fanbox.cc',
      'linktr.ee',
      'carrd.co'
    ]
    return allowed.some((item) => host === item || host.endsWith(`.${item}`) || host.includes(item))
  } catch {
    return false
  }
}

function creatorLinkLabel(url: string): string {
  const host = (() => {
    try {
      const parsed = new URL(url)
      return (parsed.pathname.match(/^\/masked\/([^/]+)/i)?.[1] || parsed.hostname).toLowerCase()
    } catch {
      return url.toLowerCase()
    }
  })()
  if (host.includes('patreon')) return 'Patreon'
  if (host.includes('subscribestar')) return 'SubscribeStar'
  if (host.includes('itch')) return 'itch.io'
  if (host.includes('discord')) return 'Discord'
  if (host.includes('ko-fi') || host.includes('kofi')) return 'Ko-fi'
  if (host.includes('boosty')) return 'Boosty'
  if (host.includes('gumroad')) return 'Gumroad'
  if (host.includes('fanbox')) return 'Fanbox'
  if (host.includes('twitter') || host === 'x.com' || host.endsWith('.x.com')) return 'X'
  if (host.includes('bsky')) return 'Bluesky'
  if (host.includes('steam')) return 'Steam'
  if (host.includes('pixiv')) return 'Pixiv'
  if (host.includes('dlsite')) return 'DLsite'
  if (host.includes('linktr')) return 'Linktree'
  if (host.includes('carrd')) return 'Carrd'
  return host.replace(/^www\./, '')
}

function stripCreatorExtras(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, '')
    .replace(
      /\b(patreon|subscribestar|subscribe star|itch\.io|itchio|discord|ko-fi|kofi|boosty|gumroad|twitter|fanbox|linktree|carrd)\b/gi,
      ''
    )
    .replace(/[\s]*[|/\-–—·•]+[\s]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const EMBED_ID = /^[\w-]{2,64}$/

function youtubeEmbed(id: string, start?: string | null): string {
  if (!EMBED_ID.test(id)) return ''
  const seconds = start && /^\d+$/.test(start) ? `?start=${start}` : ''
  return `https://www.youtube.com/embed/${id}${seconds}`
}

/** Player URL from a site name plus a bare video id. */
function playerUrl(site: string, id: string, start?: string | null): string {
  if (!id) return ''
  if (site === 'youtube' || site === 'youtube-nocookie') return youtubeEmbed(id, start)
  if (site === 'vimeo') return /^\d+$/.test(id) ? `https://player.vimeo.com/video/${id}` : ''
  if (site === 'dailymotion') {
    return EMBED_ID.test(id) ? `https://geo.dailymotion.com/player.html?video=${id}` : ''
  }
  if (site === 'streamable') return EMBED_ID.test(id) ? `https://streamable.com/e/${id}` : ''
  return ''
}

/**
 * Embeds rarely point straight at the video host. s9e MediaEmbed uses its own shim
 * (`.../iframe/2/youtube.min.html#<id>`) and F95 proxies through one of its own pages
 * (`https://zonerz.net/youtube.html?v=<id>`), so the player is rebuilt from the shim's
 * filename plus whatever carries the id.
 */
const SHIM_PATH = /(?:^|\/)([a-z0-9_-]+?)(?:\.min)?\.html?$/i

function fromPlayerShim(url: URL): string {
  const site = SHIM_PATH.exec(url.pathname)?.[1]?.toLowerCase()
  if (!site) return ''
  const query = url.searchParams
  let payload = url.hash.replace(/^#/, '') || query.get('v') || query.get('video') || query.get('id') || ''
  try {
    payload = decodeURIComponent(payload)
  } catch {
    // A malformed escape sequence is not worth discarding the id over.
  }
  const id = payload.split(/[;&,]/)[0] ?? ''
  const start = query.get('t') || query.get('start') || /[;&](?:t|start)=(\d+)/.exec(payload)?.[1]
  return playerUrl(site, id, start)
}

/**
 * Canonical player URL for a supported host, or '' when the link is not an embeddable
 * video. The result has to stay in step with the frame-src allowlist in index.html.
 */
function toEmbedUrl(raw: string): string {
  if (!raw) return ''
  let url: URL
  try {
    url = new URL(raw.startsWith('//') ? `https:${raw}` : raw)
  } catch {
    return ''
  }
  if (url.protocol === 'http:') url.protocol = 'https:'
  if (url.protocol !== 'https:') return ''

  const shim = fromPlayerShim(url)
  if (shim) return shim

  const host = url.hostname.replace(/^(www|m)\./i, '').toLowerCase()
  const path = url.pathname

  if (host === 'youtu.be') {
    return youtubeEmbed(path.slice(1), url.searchParams.get('t'))
  }
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (path.startsWith('/embed/')) {
      return youtubeEmbed(path.slice(7), url.searchParams.get('start'))
    }
    if (path.startsWith('/shorts/')) return youtubeEmbed(path.slice(8))
    if (path === '/watch') return youtubeEmbed(url.searchParams.get('v') ?? '')
    return ''
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = /(\d{6,})/.exec(path)?.[1]
    return id ? `https://player.vimeo.com/video/${id}` : ''
  }
  if (host === 'dailymotion.com' || host === 'geo.dailymotion.com' || host === 'dai.ly') {
    const id =
      /\/(?:embed\/)?video\/([\w-]+)/.exec(path)?.[1] ??
      url.searchParams.get('video') ??
      (host === 'dai.ly' ? path.slice(1) : '')
    return id && EMBED_ID.test(id) ? `https://geo.dailymotion.com/player.html?video=${id}` : ''
  }
  if (host === 'streamable.com') {
    const id = path.replace(/^\/(?:e\/)?/, '').split('/')[0]
    return id && EMBED_ID.test(id) ? `https://streamable.com/e/${id}` : ''
  }
  if (host === 'odysee.com') {
    if (path.startsWith('/$/embed/')) return `https://odysee.com${path}`
    return path.length > 1 ? `https://odysee.com/$/embed${path}` : ''
  }
  return ''
}

/** XenForo keeps the video id on the wrapper, which survives even when the iframe is lazy. */
function embedFromMediaKey(wrapper: Cheerio<AnyNode>): string {
  const site = (wrapper.attr('data-media-site-id') || '').toLowerCase()
  const key = wrapper.attr('data-media-key') || ''
  if (!site || !key) return ''
  const [id, start] = key.split('/')
  return playerUrl(site, id, start)
}

/** Site name the forum tagged the embed with, independent of the iframe URL. */
function embedSiteName(node: Cheerio<AnyNode>): string {
  return (
    node.attr('data-s9e-mediaembed') ||
    node.parents('[data-s9e-mediaembed]').last().attr('data-s9e-mediaembed') ||
    node.parents('[data-media-site-id]').last().attr('data-media-site-id') ||
    ''
  ).toLowerCase()
}

/** Inactive miniplayers carry the video id in their poster image. */
function embedFromThumbnail(node: Cheerio<AnyNode>): string {
  const style = `${node.attr('style') || ''} ${node.parent().attr('style') || ''}`
  const id = /i\.ytimg\.com\/vi\/([\w-]{4,64})\//.exec(style)?.[1]
  return id ? youtubeEmbed(id) : ''
}

/** Last resort: the forum says which site this is, so mine the URL for an id. */
function embedFromSiteHint(node: Cheerio<AnyNode>, raw: string): string {
  const site = embedSiteName(node)
  if (!site || !raw) return ''
  const id = /[#/=]([\w-]{4,64})(?:[;&?#].*)?$/.exec(raw)?.[1] ?? ''
  return playerUrl(site, id)
}

function rawEmbedSrc(node: Cheerio<AnyNode>): string {
  return (
    node.attr('src') ||
    node.attr('data-s9e-mediaembed-src') ||
    node.attr('data-src') ||
    node.attr('data-url') ||
    ''
  )
}

/**
 * A bare iframe we control the sizing of. The s9e/XenForo wrappers rely on inline styles
 * and scripts that never run here, which is what left an empty box in the description.
 */
function buildEmbed($: CheerioAPI, src: string): Cheerio<AnyNode> {
  return $('<iframe></iframe>')
    .attr('src', src)
    .attr('class', 'details-embed')
    .attr('loading', 'lazy')
    .attr('referrerpolicy', 'strict-origin-when-cross-origin')
    .attr('allowfullscreen', 'true')
    .attr('allow', 'autoplay; encrypted-media; picture-in-picture; fullscreen')
    .attr('sandbox', 'allow-scripts allow-same-origin allow-presentation allow-popups')
}

/** Outermost media wrapper around an embed, so the whole shell is replaced or dropped. */
function embedShell(node: Cheerio<AnyNode>): Cheerio<AnyNode> {
  const wrapper = node.parents('.bbMediaWrapper, [data-s9e-mediaembed]').last()
  return wrapper.length ? wrapper : node
}

/** A video we recognise but cannot play stays reachable instead of vanishing. */
function buildEmbedFallback($: CheerioAPI, href: string): Cheerio<AnyNode> {
  return $('<a></a>')
    .attr('href', href)
    .attr('class', 'details-embed-link')
    .text('Open video in browser')
}

function replaceMediaEmbeds($: CheerioAPI, root: Cheerio<AnyNode>): void {
  root.find('iframe, object, embed').each((_, el) => {
    const node = $(el)
    const shell = embedShell(node)
    const raw = rawEmbedSrc(node)
    const src =
      toEmbedUrl(raw) ||
      embedFromMediaKey(node.parents('[data-media-key]').last()) ||
      embedFromMediaKey(node) ||
      embedFromSiteHint(node, raw) ||
      embedFromThumbnail(node)
    if (src) {
      shell.replaceWith(buildEmbed($, src))
      return
    }
    // Tagged as media by the forum but unrecognised: keep a way to reach it.
    if (embedSiteName(node) && /^https?:\/\//i.test(raw)) {
      shell.replaceWith(buildEmbedFallback($, raw))
      return
    }
    shell.remove()
  })

  // Wrappers whose iframe is only created by XenForo's lazy-load script.
  root.find('.bbMediaWrapper[data-media-key]').each((_, el) => {
    const wrapper = $(el)
    if (wrapper.find('iframe').length) return
    const src = embedFromMediaKey(wrapper)
    if (!src) return
    wrapper.replaceWith(buildEmbed($, src))
  })
}

function sanitizeHtml(html: string, currentThreadId?: number): string {
  const $ = load(`<div id="root">${html}</div>`)
  const root = $('#root')
  root.find('.bbCodeSpoiler-button, button').remove()
  root.find('.bbCodeSpoiler, .bbCodeBlock--spoiler').each((_, el) => {
    const body = $(el).find('.bbCodeBlock-content, .bbCodeSpoiler-content').first()
    $(el).replaceWith(body.length ? body.contents() : $(el).contents())
  })
  replaceMediaEmbeds($, root)
  root.find('script, style, form, input, svg, noscript').remove()
  root.find('[onclick], [onload], [onerror], [srcdoc]').each((_, el) => {
    const node = $(el)
    for (const attr of Object.keys(el.attribs ?? {})) {
      if (attr.toLowerCase().startsWith('on')) node.removeAttr(attr)
    }
  })
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
    const threadId = extractThreadId(abs)
    if (threadId && threadId !== currentThreadId) {
      node.attr('data-thread-id', String(threadId))
      node.attr('data-thread-title', normalize(node.text()))
    }
    node.attr('target', '_blank')
    node.attr('rel', 'noreferrer')
  })
  root.find('img').each((_, el) => {
    const node = $(el)
    const src = fullImageUrl(node)
    if (!src) {
      node.remove()
      return
    }
    node.attr('src', src)
    node.removeAttr('srcset')
    node.attr('referrerpolicy', 'no-referrer')
  })
  return root.html()?.trim() ?? ''
}

/** True when HTML carries real content instead of leftover punctuation. */
function hasContent(html: string): boolean {
  if (!html) return false
  const $ = load(`<div id="x">${html}</div>`)
  if ($('#x').find('img, a[href], iframe').length) return true
  return normalize($('#x').text()).replace(/[:;.,\-–—·•|]/g, '').length > 0
}

function firstPost($: CheerioAPI): Cheerio<AnyNode> {
  const starter = $('.message-threadStarterPost').first()
  if (starter.length) return starter
  return $('.message--post').first()
}

function firstPageHref($: CheerioAPI): string | null {
  const href = $('nav.pageNav a, .pageNav-main a, .pageNav-jump')
    .toArray()
    .map((el) => $(el))
    .find((node) => /^\s*1\s*$/.test(node.text()) || /page-1(?:\/|$)/i.test(node.attr('href') || ''))
    ?.attr('href')
  return href ? absolutize(href) : null
}

function threadStarter($: CheerioAPI): string {
  return (
    firstPost($)
      .find('.message-userDetails a.username, h4.message-name a.username, a.username')
      .first()
      .text()
      .trim() || $('.p-description').find('a.username').last().text().trim()
  )
}

function firstWrapper($: CheerioAPI): Cheerio<AnyNode> {
  const post = firstPost($)
  const wrapper = post.find('.message-body .bbWrapper').first()
  if (wrapper.length) return wrapper
  return post.find('.message-body').first()
}

function isPresentationalWrapper(el: Cheerio<AnyNode>): boolean {
  if (!el.is('div, span, center, p, font')) return false
  if (
    el.is(
      '.bbCodeSpoiler, .bbCodeBlock, .bbCodeInline, .messageHide, .bbTable, .bbMediaWrapper, blockquote, table, ul, ol, pre, code'
    )
  ) {
    return false
  }
  if (el.attr('data-s9e-mediaembed') || el.is('iframe, object, embed, video')) return false
  const cls = (el.attr('class') || '').trim()
  if (cls && /bbImage|bbCode|messageHide|attachment|media|smilie|button|form|lbContainer/i.test(cls)) {
    return false
  }
  return true
}

function flattenPresentational($: CheerioAPI, root: Cheerio<AnyNode>): void {
  for (let pass = 0; pass < 12; pass += 1) {
    const wrappers = root
      .find('div, span, center, p, font')
      .toArray()
      .filter((el) => isPresentationalWrapper($(el)))
    if (!wrappers.length) break
    for (const el of wrappers) {
      const node = $(el)
      if (!isPresentationalWrapper(node)) continue
      node.replaceWith(node.contents())
    }
  }
}

function spoilerTitle($: CheerioAPI, el: Element): string {
  return normalize(
    $(el).find('.bbCodeSpoiler-button-title, .bbCodeSpoiler-button .button-text, button').first().text()
  )
}

/**
 * Spoilers nest as `.bbCodeSpoiler > .bbCodeSpoiler-content > .bbCodeBlock >
 * .bbCodeBlock-content`, so the innermost content block is tried first.
 */
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

/**
 * Section headers are inconsistent: sometimes `<b>Changelog</b>`, sometimes a
 * bare `Changelog` text node inside a bold block that also holds the banner.
 * Both are matched, and a spoiler is returned whole when its title matches.
 */
function findSectionMarker(
  $: CheerioAPI,
  root: Cheerio<AnyNode>,
  matches: (text: string) => boolean
): AnyNode | null {
  let found: AnyNode | null = null

  function walk(list: AnyNode[]): void {
    for (const node of list) {
      if (found) return
      if (node.type === 'text') {
        if (matches(normalize(node.data || ''))) found = node
        continue
      }
      if (node.type !== 'tag') continue
      const el = $(node)
      if (el.is('.bbCodeSpoiler')) {
        if (matches(spoilerTitle($, node as Element))) found = node
        else walk(spoilerBody($, node as Element).contents().toArray())
        continue
      }
      if (el.is('.bbCodeSpoiler-button, a, img')) continue
      if (el.is(LABEL_SELECTOR) && matches(elementText(el))) {
        found = node
        continue
      }
      walk(node.children ?? [])
    }
  }

  walk(root.contents().toArray())
  return found
}

/**
 * Everything after `marker` in document order, climbing out of the markup that
 * happens to wrap it, until `stop` reports the start of the next section.
 */
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

/** A short bold line, which in a first post always introduces a new block. */
function sectionLabel($: CheerioAPI, node: AnyNode): string | null {
  if (node.type !== 'tag') return null
  const el = $(node)
  if (!el.is(LABEL_SELECTOR) || el.find('a, img').length) return null
  const text = labelText(elementText(el))
  return text && text.length <= 72 ? text : null
}

/** Blocks that can never be part of a changelog. */
function isHardStop($: CheerioAPI, node: AnyNode): boolean {
  if (node.type !== 'tag') return false
  const el = $(node)
  // Spoilers and code blocks are entry bodies; changelog notes often mention
  // downloads, so only plain blocks are treated as the download area.
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

/**
 * The changelog usually sits in a single spoiler right after its header, but
 * some posts list bold version lines instead. Collecting stops at the first
 * unrelated block so later sections (notes, downloads, previews) stay out.
 */
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

function spoilerHasVersionHeadings($: CheerioAPI, body: Cheerio<AnyNode>): boolean {
  return body
    .children(LABEL_SELECTOR)
    .toArray()
    .some((el) => isVersionHeading(elementText($(el))))
}

function versionFromBody(html: string): string {
  const $ = load(`<div id="x">${html}</div>`)
  for (const el of $('#x').find('b, strong').toArray()) {
    const text = normalize($(el).text())
    if (isVersionHeading(text)) return labelText(text)
  }
  const firstLine = normalize($('#x').text().split('\n').find((line) => line.trim()) || '')
  if (isVersionHeading(firstLine)) return labelText(firstLine).slice(0, 80)
  return firstLine.match(VERSION_TOKEN)?.[0] || ''
}

/**
 * Changelogs come in two shapes, often mixed in one post: a bold version line
 * followed by its notes, or a spoiler per version. Both end up as one entry per
 * version, and a spoiler holding several version lines is treated as a container.
 */
function parseChangelogEntries($: CheerioAPI, nodes: AnyNode[], threadId?: number): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let version = ''
  let parts: string[] = []

  function flush(): void {
    const html = sanitizeHtml(parts.join('').replace(/^(?:\s|:|<br\s*\/?>)+/i, ''), threadId)
    const label = labelText(version)
    parts = []
    version = ''
    if (!hasContent(html)) return
    entries.push({ version: label || versionFromBody(html) || 'Changes', html })
  }

  function walk(list: AnyNode[]): void {
    for (const node of list) {
      if (node.type === 'text') {
        const text = normalize(node.data || '')
        if (text) parts.push(` ${text} `)
        continue
      }
      if (node.type !== 'tag') continue
      const el = $(node)
      if (el.is('br')) {
        if (parts.length) parts.push('<br>')
        continue
      }
      if (el.is('.bbCodeSpoiler')) {
        const body = spoilerBody($, node as Element)
        if (spoilerHasVersionHeadings($, body)) {
          walk(body.contents().toArray())
          continue
        }
        const title = spoilerTitle($, node as Element)
        if (!version && isVersionHeading(title)) version = title
        parts.push(body.html() || '')
        continue
      }
      if (el.is('.bbCodeBlock')) {
        const content = el.find('.bbCodeBlock-content').first()
        walk((content.length ? content : el).contents().toArray())
        continue
      }
      if (el.is(LABEL_SELECTOR) && !el.find('a, img').length && isVersionHeading(elementText(el))) {
        flush()
        version = elementText(el)
        continue
      }
      parts.push($.html(el) || '')
    }
  }

  walk(nodes)
  flush()
  return entries
}

function isGenericSpoilerTitle(title: string): boolean {
  return !title || /^(spoiler|show|hide|reveal|expand|more|click.*)$/i.test(labelText(title))
}

/**
 * Plain text between a bold header and the first link on its line. Posts often
 * bold only part of the header, as in `**Android Ch. 4** (HQ 64bit)*:`, and the
 * remainder is what tells otherwise identical lines apart.
 */
function headingDetail($: CheerioAPI, node: AnyNode): string {
  const parts: string[] = []
  let sibling = node.next
  while (sibling) {
    if (sibling.type === 'text') {
      parts.push(sibling.data || '')
      sibling = sibling.next
      continue
    }
    if (sibling.type !== 'tag') {
      sibling = sibling.next
      continue
    }
    const el = $(sibling)
    if (el.is(`a, br, img, div, ul, ol, table, blockquote, ${LABEL_SELECTOR}`)) break
    parts.push(el.text())
    sibling = sibling.next
  }
  const detail = normalize(parts.join(' ')).replace(/^[\s:]+/, '').replace(/[\s:*]+$/, '')
  // Anything long is prose rather than a qualifier like `(HQ 64bit)`.
  return detail.length <= 40 ? detail : ''
}

/** Whether a header already states its own quality tier, e.g. `HQ Win/Linux`. */
function mentionsVariant(label: string): boolean {
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .some((token) => VARIANT_TOKENS.has(token))
}

const VARIANT_PATTERN = new RegExp(`\\b(?:${[...VARIANT_TOKENS].join('|')})\\b`, 'gi')

/** Drops the tier from a header, since the title carries it as a prefix. */
function stripVariantTokens(label: string): string {
  return normalize(label.replace(VARIANT_PATTERN, ' ')).replace(/^[\s/·,-]+|[\s/·,-]+$/g, '')
}

/** Platform named on the same line as the header, as in `DOWNLOAD Win`. */
function downloadHeaderPlatform(text: string, detail: string): string {
  const rest = labelText(text.replace(/^downloads?\s*(?:links?|here|now)?/i, '')).replace(/^[\s:-]+/, '')
  const label = [rest, detail].filter(Boolean).join(' ')
  return tokenizeLabel(label).some((token) => PLATFORM_TOKENS.has(token)) ? label : 'Downloads'
}

/**
 * Each download line becomes its own group, titled with the line's own header
 * so near-identical entries stay apart (`Android Ch. 4 (HQ 64bit)` versus
 * `(HQ 32bit)`). Quality prefixes such as HQ/LQ stay in effect until the next
 * quality or named section, so a bare `Mac` line following `HQ Win/Linux`
 * becomes `HQ · Mac` instead of stealing the previous group's links. Sections
 * outside the download area — developer notes, fan signatures, related games —
 * are skipped so their links never show up as downloads.
 */
function parseDownloadGroups($: CheerioAPI, nodes: AnyNode[]): ThreadDownloadGroup[] {
  const groups: ThreadDownloadGroup[] = []
  const beforeMarker: ThreadDownloadLink[] = []
  let started = false
  let blocked = false
  /** Quality tier such as HQ/LQ, carried until the next tier or section. */
  let quality = ''
  /** Header of an enclosing block, such as the `Chapter 1 (v25)` above a spoiler. */
  let container = ''
  /** Named section such as `Extras` or `Splits`, which can own several lines. */
  let scope = ''
  /** The current line's own header. */
  let line = ''
  let part = ''

  function groupTitle(): string {
    const shown = [container, scope, line, part].filter(Boolean).join(' · ')
    const qualifier = quality && !mentionsVariant(shown) ? quality : ''
    return [qualifier, shown].filter(Boolean).join(' · ') || 'Downloads'
  }

  function add(link: ThreadDownloadLink): void {
    if (blocked) return
    if (!started) {
      beforeMarker.push(link)
      return
    }
    const title = groupTitle()
    const existing = groups.find((group) => group.title.toLowerCase() === title.toLowerCase())
    if (existing) existing.links.push(link)
    else groups.push({ title, links: [link] })
  }

  function applyLabel(raw: string, detail = ''): boolean {
    const text = labelText(raw)
    if (!text) return false
    if (opensDownloadArea(text)) {
      started = true
      blocked = false
      quality = ''
      container = ''
      scope = ''
      line = downloadHeaderPlatform(text, detail)
      part = ''
      return true
    }
    const tokens = tokenizeLabel(text)
    const platforms = tokens.filter((token) => PLATFORM_TOKENS.has(token)).map(prettyDownloadToken)
    const variants = tokens.filter((token) => VARIANT_TOKENS.has(token)).map(prettyDownloadToken)
    const sections = tokens.filter((token) => SECTION_TOKENS.has(token)).map(prettyDownloadToken)
    // Only a platform, part or named download section can reopen the area, so
    // an unrelated header cannot rename the group it happens to precede.
    const opensGroup =
      platforms.length > 0 ||
      isPartLabel(text) ||
      (sections.length > 0 && tokens.every((token) => GROUP_TOKENS.has(token)))
    if (!opensGroup && isForeignSectionLabel(text)) {
      blocked = true
      quality = ''
      container = ''
      scope = ''
      line = ''
      part = ''
      return false
    }
    if (blocked && !opensGroup) return false
    const full = detail ? `${text} ${detail}` : text
    // A part header stays inside the section that owns it, e.g. `Splits · Part 1`.
    if (isPartLabel(text)) {
      started = true
      blocked = false
      part = full
      return true
    }
    if (variants.length) quality = uniqueJoin(variants, ' ')
    if (platforms.length) {
      started = true
      blocked = false
      scope = ''
      // The tier is shown as a prefix, so `HQ Win/Linux` becomes `HQ · Win/Linux`.
      line = (variants.length ? stripVariantTokens(full) : full) || full
      part = ''
      return true
    }
    // A named section opens a scope of its own, so it drops the running tier.
    if (sections.length && tokens.every((token) => GROUP_TOKENS.has(token))) {
      started = true
      blocked = false
      quality = ''
      scope = uniqueJoin(sections, ' ')
      line = ''
      part = ''
      return true
    }
    if (started && (isDownloadGroupTitle(text) || (text.length <= 50 && !/[.!?]$/.test(text) && !classifySection(text)))) {
      quality = ''
      scope = full
      line = ''
      part = ''
      return true
    }
    return false
  }

  function walk(list: AnyNode[]): void {
    for (const node of list) {
      if (node.type !== 'tag') continue
      const el = $(node)
      if (el.is('a[href]')) {
        if (el.find('img').length) continue
        const url = absolutize(el.attr('href'))
        if (url && isDownloadUrl(url)) add({ label: elementText(el) || url, url })
        continue
      }
      if (el.is('.bbCodeSpoiler')) {
        const spoiler = spoilerTitle($, node as Element)
        const snapshot = { started, blocked, quality, container, scope, line, part }
        // A section header above a spoiler names everything inside it, as with
        // `Chapter 1 (v25)` or `Splits`, so it stays on the nested groups.
        if (scope) {
          container = [container, scope].filter(Boolean).join(' · ')
          scope = ''
        }
        if (!isGenericSpoilerTitle(spoiler)) applyLabel(spoiler)
        walk(spoilerBody($, node as Element).contents().toArray())
        started = snapshot.started || started
        blocked = snapshot.blocked
        quality = snapshot.quality
        container = snapshot.container
        scope = snapshot.scope
        line = snapshot.line
        part = snapshot.part
        continue
      }
      const heading = !el.find('a, img').length && el.is(LABEL_SELECTOR) ? elementText(el) : ''
      if (heading && applyLabel(heading, headingDetail($, node))) continue
      walk(el.contents().toArray())
    }
  }

  walk(nodes)
  const cleaned = groups
    .map((group) => ({ title: group.title, links: dedupeLinks(group.links) }))
    .filter((group) => group.links.length)
  if (cleaned.length) return cleaned
  const fallback = dedupeLinks(beforeMarker)
  return fallback.length ? [{ title: 'Downloads', links: fallback }] : []
}

/** Value of a `<b>Label</b>: value` line, up to the next label or line break. */
function labelValue($: CheerioAPI, label: Cheerio<AnyNode>): string {
  const parts: string[] = []
  let node = label.get(0)?.next ?? null
  while (node) {
    if (node.type === 'text') {
      parts.push(node.data || '')
      node = node.next
      continue
    }
    if (node.type !== 'tag') {
      node = node.next
      continue
    }
    const el = $(node)
    if (el.is(`br, ${LABEL_SELECTOR}`)) break
    if (el.is('.bbCodeSpoiler')) {
      if (!parts.join('').replace(/[:\s]/g, '')) {
        parts.push(elementText(spoilerBody($, node as Element)))
      }
      break
    }
    if (el.is('div, ul, ol, table, blockquote')) break
    parts.push(el.text())
    node = node.next
  }
  return normalize(parts.join(' ')).replace(/^[\s:]+/, '').trim()
}

type PostMeta = {
  fields: ThreadField[]
  creatorLinks: ThreadLink[]
  relatedGames: RelatedGame[]
  releaseDate: string
  updatedAt: string
}

function fieldValue(fields: ThreadField[], names: string[]): string {
  for (const field of fields) {
    if (names.some((name) => field.label.toLowerCase() === name)) return field.value
  }
  return ''
}

function engineFromFields(fields: ThreadField[]): string {
  for (const field of fields) {
    if (/engine/i.test(field.label)) return field.value
  }
  return ''
}

function headingPrefixText($: CheerioAPI): string {
  return $('h1.p-title-value')
    .find(PREFIX_NODE_SELECTOR)
    .toArray()
    .map((el) => normalize($(el).text()))
    .filter(Boolean)
    .join(' ')
}

function parseMeta($: CheerioAPI, nodes: AnyNode[], currentThreadId: number): PostMeta {
  const allFields: ThreadField[] = []
  const seen = new Set<string>()
  const creatorLinks: ThreadLink[] = []
  const relatedGames: RelatedGame[] = []

  function walk(list: AnyNode[]): void {
    for (const node of list) {
      if (node.type !== 'tag') continue
      const el = $(node)
      if (el.is('a[href]')) {
        const url = absolutize(el.attr('href'))
        if (!url) continue
        const threadId = extractThreadId(url)
        if (threadId && threadId !== currentThreadId) {
          relatedGames.push({ threadId, title: elementText(el) || `Thread ${threadId}`, url })
        } else if (isCreatorHost(url)) {
          creatorLinks.push({ label: creatorLinkLabel(url), url })
        }
        continue
      }
      if (el.is(LABEL_SELECTOR) && !el.find('a, img').length) {
        const label = labelText(elementText(el))
        if (isMetaFieldLabel(label) && !seen.has(label.toLowerCase())) {
          const value = labelValue($, el)
          if (value) {
            seen.add(label.toLowerCase())
            allFields.push({ label, value })
            continue
          }
        }
      }
      walk(el.contents().toArray())
    }
  }

  walk(nodes)

  const releaseDate = fieldValue(allFields, [
    'release date',
    'released',
    'publication date',
    'published',
    'first release'
  ])
  const updatedAt = fieldValue(allFields, [
    'thread updated',
    'thread update',
    'updated',
    'last updated',
    'last update',
    'update date'
  ])
  const fields = allFields
    .filter((field) => !isDateField(field.label) && !isRelatedField(field.label))
    .map((field) =>
      isDeveloperField(field.label) ? { ...field, value: stripCreatorExtras(field.value) } : field
    )
    .filter((field) => field.value)

  return {
    fields,
    creatorLinks: unique(creatorLinks, (link) => link.label.toLowerCase()),
    relatedGames: unique(relatedGames, (game) => String(game.threadId)),
    releaseDate,
    updatedAt
  }
}

/** The overview/description block, which sits behind its own header. */
function parseDescription($: CheerioAPI, root: Cheerio<AnyNode>, threadId: number): string {
  const marker = findSectionMarker($, root, (text) => classifySection(text) === 'description')
  if (marker) {
    if (marker.type === 'tag' && $(marker).is('.bbCodeSpoiler')) {
      return sanitizeHtml(spoilerBody($, marker as Element).html() || '', threadId)
    }
    const nodes = contentAfter(marker, root, (node) => {
      const label = sectionLabel($, node)
      if (!label) return false
      return Boolean(isMetaFieldLabel(label) || classifySection(label) || isDownloadsMarker(label))
    })
    const html = nodes.map((node) => $.html(node) || '').join('')
    const clean = sanitizeHtml(html.replace(/^(?:\s|:|<br\s*\/?>)+/i, ''), threadId)
    if (hasContent(clean)) return clean
  }

  const fallback: AnyNode[] = []
  for (const node of root.contents().toArray()) {
    const label = sectionLabel($, node)
    if (label && (isMetaFieldLabel(label) || classifySection(label) || isDownloadsMarker(label))) break
    fallback.push(node)
  }
  const html = fallback.map((node) => $.html(node) || '').join('')
  const clean = sanitizeHtml(html.replace(/^(?:\s|:|<br\s*\/?>)+/i, ''), threadId)
  return hasContent(clean) ? clean : ''
}

/**
 * Everything before the download area. Meta fields and the overview live here,
 * so keeping the tail out avoids reading mirror lists as `Label: value` pairs.
 */
function headNodes($: CheerioAPI, root: Cheerio<AnyNode>): AnyNode[] {
  const nodes: AnyNode[] = []

  function consider(node: AnyNode): boolean {
    if (node.type !== 'tag') {
      nodes.push(node)
      return false
    }
    const el = $(node)
    const nestedMarker = opensDownloads($, el) || hasMirrorLinks($, el)
    if (nestedMarker && isPresentationalWrapper(el) && el.contents().length > 1) {
      for (const child of el.contents().toArray()) {
        if (consider(child)) return true
      }
      return false
    }
    if (nestedMarker) return true
    nodes.push(node)
    return false
  }

  for (const node of root.contents().toArray()) {
    if (consider(node)) break
  }
  return nodes
}

type ParsedPost = {
  descriptionHtml: string
  changelog: ChangelogEntry[]
  /** Screenshots only. */
  gallery: string[]
  /** Every image in the post, in document order, for cover selection. */
  images: string[]
  downloads: ThreadDownloadGroup[]
  meta: PostMeta
}

export function parsePost(html: string, threadId: number): ParsedPost {
  const $ = load(`<div id="post">${html}</div>`)
  const root = $('#post')
  flattenPresentational($, root)

  const marker = findSectionMarker($, root, isChangelogLabel)
  let changelog: ChangelogEntry[] = []
  if (marker) {
    const region = changelogRegion($, marker, root)
    changelog = parseChangelogEntries($, region, threadId)
    for (const node of region) $(node).remove()
    $(marker).remove()
  }

  const head = headNodes($, root)
  const headRoot = load(`<div id="head">${head.map((node) => $.html(node) || '').join('')}</div>`)

  const descriptionHtml = parseDescription(headRoot, headRoot('#head'), threadId)
  const images = scanPostImages($, root)
  return {
    descriptionHtml,
    changelog,
    // Unusual posts carry no screenshot section at all; fall back to every
    // image except the ones already shown in the overview.
    gallery: images.gallery.length
      ? images.gallery
      : galleryWithoutDescription(images.all, descriptionHtml),
    images: images.all,
    downloads: parseDownloadGroups($, root.contents().toArray()),
    meta: parseMeta(headRoot, headRoot('#head').contents().toArray(), threadId)
  }
}

function emptyPost(): ParsedPost {
  return {
    descriptionHtml: '',
    changelog: [],
    gallery: [],
    images: [],
    downloads: [],
    meta: { fields: [], creatorLinks: [], relatedGames: [], releaseDate: '', updatedAt: '' }
  }
}

function jsonLdReviewCount($: CheerioAPI): number {
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(el).text() || '{}') as {
        aggregateRating?: { reviewCount?: string | number; ratingCount?: string | number }
      }
      const count = Number(data.aggregateRating?.reviewCount || data.aggregateRating?.ratingCount || 0)
      if (count) return count
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return 0
}

function reviewContent(node: Cheerio<AnyNode>): Cheerio<AnyNode> {
  const content = node
    .find(
      '.bbWrapper, .message-body, .lfsReview-content, .structItem-cell--main, .br-review-content, blockquote'
    )
    .first()
  if (content.length) return content.clone()
  return node.clone().children('h1, h2, h3, h4, .ratingStars, .username').remove().end()
}

function reviewFromNode(node: Cheerio<AnyNode>, threadId: number): ThreadReview | null {
  const author =
    node.find('a.username').first().text().trim() ||
    normalize(
      node.find('.message-name, .message-attribution-user, .structItem-parts, h2, h3, h4').first().text()
    )
  const content = reviewContent(node)
  content.find('.ratingStars, .br-rating, [data-score], [data-rating]').remove()
  const html = sanitizeHtml(content.html() || '', threadId)
  const body = normalize(content.text())
  if (!author && !body) return null
  const ratingText =
    node.find('.ratingStars, [data-score], [data-rating], .br-rating').first().attr('title') ||
    node.find('[data-score]').attr('data-score') ||
    node.find('[data-rating]').attr('data-rating') ||
    node.find('.ratingStars').attr('aria-label') ||
    node.text().match(/(\d+(?:\.\d+)?)\s*star/i)?.[0] ||
    ''
  const rating = Number(String(ratingText).match(/(\d+(?:\.\d+)?)/)?.[1] || 0)
  const date =
    node.find('time').first().attr('datetime') || normalize(node.find('time, .u-dt').first().text())
  return { author: author || 'Anonymous', rating, date: date || '', body, html }
}

function parseReviewNodes($: CheerioAPI, isReviewsPage = false, threadId = 0): ThreadReview[] {
  const reviews: ThreadReview[] = []
  const selectors = [
    '.lfsReview',
    '.structItem--review',
    '.message--review',
    '.brmsReview',
    '[class*="br-review"]'
  ]
  if (isReviewsPage) {
    selectors.push('.p-body-pageContent .block-row', '.p-body-pageContent article.message')
  }
  $(selectors.join(', ')).each((_, el) => {
    const node = $(el)
    if (node.find('.bbCodeSpoiler').length && node.closest('.message--post').length) return
    const review = reviewFromNode(node, threadId)
    if (review && (review.body.length > 20 || review.rating)) reviews.push(review)
  })
  if (reviews.length) return unique(reviews, (item) => `${item.author}:${item.body.slice(0, 80)}`)

  if (!isReviewsPage) return []

  $('.p-body-pageContent h2, .p-body-pageContent h3, .p-body-pageContent h4').each((_, el) => {
    const heading = $(el)
    if (heading.closest('.p-title, .p-description, .tabs').length) return
    const author = heading.find('a.username').text().trim() || normalize(heading.text())
    if (!author || /review/i.test(author)) return
    const chunk = heading.nextUntil('h2, h3, h4')
    const html = sanitizeHtml(chunk.toArray().map((item) => $.html(item) || '').join(''), threadId)
    const body = normalize(chunk.text())
    if (!body) return
    const nearby = heading.prevAll().toArray().slice(0, 3).map((item) => $(item).text()).join(' ')
    const rating = Number((nearby + heading.parent().text()).match(/(\d+(?:\.\d+)?)\s*star/i)?.[1] || 0)
    reviews.push({ author, rating, date: '', body, html })
  })
  return unique(reviews, (item) => `${item.author}:${item.body.slice(0, 80)}`)
}

function pageFromHref(href: string | undefined | null): number {
  if (!href) return 0
  return Number(href.match(/\/page-(\d+)(?:\/|$|\?)/i)?.[1] || 0)
}

function parsePageNav($: CheerioAPI): { page: number; totalPages: number } {
  const current =
    Number(
      normalize(
        $('.pageNav-page--current a, .pageNav-page--current, .pageNavSimple-el--current').first().text()
      ).match(/(\d+)/)?.[1] || 1
    ) || 1
  let totalPages = current
  $('.pageNav a[href], .pageNavSimple a[href], link[rel="next"], link[rel="prev"]').each((_, el) => {
    totalPages = Math.max(totalPages, pageFromHref($(el).attr('href')))
  })
  return { page: current, totalPages: Math.max(1, totalPages) }
}

function reviewListPaths(threadId: number, page: number, canonical?: string): string[] {
  const extra = page > 1 ? `/page-${page}` : ''
  const bases = [`${HOST}/threads/${threadId}`]
  if (canonical) {
    bases.unshift(canonical.replace(/\/$/, '').replace(/\/(br-reviews|reviews)(?:\/page-\d+)?$/i, ''))
  }
  return unique(bases.flatMap((base) => [`${base}/br-reviews${extra}`, `${base}/reviews${extra}`]))
}

function reviewsTotalFrom($: CheerioAPI, fallback: number): number {
  const tabText = $('a.tabs-tab[href*="br-reviews"], a.tabs-tab[href*="/reviews"], a[href*="br-reviews"]').first().text()
  const heading = $('h1, h2, h3, .p-title-value').first().text()
  return Number(
    tabText.match(/(\d+)/)?.[1] || heading.match(/(\d+)\s*review/i)?.[1] || jsonLdReviewCount($) || fallback
  )
}

const reviewsCache = new Map<string, { at: number; value: ThreadReviewsPage }>()
const detailsCache = new Map<string, { at: number; value: ThreadDetails }>()
const DETAILS_TTL_MS = 10 * 60 * 1000

export async function fetchThreadReviews(
  threadId: number,
  page = 1,
  options: { canonical?: string; fallback$?: CheerioAPI } = {}
): Promise<ThreadReviewsPage> {
  const safePage = Math.max(1, Math.floor(page) || 1)
  const cacheKey = `${CACHE_VERSION}:reviews:${threadId}:${safePage}`
  const cached = reviewsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < DETAILS_TTL_MS) return cached.value

  for (const path of reviewListPaths(threadId, safePage, options.canonical)) {
    try {
      const { body, response } = await f95Fetch(path, {}, { timeoutMs: 25000 })
      if (response.status >= 400) continue
      const $ = load(body)
      const onReviewsPage = /br-reviews|\/reviews/i.test(response.url)
      if (
        !onReviewsPage &&
        !$('.lfsReview, .message--review, .structItem--review, [class*="br-review"]').length
      ) {
        continue
      }
      const reviews = parseReviewNodes($, true, threadId)
      if (!reviews.length && safePage === 1) continue
      const nav = parsePageNav($)
      const total = reviewsTotalFrom($, reviews.length)
      const estimatedPages =
        reviews.length && total > reviews.length ? Math.ceil(total / reviews.length) : 1
      const totalPages = nav.totalPages > 1 ? nav.totalPages : Math.max(1, estimatedPages)
      const value: ThreadReviewsPage = {
        threadId,
        page: nav.page || safePage,
        totalPages,
        total: total || reviews.length,
        reviews
      }
      reviewsCache.set(cacheKey, { at: Date.now(), value })
      return value
    } catch {
      // Try the next reviews URL.
    }
  }

  const fallback =
    options.fallback$ && safePage <= 1 ? parseReviewNodes(options.fallback$, false, threadId) : []
  const value: ThreadReviewsPage = {
    threadId,
    page: safePage,
    totalPages: 1,
    total: fallback.length,
    reviews: fallback
  }
  if (fallback.length) reviewsCache.set(cacheKey, { at: Date.now(), value })
  if (fallback.length || safePage <= 1) return value
  throw new F95Error('Could not load that reviews page.', 'network')
}

async function loadThreadDocument(threadId: number): Promise<ReturnType<typeof load>> {
  const { body } = await f95Fetch(`/threads/${threadId}/`, {}, { timeoutMs: 45000 })
  const $ = load(body)
  if ($('.message-threadStarterPost').length) return $
  const firstPage = firstPageHref($)
  if (!firstPage) return $
  try {
    const next = await f95Fetch(firstPage, {}, { timeoutMs: 45000 })
    const parsed = load(next.body)
    if (parsed('.message-threadStarterPost, .message--post').length) return parsed
  } catch {
    // Keep the first response if pagination retry fails.
  }
  return $
}

export async function fetchThreadDetails(threadId: number): Promise<ThreadDetails> {
  const cacheKey = `${CACHE_VERSION}:${threadId}`
  const cached = detailsCache.get(cacheKey)
  if (cached && Date.now() - cached.at < DETAILS_TTL_MS) return cached.value

  const $ = await loadThreadDocument(threadId)
  const rawTitle = headingTitle($)
  const parsed = parseGameTitle(rawTitle)
  const canonical =
    $('link[rel="canonical"]').attr('href') ||
    $('meta[property="og:url"]').attr('content') ||
    f95Url(`/threads/${threadId}/`)

  const wrapper = firstWrapper($)
  const post = wrapper.length ? parsePost(wrapper.html() || '', threadId) : emptyPost()
  const version = fieldValue(post.meta.fields, ['version', 'release version']) || parsed.version
  const creator = stripCreatorExtras(
    fieldValue(post.meta.fields, ['developer', 'developers', 'creator', 'author', 'developer/publisher']) ||
      parsed.creator ||
      threadStarter($)
  )
  const ogCover = absolutize($('meta[property="og:image"]').attr('content'))
  const cover = pickCoverUrl(ogCover, post.images)
  const tags = $('a.tagItem, .js-tagList a')
    .toArray()
    .map((el) => normalize($(el).text()))
    .filter(Boolean)

  const reviewPage = await fetchThreadReviews(threadId, 1, { canonical, fallback$: $ })

  const counts = parseThreadCounts($)
  const details: ThreadDetails = {
    threadId,
    threadUrl: canonical,
    title: parsed.title || rawTitle || `Thread ${threadId}`,
    creator,
    version,
    coverUrl: cover,
    tags: uniqueUrls(tags),
    fields: post.meta.fields,
    creatorLinks: post.meta.creatorLinks,
    relatedGames: post.meta.relatedGames,
    releaseDate: post.meta.releaseDate,
    updatedAt: post.meta.updatedAt,
    descriptionHtml: post.descriptionHtml,
    changelog: post.changelog,
    gallery: post.gallery.filter(
      (url) => url !== cover && !isThumbnailUrl(url) && !isBannerUrl(url)
    ),
    downloads: post.downloads,
    reviews: reviewPage.reviews,
    reviewsTotal: reviewPage.total || reviewPage.reviews.length,
    reviewsTotalPages: reviewPage.totalPages,
    engine: normalizeEngine(
      engineFromFields(post.meta.fields) ||
        engineFromTitle(headingPrefixText($)) ||
        engineFromTitle(rawTitle) ||
        engineFromTitle(
          ($('meta[property="og:title"]').attr('content') || '').replace(/\s+\|\s+F95zone.*$/i, '')
        )
    ),
    likes: counts.likes,
    views: counts.views
  }
  detailsCache.set(cacheKey, { at: Date.now(), value: details })
  return details
}
