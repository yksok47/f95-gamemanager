import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { AnyNode, Element } from 'domhandler'
import { extractThreadId } from '../../parse'

const HOST = 'https://f95zone.to'
const LABEL_SELECTOR = 'b, strong, u, h1, h2, h3, h4'

export type OverviewField = {
  label: string
  value: string
}

export type OverviewLink = {
  label: string
  url: string
}

export type OverviewRelatedGame = {
  threadId: number
  title: string
  url: string
}

/** Basic thread meta not covered by description / changelog / downloads / gallery. */
export type OverviewMeta = {
  fields: OverviewField[]
  creatorLinks: OverviewLink[]
  relatedGames: OverviewRelatedGame[]
  releaseDate: string
  updatedAt: string
}

/**
 * General information from first-post HTML: version, developer, dates, OS,
 * language, creator social links, related game thread links, etc.
 */
export function parseOverview(html: string): OverviewMeta {
  if (!html.trim()) {
    return { fields: [], creatorLinks: [], relatedGames: [], releaseDate: '', updatedAt: '' }
  }

  const $ = load(`<div id="overview-root">${html}</div>`)
  const root = $('#overview-root')
  return parseMeta($, root.contents().toArray())
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

function unique<T>(items: T[], keyFn: (item: T) => string): T[] {
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
  return /^(thread updated|thread update|updated|last updated|last update|update date|release date|released|publication date|published|first release|developer|developers|creator|author|developer\/publisher|publisher|modder|mod version|original game|prequel|sequel|version|release version|engine|status|censored|censorship|os|platform|language|languages|other games|related games|more games|also (?:try|check|play)|store|website|socials|resolution|voices|translation)$/.test(
    text
  )
}

function isNotesLabel(raw: string): boolean {
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

function isDownloadsMarker(raw: string): boolean {
  const text = labelText(raw)
  return /^(downloads?|download links?|download here|download now|mirrors?|links?)$/i.test(text)
}

function isChangelogLabel(raw: string): boolean {
  const text = labelText(raw)
  return /^(change[\s-]*logs?|what'?s new|update history|patch notes?)$/i.test(text)
}

/** End of the meta block — later sections are handled by other parsers. */
function isStopLabel(raw: string): boolean {
  const text = labelText(raw)
  if (!text) return false
  if (isChangelogLabel(text) || isDownloadsMarker(text) || isNotesLabel(text)) return true
  const section = classifySection(text)
  if (section === 'changelog' || section === 'downloads' || section === 'gallery') return true
  return /fan ?(art|signatures?)|^signatures?$|credits?|special thanks/i.test(text)
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
      /\b(patreon|subscribestar|subscribe star|itch\.io|itchio|discord|ko-fi|kofi|boosty|gumroad|twitter|fanbox|linktree|carrd|steam|bluesky|blue[\s-]?sky)\b/gi,
      ''
    )
    .replace(/[\s]*[|/\-–—·•]+[\s]*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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

function spoilerTitle($: CheerioAPI, el: Element): string {
  return normalize(
    $(el).find('.bbCodeSpoiler-button-title, .bbCodeSpoiler-button .button-text, button').first().text()
  )
}

function hasMeaningfulParts(parts: string[]): boolean {
  return Boolean(parts.join('').replace(/[:\s]/g, ''))
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
    if (el.is(LABEL_SELECTOR)) break
    if (el.is('.bbCodeSpoiler')) {
      if (!hasMeaningfulParts(parts)) {
        parts.push(elementText(spoilerBody($, node as Element)))
      }
      break
    }
    // `<b>Genre</b>:<br><spoiler>…` — skip blank breaks and take the spoiler body.
    if (el.is('br')) {
      if (hasMeaningfulParts(parts)) break
      node = node.next
      continue
    }
    if (el.is('div, ul, ol, table, blockquote')) break
    parts.push(el.text())
    node = node.next
  }
  return normalize(parts.join(' ')).replace(/^[\s:]+/, '').trim()
}

function fieldValue(fields: OverviewField[], names: string[]): string {
  for (const field of fields) {
    if (names.some((name) => field.label.toLowerCase() === name)) return field.value
  }
  return ''
}

function parseMeta($: CheerioAPI, nodes: AnyNode[]): OverviewMeta {
  const allFields: OverviewField[] = []
  const seen = new Set<string>()
  const creatorLinks: OverviewLink[] = []
  const relatedGames: OverviewRelatedGame[] = []

  function walk(list: AnyNode[]): void {
    for (const node of list) {
      if (node.type !== 'tag') continue
      const el = $(node)

      if (el.is('a[href]')) {
        const url = absolutize(el.attr('href'))
        if (!url) continue
        const threadId = extractThreadId(url)
        if (threadId) {
          relatedGames.push({ threadId, title: elementText(el) || `Thread ${threadId}`, url })
        } else if (isCreatorHost(url)) {
          creatorLinks.push({ label: creatorLinkLabel(url), url })
        }
        continue
      }

      if (el.is('.bbCodeSpoiler')) {
        const title = spoilerTitle($, node as Element)
        if (isStopLabel(title)) continue
        walk(spoilerBody($, node as Element).contents().toArray())
        continue
      }

      if (el.is(LABEL_SELECTOR) && !el.find('a, img').length) {
        const label = labelText(elementText(el))
        if (isStopLabel(label)) return
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
