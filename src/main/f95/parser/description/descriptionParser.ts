import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { AnyNode, Element } from 'domhandler'
import { extractThreadId } from '../../parse'

const HOST = 'https://f95zone.to'
const LABEL_SELECTOR = 'b, strong, u, h1, h2, h3, h4'
const LIGHTBOX_SELECTOR =
  'a.js-lbImage, a[data-fancybox], a.lbContainer, .lbContainer--inline, .lbContainer-zoomer, a.lbContainer-overlay'
const EMBED_ID = /^[\w-]{2,64}$/
const SHIM_PATH = /(?:^|\/)([a-z0-9_-]+?)(?:\.min)?\.html?$/i

/**
 * Overview / description prose HTML from first-post markup.
 * Rewrites embedded video players the same way the live thread parser does.
 */
export function parseDescription(html: string): string {
  if (!html.trim()) return ''

  const $ = load(`<div id="description-root">${html}</div>`)
  const root = $('#description-root')

  const marker = findSectionMarker($, root, (text) => classifySection(text) === 'description')
  if (marker) {
    if (marker.type === 'tag' && $(marker).is('.bbCodeSpoiler')) {
      return sanitizeHtml(spoilerBody($, marker as Element).html() || '')
    }
    const nodes = contentAfter(marker, root, (node) => {
      const label = sectionLabel($, node)
      if (!label) return false
      return Boolean(isMetaFieldLabel(label) || classifySection(label) || isDownloadsMarker(label))
    })
    const raw = nodes.map((node) => $.html(node) || '').join('')
    const clean = sanitizeHtml(raw.replace(/^(?:\s|:|<br\s*\/?>)+/i, ''))
    if (hasContent(clean)) return clean
  }

  const fallback: AnyNode[] = []
  for (const node of root.contents().toArray()) {
    const label = sectionLabel($, node)
    if (label && (isMetaFieldLabel(label) || classifySection(label) || isDownloadsMarker(label))) break
    fallback.push(node)
  }
  const raw = fallback.map((node) => $.html(node) || '').join('')
  const clean = sanitizeHtml(raw.replace(/^(?:\s|:|<br\s*\/?>)+/i, ''))
  return hasContent(clean) ? clean : ''
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

function sectionLabel($: CheerioAPI, node: AnyNode): string | null {
  if (node.type !== 'tag') return null
  const el = $(node)
  if (!el.is(LABEL_SELECTOR) || el.find('a, img').length) return null
  const text = labelText(elementText(el))
  return text && text.length <= 72 ? text : null
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

function hasContent(html: string): boolean {
  if (!html) return false
  const $ = load(`<div id="x">${html}</div>`)
  if ($('#x').find('img, a[href], iframe').length) return true
  return normalize($('#x').text()).replace(/[:;.,\-–—·•|]/g, '').length > 0
}

function youtubeEmbed(id: string, start?: string | null): string {
  if (!EMBED_ID.test(id)) return ''
  const seconds = start && /^\d+$/.test(start) ? `?start=${start}` : ''
  return `https://www.youtube.com/embed/${id}${seconds}`
}

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

function fromPlayerShim(url: URL): string {
  const site = SHIM_PATH.exec(url.pathname)?.[1]?.toLowerCase()
  if (!site) return ''
  const query = url.searchParams
  let payload = url.hash.replace(/^#/, '') || query.get('v') || query.get('video') || query.get('id') || ''
  try {
    payload = decodeURIComponent(payload)
  } catch {
    // Keep the raw payload when decoding fails.
  }
  const id = payload.split(/[;&,]/)[0] ?? ''
  const start = query.get('t') || query.get('start') || /[;&](?:t|start)=(\d+)/.exec(payload)?.[1]
  return playerUrl(site, id, start)
}

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

function embedFromMediaKey(wrapper: Cheerio<AnyNode>): string {
  const site = (wrapper.attr('data-media-site-id') || '').toLowerCase()
  const key = wrapper.attr('data-media-key') || ''
  if (!site || !key) return ''
  const [id, start] = key.split('/')
  return playerUrl(site, id, start)
}

function embedSiteName(node: Cheerio<AnyNode>): string {
  return (
    node.attr('data-s9e-mediaembed') ||
    node.parents('[data-s9e-mediaembed]').last().attr('data-s9e-mediaembed') ||
    node.parents('[data-media-site-id]').last().attr('data-media-site-id') ||
    ''
  ).toLowerCase()
}

function embedFromThumbnail(node: Cheerio<AnyNode>): string {
  const style = `${node.attr('style') || ''} ${node.parent().attr('style') || ''}`
  const id = /i\.ytimg\.com\/vi\/([\w-]{4,64})\//.exec(style)?.[1]
  return id ? youtubeEmbed(id) : ''
}

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

function embedShell(node: Cheerio<AnyNode>): Cheerio<AnyNode> {
  const wrapper = node.parents('.bbMediaWrapper, [data-s9e-mediaembed]').last()
  return wrapper.length ? wrapper : node
}

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
    if (embedSiteName(node) && /^https?:\/\//i.test(raw)) {
      shell.replaceWith(buildEmbedFallback($, raw))
      return
    }
    shell.remove()
  })

  root.find('.bbMediaWrapper[data-media-key]').each((_, el) => {
    const wrapper = $(el)
    if (wrapper.find('iframe').length) return
    const src = embedFromMediaKey(wrapper)
    if (!src) return
    wrapper.replaceWith(buildEmbed($, src))
  })
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

function sanitizeHtml(html: string): string {
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
    if (threadId) {
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
