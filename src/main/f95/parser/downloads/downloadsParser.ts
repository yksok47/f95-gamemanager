import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { AnyNode, Element } from 'domhandler'
import type {
  DownloadContentType,
  DownloadEntry,
  DownloadMirror,
  DownloadSection,
  DownloadSectionKind,
  DownloadSystem
} from '@shared/types'

export type {
  DownloadContentType,
  DownloadEntry,
  DownloadMirror,
  DownloadPart,
  DownloadSection,
  DownloadSectionKind,
  DownloadSystem
} from '@shared/types'

const HOST = 'https://f95zone.to'
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

const SYSTEM_ALIASES: Record<string, DownloadSystem> = {
  win: 'win',
  win32: 'win',
  win64: 'win',
  windows: 'win',
  pc: 'win',
  linux: 'linux',
  mac: 'mac',
  macos: 'mac',
  osx: 'mac',
  android: 'android',
  apk: 'android',
  ios: 'ios',
  web: 'web',
  html: 'html',
  joiplay: 'joiplay'
}

type MutableEntry = DownloadEntry
type MutableSection = DownloadSection

/**
 * Structured downloads from a downloads-section HTML excerpt.
 * Top-level sections keep post order (latest / most important first).
 */
export function parseDownloads(html: string): DownloadSection[] {
  if (!html.trim()) return []

  const $ = load(`<div id="downloads-root">${html}</div>`)
  const root = $('#downloads-root')
  const sections = collectSections($, root.contents().toArray())
  return finalizeSections(sections)
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

function tokenizeLabel(raw: string): string[] {
  return labelText(raw)
    .toLowerCase()
    .split(/[\s/+&,|_()-]+/)
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter(Boolean)
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

function uniqueSystems(systems: DownloadSystem[]): DownloadSystem[] {
  const seen = new Set<DownloadSystem>()
  const out: DownloadSystem[] = []
  for (const system of systems) {
    if (seen.has(system)) continue
    seen.add(system)
    out.push(system)
  }
  return out
}

function isDownloadsMarker(raw: string): boolean {
  const text = labelText(raw)
  return /^(downloads?|download links?|download here|download now|mirrors?|links?)$/i.test(text)
}

function opensDownloadArea(raw: string): boolean {
  const text = labelText(raw)
  if (isDownloadsMarker(text) || /^download links?\b/i.test(text)) return true
  if (!/^downloads?\b/i.test(text)) return false
  const rest = text.replace(/^downloads?\s*/i, '').trim()
  if (!rest) return true
  if (isDownloadGroupTitle(rest)) return true
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
  return /dev(eloper)?'?s? notes?|fan ?(art|signatures?)|^signatures?$|banners?|wallpapers?|fun stuff|credits?|special thanks|disclaimer|content warning|support (us|me)|donat|patreon/i.test(
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
    // Skip wrappers that already hold mirror links (not a short qualifier).
    if (el.find('a[href]').length) break
    parts.push(el.text())
    sibling = sibling.next
  }
  const detail = normalize(parts.join(' ')).replace(/^[\s:]+/, '').replace(/[\s:*]+$/, '')
  return detail.length <= 40 ? detail : ''
}

function parsePartInfo(raw: string): { index: number; total: number | null; label: string } | null {
  const text = labelText(raw)
  const named = text.match(
    /^(?:parts?|files?|rars?|vol(?:ume)?|archives?|discs?)\s*\.?\s*(\d+)(?:\s*\/\s*(\d+))?$/i
  )
  if (named) {
    return {
      index: Number(named[1]),
      total: named[2] ? Number(named[2]) : null,
      label: text
    }
  }
  const bare = text.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (bare) {
    return { index: Number(bare[1]), total: Number(bare[2]), label: text }
  }
  return null
}

function systemsFromTokens(tokens: string[]): DownloadSystem[] {
  const systems: DownloadSystem[] = []
  for (const token of tokens) {
    const system = SYSTEM_ALIASES[token]
    if (system) systems.push(system)
  }
  return uniqueSystems(systems)
}

function variantsFromTokens(tokens: string[]): string[] {
  return uniqueJoin(
    tokens.filter((token) => VARIANT_TOKENS.has(token)),
    ' '
  )
    .split(' ')
    .filter(Boolean)
}

function stripPlatformTokens(raw: string): string {
  const text = labelText(raw)
  const cleaned = text
    .split(/([\s/+&,|_()-]+)/)
    .filter((chunk, index) => {
      if (index % 2 === 1) return true
      const token = chunk.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
      return !PLATFORM_TOKENS.has(token) && !FILLER_TOKENS.has(token)
    })
    .join('')
  return normalize(cleaned)
    .replace(/\(\s*\)/g, ' ')
    .replace(/^[\s/·,|:.-]+|[\s/·,|:.-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripPlatformAndVariantTokens(raw: string): string {
  const text = labelText(raw)
  const cleaned = text
    .split(/([\s/+&,|_()-]+)/)
    .filter((chunk, index) => {
      if (index % 2 === 1) return true
      const token = chunk.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
      return !PLATFORM_TOKENS.has(token) && !VARIANT_TOKENS.has(token) && !FILLER_TOKENS.has(token)
    })
    .join('')
  return normalize(cleaned)
    .replace(/\(\s*\)/g, ' ')
    .replace(/^[\s/·,|:.-]+|[\s/·,|:.-]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractVersionNote(raw: string): { version: string | null; rest: string } {
  const text = labelText(raw)
  const paren = text.match(/\((v?\d[\w._-]*)\)/i)
  if (paren) {
    return {
      version: paren[1],
      rest: normalize(text.replace(paren[0], ' '))
    }
  }
  const leading = text.match(/^(v?\d+(?:[._]\d+)+[a-z0-9._+-]*)\b/i)
  if (leading && !systemsFromTokens(tokenizeLabel(text)).length) {
    return { version: leading[1], rest: normalize(text.slice(leading[0].length)) }
  }
  return { version: null, rest: text }
}

function sectionKindFromTitle(title: string | null, tokens: string[]): DownloadSectionKind {
  const text = (title || '').toLowerCase()
  if (tokens.some((token) => token === 'split' || token === 'splits' || token === 'parts')) return 'split'
  if (tokens.some((token) => token === 'extra' || token === 'extras')) return 'extras'
  if (tokens.some((token) => token === 'patch' || token === 'patches')) return 'patches'
  // Container headings that bundle editions/archives stay archives.
  if (/before (?:the )?(?:rework|tech|update)|old\b|previous|legacy|archive|season\b|chapter\b|^s\d+\b/.test(text)) {
    return 'archive'
  }
  if (/and before|specials and/i.test(text)) return 'archive'
  if (/special|holiday|christmas|halloween|valentine|easter|anniversary|new\s*year/i.test(text)) {
    return 'edition'
  }
  if (tokens.some((token) => token === 'other' || token === 'others' || token === 'misc')) return 'other'
  return 'other'
}

function defaultContentTypeForSection(kind: DownloadSectionKind): DownloadContentType {
  switch (kind) {
    case 'patches':
      return 'patch'
    case 'extras':
      return 'extra'
    case 'split':
    case 'current':
    case 'archive':
    case 'edition':
      return 'game'
    default:
      return 'other'
  }
}

function contentTypeFromLabel(raw: string, fallback: DownloadContentType): DownloadContentType {
  const text = labelText(raw).toLowerCase()
  if (!text) return fallback
  if (/^compressed\b|compress(?:ed)?\s+version/.test(text)) return 'game'
  if (/\buncensor|\bincest\b/.test(text)) return 'uncensor'
  if (/\bcrack\b|\bcracked\b/.test(text)) return 'crack'
  if (/\bwalkthrough|\bguide\b|\bfaq\b/.test(text)) return 'walkthrough'
  if (/\bcheat/.test(text)) return 'cheat'
  if (/\btranslati|\btl\b|\blanguage pack/.test(text)) return 'translation'
  if (/\bsave\b|\bsaves\b/.test(text)) return 'save'
  if (/\bdlc\b/.test(text)) return 'dlc'
  if (/\bupdate\b|\bhotfix\b/.test(text)) return 'update'
  if (/\bfix\b/.test(text)) return 'patch'
  if (/\bpatch\b/.test(text)) return 'patch'
  if (/\bmod\b|\bunlocker|\benhancement|\brandomizer|\btweaker/.test(text)) return 'mod'
  if (/\bgallery\b|\bfan\s*sigs?|\bwallpaper|\bcg\b|\bwiki\b|\boff\s*topic/.test(text)) return 'extra'
  if (/^(?:ios|joiplay)$/i.test(text)) return 'game'
  if (fallback !== 'game' && fallback !== 'other') return fallback
  return fallback
}

function systemsFromLinkLabel(raw: string): DownloadSystem[] {
  const text = labelText(raw).toLowerCase()
  if (/^ios$/i.test(text)) return ['ios']
  if (/^joiplay$/i.test(text)) return ['joiplay']
  if (/^android$/i.test(text)) return ['android']
  return []
}

function isHosterLabel(raw: string): boolean {
  const text = labelText(raw)
  if (!text || text.length > 28) return false
  return /^(mega|mediafire|pixeldrain|datanodes|gofile|workupload|mixdrop|buzzheavier|bzzhr|vikingfile|uploadhaven|anonfiles|1fichier|rapidgator|nitroflare|send\.cm|dropbox|google\s*drive|drive|akirabox|bowfile|nopy|pixel|files|mirror\s*\d+)$/i.test(
    text
  )
}

function isMirrorUrl(url: string): boolean {
  if (!url || url.startsWith('javascript:')) return false
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(url)) return false
  if (/\/members\/|\/account\/|\/login/i.test(url)) return false
  if (/^https?:\/\/(?:www\.)?f95zone\.(?:to|com|ninja)\/(?:threads|posts)\//i.test(url)) return false
  if (/^https?:\/\/(?:www\.)?f95zone\.(?:to|com|ninja)\/posts\//i.test(url)) return false
  return (
    /\/masked\/|mega\.nz|mediafire|drive\.google|docs\.google|dropbox|pixeldrain|workupload|gofile|send\.cm|datanodes|uploadhaven|buzzheavier|bzzhr|vikingfile|1fichier|rapidgator|nitroflare|anonfiles|file-upload|attachments\.f95zone|mixdrop|akirabox|bowfile|cancerads|mirrored\.to|katfile|hexupload|uploadev|filehn|ddownload/i.test(
      url
    ) || /^https?:\/\//i.test(url)
  )
}

function isRelatedUrl(url: string): boolean {
  if (!url || url.startsWith('javascript:')) return false
  if (/\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(url)) return false
  if (/\/members\/|\/account\/|\/login/i.test(url)) return false
  if (/username|member-tooltip/i.test(url)) return false
  return /^https?:\/\//i.test(url)
}

function isImageLink(_$: CheerioAPI, el: Cheerio<AnyNode>): boolean {
  return el.find('img').length > 0
}

function linkMarkedUnofficial($: CheerioAPI, node: AnyNode): boolean {
  let sibling = node.next
  while (sibling) {
    if (sibling.type === 'text') {
      const text = sibling.data || ''
      if (/^\s*\*/.test(text)) return true
      if (text.trim()) return false
      sibling = sibling.next
      continue
    }
    if (sibling.type !== 'tag') {
      sibling = sibling.next
      continue
    }
    const el = $(sibling)
    if (el.is('sup') && /^\s*\*/.test(el.text())) return true
    break
  }
  return false
}

function emptySection(title: string | null, kind: DownloadSectionKind): MutableSection {
  return { title, kind, sections: [], entries: [] }
}

function emptyEntry(
  contentType: DownloadContentType,
  systems: DownloadSystem[],
  variants: string[],
  version: string | null,
  title: string | null
): MutableEntry {
  return {
    contentType,
    systems,
    variants,
    version,
    title,
    unofficial: false,
    mirrors: [],
    parts: []
  }
}

function systemsKey(systems: DownloadSystem[]): string {
  return systems.join('/')
}

function entryKey(entry: MutableEntry): string {
  return [
    entry.contentType,
    systemsKey(entry.systems),
    entry.variants.join(','),
    entry.version || '',
    entry.title || ''
  ].join('|')
}

function findOrCreateChild(parent: MutableSection, title: string, kind: DownloadSectionKind): MutableSection {
  const existing = parent.sections.find((section) => (section.title || '').toLowerCase() === title.toLowerCase())
  if (existing) return existing
  const created = emptySection(title, kind)
  parent.sections.push(created)
  return created
}

function collectSections($: CheerioAPI, nodes: AnyNode[]): MutableSection[] {
  const root = emptySection(null, 'current')
  const topLevels: MutableSection[] = [root]

  let activeTop = root
  let active = root
  let systems: DownloadSystem[] = []
  let variants: string[] = []
  let version: string | null = null
  let entryTitle: string | null = null
  let part: { index: number; total: number | null; label: string } | null = null
  let contentType: DownloadContentType = 'game'
  let allowRelated = false
  let started = false
  let blocked = false
  let currentEntry: MutableEntry | null = null

  function ensureTop(title: string | null, kind: DownloadSectionKind): MutableSection {
    if (!title) {
      activeTop = root
      active = root
      return root
    }
    if (activeTop !== root && (activeTop.title || '').toLowerCase() === title.toLowerCase()) {
      active = activeTop
      return activeTop
    }
    const existing = topLevels.find(
      (section) => section !== root && (section.title || '').toLowerCase() === title.toLowerCase()
    )
    if (existing) {
      activeTop = existing
      active = existing
      return existing
    }
    // First named release after DOWNLOAD reuses the empty current root.
    if (
      activeTop === root &&
      !root.title &&
      !root.entries.length &&
      !root.sections.length &&
      (kind === 'current' || kind === 'archive')
    ) {
      root.title = title
      root.kind =
        kind === 'archive' && /season|chapter|episode|interlude/i.test(title) ? 'current' : kind
      active = root
      return root
    }
    const created = emptySection(title, kind)
    topLevels.push(created)
    activeTop = created
    active = created
    return created
  }

  function flushEntry(): void {
    currentEntry = null
  }

  function currentOrNewEntry(): MutableEntry {
    if (currentEntry) return currentEntry
    const entry = emptyEntry(contentType, systems, variants, version, entryTitle)
    active.entries.push(entry)
    currentEntry = entry
    return entry
  }

  function ensureEntryForPart(): MutableEntry {
    const entry = currentOrNewEntry()
    if (part) {
      let existing = entry.parts.find((item) => item.index === part!.index)
      if (!existing) {
        existing = {
          index: part.index,
          total: part.total,
          label: part.label,
          mirrors: []
        }
        entry.parts.push(existing)
      } else if (part.total && !existing.total) {
        existing.total = part.total
      }
    }
    return entry
  }

  function addMirror(mirror: DownloadMirror, unofficial: boolean): void {
    if (blocked) return
    started = true
    const entry = ensureEntryForPart()
    if (unofficial) entry.unofficial = true
    if (part) {
      const target = entry.parts.find((item) => item.index === part!.index)
      if (target && !target.mirrors.some((item) => item.url === mirror.url)) {
        target.mirrors.push(mirror)
      }
      return
    }
    if (!entry.mirrors.some((item) => item.url === mirror.url)) {
      entry.mirrors.push(mirror)
    }
  }

  function addRelated(mirror: DownloadMirror, type: DownloadContentType, unofficial: boolean): void {
    if (blocked) return
    started = true
    const linkSystems = systemsFromLinkLabel(mirror.label)
    const compressed = /^compressed\b|compress(?:ed)?\s+version/i.test(labelText(mirror.label))
    const entry = emptyEntry(
      type,
      linkSystems,
      compressed ? ['compressed'] : [],
      null,
      mirror.label
    )
    entry.mirrors = [mirror]
    entry.unofficial = unofficial
    active.entries.push(entry)
    currentEntry = null
  }

  function applyScopeKind(kind: DownloadSectionKind): void {
    contentType = defaultContentTypeForSection(kind)
    allowRelated = kind === 'extras' || kind === 'patches' || kind === 'other'
    systems = []
    part = null
    entryTitle = null
    version = null
    if (kind !== 'current' && kind !== 'split' && kind !== 'archive' && kind !== 'edition') {
      variants = []
    }
    flushEntry()
  }

  function applyLabel(raw: string, detail = '', nested = false): boolean {
    const text = labelText(raw)
    if (!text) return false

    if (opensDownloadArea(text)) {
      started = true
      blocked = false
      const rest = labelText(text.replace(/^downloads?\s*(?:links?|here|now)?/i, '')).replace(/^[\s:-]+/, '')
      const label = [rest, detail].filter(Boolean).join(' ')
      const labelTokens = tokenizeLabel(label)
      const labelSystems = systemsFromTokens(labelTokens)
      const labelVariants = variantsFromTokens(labelTokens)
      const remainder = stripPlatformAndVariantTokens(label)
      if (remainder && remainder.length <= 80) {
        const kind = sectionKindFromTitle(remainder, tokenizeLabel(remainder))
        ensureTop(remainder, kind === 'other' ? 'current' : kind === 'archive' ? 'current' : kind)
        if (activeTop.kind === 'other') activeTop.kind = 'current'
        // Season / chapter headers on the DOWNLOAD line are the current release.
        if (/season|chapter|episode|interlude/i.test(remainder)) activeTop.kind = 'current'
      } else {
        ensureTop(null, 'current')
      }
      systems = labelSystems
      variants = labelVariants
      version = null
      entryTitle = null
      part = null
      contentType = 'game'
      allowRelated = false
      flushEntry()
      return true
    }

    const full = detail ? `${text} ${detail}` : text
    const tokens = tokenizeLabel(full)
    const foundSystems = systemsFromTokens(tokens)
    const foundVariants = variantsFromTokens(tokens)
    const sectionTokens = tokens.filter((token) => SECTION_TOKENS.has(token))
    const opensGroup =
      foundSystems.length > 0 ||
      isPartLabel(text) ||
      (sectionTokens.length > 0 && tokens.every((token) => GROUP_TOKENS.has(token)))

    if (!opensGroup && isForeignSectionLabel(text)) {
      blocked = true
      systems = []
      variants = []
      version = null
      entryTitle = null
      part = null
      flushEntry()
      return false
    }
    if (blocked && !opensGroup) return false

    if (isPartLabel(text)) {
      started = true
      blocked = false
      part = parsePartInfo(full)
      if (active.kind !== 'split' && activeTop.kind !== 'split') {
        // Multipart under an unnamed block still counts as split packaging.
        if (!active.title) active.kind = 'split'
      }
      flushEntry()
      currentOrNewEntry()
      return true
    }

    if (foundVariants.length) {
      variants = foundVariants
    }

    if (foundSystems.length) {
      started = true
      blocked = false
      const { version: versionNote, rest } = extractVersionNote(full)
      const remainder = stripPlatformTokens(rest)
      const editionRemainder = stripPlatformAndVariantTokens(rest)
      systems = foundSystems
      version = versionNote
      part = null
      allowRelated = false

      if (
        editionRemainder &&
        /special|holiday|christmas|halloween|valentine|easter|anniversary/i.test(editionRemainder)
      ) {
        const section = nested
          ? findOrCreateChild(activeTop, editionRemainder, 'edition')
          : ensureTop(editionRemainder, 'edition')
        active = section
        applyScopeKind('edition')
        systems = foundSystems
        variants = foundVariants
        version = versionNote
        entryTitle = null
        contentType = 'game'
        flushEntry()
        return true
      }

      if (remainder && remainder.length <= 70 && !isDownloadGroupTitle(remainder)) {
        // Bare version notes on a platform line (e.g. "v0.4.0c Win/Linux").
        if (/^v?\d+(?:[._]\d+)+[a-z0-9._+-]*$/i.test(remainder)) {
          version = remainder
          entryTitle = null
        } else if (!nested) {
          const kind = sectionKindFromTitle(remainder, tokenizeLabel(remainder))
          const section = ensureTop(remainder, kind === 'other' ? 'current' : kind)
          active = section
          if (section.kind === 'other') section.kind = 'current'
          // Season/chapter on the first platform line is the current release title.
          if (/season|chapter|episode|interlude/i.test(remainder) && section === activeTop) {
            section.kind = 'current'
          }
        } else if (active === activeTop && !active.title) {
          active.title = remainder
          active.kind = sectionKindFromTitle(remainder, tokenizeLabel(remainder))
          if (active.kind === 'other') active.kind = 'archive'
        } else {
          const soft = stripPlatformAndVariantTokens(remainder)
          entryTitle = soft && soft.length < remainder.length ? soft : remainder
        }
      } else {
        entryTitle = null
      }

      // Keep quality flags from this platform heading.
      if (foundVariants.length) variants = foundVariants
      version = version || versionNote
      systems = foundSystems
      contentType = defaultContentTypeForSection(active.kind === 'other' ? 'current' : active.kind)
      if (active.kind === 'extras' || active.kind === 'patches') contentType = 'game'
      flushEntry()
      return true
    }

    if (sectionTokens.length && tokens.every((token) => GROUP_TOKENS.has(token))) {
      started = true
      blocked = false
      const kind = sectionKindFromTitle(uniqueJoin(sectionTokens, ' '), sectionTokens)
      const title =
        kind === 'split'
          ? 'SPLIT'
          : kind === 'extras'
            ? 'Extras'
            : kind === 'patches'
              ? 'Patches'
              : kind === 'other'
                ? 'Other'
                : uniqueJoin(sectionTokens, ' ')
      const nestOther =
        kind === 'other' &&
        (Boolean(activeTop.title) || activeTop.entries.some((entry) => entry.contentType === 'game'))
      if (nested && (kind === 'extras' || kind === 'patches' || kind === 'other')) {
        active = findOrCreateChild(activeTop, title, kind)
      } else if (nestOther) {
        active = findOrCreateChild(activeTop, title, kind)
      } else {
        ensureTop(title, kind)
      }
      applyScopeKind(kind)
      return true
    }

    if (started || nested || opensGroup) {
      const kind = sectionKindFromTitle(full, tokens)
      const { version: versionNote, rest } = extractVersionNote(full)
      const title = rest || full
      if (versionNote && !systemsFromTokens(tokenizeLabel(title)).length && title.length <= 40) {
        // Bare version heading inside an archive spoiler.
        version = versionNote
        entryTitle = null
        part = null
        flushEntry()
        return true
      }
      if (nested) {
        active = findOrCreateChild(activeTop, title, kind === 'other' ? 'archive' : kind)
      } else {
        ensureTop(title, kind === 'other' ? 'archive' : kind)
      }
      applyScopeKind(active.kind)
      if (versionNote) version = versionNote
      return true
    }

    return false
  }

  function handleLink(node: AnyNode): void {
    const el = $(node)
    if (isImageLink($, el)) return
    const url = absolutize(el.attr('href'))
    if (!url) return
    const label = elementText(el) || url
    const unofficial = linkMarkedUnofficial($, node) || /\*$/.test(label)
    const cleanLabel = label.replace(/\*+$/, '').trim() || label
    const type = contentTypeFromLabel(cleanLabel, contentType)

    if (allowRelated || type !== 'game' || active.kind === 'extras' || active.kind === 'patches' || active.kind === 'other') {
      if (!isRelatedUrl(url) && !isMirrorUrl(url)) return
      // Platform builds still prefer hoster mirrors; related labels become own entries.
      if (
        (type !== 'game' && !isHosterLabel(cleanLabel)) ||
        allowRelated ||
        active.kind === 'extras' ||
        active.kind === 'patches' ||
        active.kind === 'other'
      ) {
        if (/^compressed\b|compress(?:ed)?\s+version/i.test(cleanLabel)) {
          // Compressed builds stay navigable under the current release context.
          const previousType = contentType
          contentType = 'game'
          const previousSystems = systems
          systems = systems.length ? systems : []
          const previousTitle = entryTitle
          const previousVariants = variants
          entryTitle = cleanLabel
          variants = [...new Set([...variants, 'compressed'])]
          flushEntry()
          addMirror({ label: cleanLabel, url }, unofficial)
          contentType = previousType
          systems = previousSystems
          entryTitle = previousTitle
          variants = previousVariants
          flushEntry()
          return
        }
        addRelated({ label: cleanLabel, url }, type, unofficial)
        return
      }
    }

    if (!isMirrorUrl(url)) return
    // Skip obvious non-hoster related links accidentally accepted by broad http match.
    if (!isHosterLabel(cleanLabel) && /f95zone\.(?:to|com|ninja)\/(?:threads|posts)\b/i.test(url)) {
      addRelated({ label: cleanLabel, url }, type === 'game' ? 'extra' : type, unofficial)
      return
    }
    addMirror({ label: cleanLabel, url }, unofficial)
  }

  function walk(list: AnyNode[], nested: boolean): void {
    for (const node of list) {
      if (node.type === 'text') {
        const text = normalize(node.data || '')
        const plain = text.match(/^(extras?|patches?|others?|other|splits?)\s*:/i)
        if (plain && (started || nested)) {
          applyLabel(plain[1], '', nested)
        }
        continue
      }
      if (node.type !== 'tag') continue
      const el = $(node)

      if (el.is('a[href]')) {
        handleLink(node)
        continue
      }

      if (el.is('.bbCodeSpoiler')) {
        const spoiler = spoilerTitle($, node as Element)
        const snapshot = {
          activeTop,
          active,
          systems,
          variants,
          version,
          entryTitle,
          part,
          contentType,
          allowRelated,
          started,
          blocked
        }
        flushEntry()
        if (!isGenericSpoilerTitle(spoiler)) {
          applyLabel(spoiler, '', true)
        }
        walk(spoilerBody($, node as Element).contents().toArray(), true)
        activeTop = snapshot.activeTop
        active = snapshot.active
        systems = snapshot.systems
        variants = snapshot.variants
        version = snapshot.version
        entryTitle = snapshot.entryTitle
        part = snapshot.part
        contentType = snapshot.contentType
        allowRelated = snapshot.allowRelated
        started = snapshot.started || started
        blocked = snapshot.blocked
        flushEntry()
        continue
      }

      const heading = !el.find('a, img').length && el.is(LABEL_SELECTOR) ? elementText(el) : ''
      if (heading && applyLabel(heading, headingDetail($, node), nested)) continue

      if (el.is('br')) continue
      walk(el.contents().toArray(), nested)
    }
  }

  walk(nodes, false)

  // Promote first non-empty root; drop empty placeholder.
  return topLevels.filter((section) => sectionHasContent(section) || section === root)
}

function sectionHasContent(section: MutableSection): boolean {
  if (section.entries.some((entry) => entry.mirrors.length || entry.parts.length)) return true
  return section.sections.some(sectionHasContent)
}

function finalizeEntry(entry: MutableEntry): DownloadEntry | null {
  const filtered = entry.parts
    .filter((part) => part.mirrors.length)
    .sort((a, b) => a.index - b.index)

  const inferredTotal = filtered.length > 1 ? Math.max(...filtered.map((part) => part.index)) : null
  const parts = filtered.map((part) => ({
    index: part.index,
    total: part.total || inferredTotal,
    label: part.label,
    mirrors: dedupeMirrors(part.mirrors)
  }))

  const mirrors = parts.length ? [] : dedupeMirrors(entry.mirrors)
  if (!mirrors.length && !parts.length) return null

  return {
    contentType: entry.contentType,
    systems: entry.systems,
    variants: entry.variants,
    version: entry.version,
    title: entry.title,
    unofficial: entry.unofficial,
    mirrors,
    parts
  }
}

function dedupeMirrors(mirrors: DownloadMirror[]): DownloadMirror[] {
  const seen = new Set<string>()
  const out: DownloadMirror[] = []
  for (const mirror of mirrors) {
    if (!mirror.url || seen.has(mirror.url)) continue
    seen.add(mirror.url)
    out.push(mirror)
  }
  return out
}

function mergeCompatibleEntries(entries: MutableEntry[]): MutableEntry[] {
  const merged: MutableEntry[] = []
  for (const entry of entries) {
    const last = merged[merged.length - 1]
    if (
      last &&
      entryKey(last) === entryKey(entry) &&
      ((last.parts.length > 0 && entry.parts.length > 0) ||
        (last.parts.length === 0 && entry.parts.length === 0 && last.mirrors.length && entry.mirrors.length))
    ) {
      if (entry.parts.length) {
        for (const part of entry.parts) {
          const existing = last.parts.find((item) => item.index === part.index)
          if (existing) {
            for (const mirror of part.mirrors) {
              if (!existing.mirrors.some((item) => item.url === mirror.url)) existing.mirrors.push(mirror)
            }
          } else {
            last.parts.push(part)
          }
        }
      } else {
        for (const mirror of entry.mirrors) {
          if (!last.mirrors.some((item) => item.url === mirror.url)) last.mirrors.push(mirror)
        }
      }
      if (entry.unofficial) last.unofficial = true
      continue
    }
    merged.push(entry)
  }
  return merged
}

function finalizeSections(sections: MutableSection[]): DownloadSection[] {
  const out: DownloadSection[] = []
  for (const section of sections) {
    const entries = mergeCompatibleEntries(section.entries)
      .map(finalizeEntry)
      .filter((entry): entry is DownloadEntry => Boolean(entry))
    const children = finalizeSections(section.sections)
    if (!entries.length && !children.length) continue

    let kind = section.kind
    let title = section.title
    if (!title && kind === 'current' && !entries.length && children.length) continue
    if (!title && kind === 'current' && entries.every((entry) => entry.contentType !== 'game') && children.length === 0) {
      // Root that only collected extras somehow — keep as extras.
      if (entries.every((entry) => entry.contentType !== 'game')) {
        kind = 'extras'
        title = 'Extras'
      }
    }

    out.push({
      title,
      kind,
      sections: children,
      entries
    })
  }
  return out
}
