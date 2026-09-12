import { load, type CheerioAPI, type Cheerio } from 'cheerio'
import type { AnyNode, Element } from 'domhandler'

const LABEL_SELECTOR = 'b, strong, u, h1, h2, h3, h4'

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

const VERSION_TOKEN = /\bv?\d+(?:[._]\d+)+[a-z0-9._+-]*|\bwip[._-]?\d+/i

/** True for mid-sentence / announcement text that should not start an entry. */
function looksLikeProse(text: string): boolean {
  if (/[.!?]"?$/.test(text)) return true
  if (
    /\b(?:will be|imported from|should|would|have been|has been|is now|are now|available (?:to|for)|for everyone|you can|you should|this (?:issue|bug|update)|specifically|currently|works fine|brings you|is done|here is|this is|there is)\b/i.test(
      text
    )
  ) {
    return true
  }
  if (/^changes?\s+from\b/i.test(text)) return true
  if (/^change[\s-]*logs?\s+for\s+the\b/i.test(text)) return true
  if (/\b(?:prior to that|latest release)\b/i.test(text)) return true
  if (
    /\b(?:added|released|includes?|contains?)\s*$/i.test(text) &&
    !/^(?:v?\d|version|ver\.?|update|patch|build|ch|episode|ep\.?|wip)/i.test(text)
  ) {
    return true
  }
  return false
}

/** "The Twist 0.52" / "Ren'py Ver 3.0-Unity Match Ver 3.2" — not "from 0.11 will be fine". */
function isTitleVersionHeading(text: string): boolean {
  if (text.split(/\s+/).length > 10) return false
  const match = VERSION_TOKEN.exec(text)
  if (!match || match.index === undefined) return false
  const before = text.slice(0, match.index).trim()
  const after = text.slice(match.index + match[0].length).trim()
  if (before.split(/\s+/).filter(Boolean).length > 5) return false
  // Mid-clause versions: "imported from 0.11 will…" — not short headers like "New in 0.7.5b".
  if (/\b(?:from|in|into|since|until|with|by|on|at|of|for)\s*$/i.test(before)) {
    const beforeWords = before.split(/\s+/).filter(Boolean).length
    if (beforeWords >= 3) return false
    if (/\b(?:will|should|would|can|may|must|is|are|was|were|have|has|had)\b/i.test(after)) return false
  }
  if (/\b(?:will|should|would|can|may|must|is|are|was|were|have|has|had|works|missing|but)\b/i.test(after)) {
    return false
  }
  // Sentence continuation after the version ("Update. Our new features"), not "Ver 3.2".
  if (/\.\s+[A-Za-z]/.test(after) || /\.$/.test(after)) return false
  return true
}

function isVersionHeading(raw: string): boolean {
  const text = labelText(raw)
  if (!text || text.length > 90) return false
  if (isMetaFieldLabel(text)) return false
  if (/^[-–—*•]/.test(text)) return false
  if (looksLikeProse(text)) return false
  if (/^(?:changes?\s+in|fixed|added|updated|removed|improved)\b/i.test(text) && !/^v?\d/i.test(text)) {
    return false
  }

  const startsWithVersion =
    /^(?:version|ver\.?|update|patch|hotfix|release|build)\s+v?\d/i.test(text) ||
    /^v?\d+(?:[._]\d+)+/i.test(text) ||
    /^v\d+[a-z]?\b/i.test(text) ||
    /^ch(?:apter)?\.?\s*\d+/i.test(text) ||
    /^(?:episode|ep\.?|season|day|week)\s*\d+/i.test(text) ||
    /^wip[._-]?\d+/i.test(text)
  if (startsWithVersion) {
    // "0.8.5c works fine, but…" / "Version 0.11.1 is now available…"
    const after = text
      .replace(/^(?:version|ver\.?|update|patch|hotfix|release|build)\s+/i, '')
      .replace(/^v?\d+(?:[._]\d+)+[a-z0-9._+-]*/i, '')
      .replace(/^v\d+[a-z]?\b/i, '')
      .replace(/^ch(?:apter)?\.?\s*\d+[a-z0-9._+-]*/i, '')
      .replace(/^(?:episode|ep\.?|season|day|week)\s*\d+[a-z0-9._+-]*/i, '')
      .replace(/^wip[._-]?\d+/i, '')
      .trim()
    if (/\b(?:works|missing|but|however|although|because|brings|done|available|everyone)\b/i.test(after)) {
      return false
    }
    if (after.length > 50 && /,/.test(after)) return false
    return true
  }

  // "Changelog (wip.7944)" / "Changelog v0.12.2" / "Changelog 0.11Public to 0.12.2beta"
  if (/^change[\s-]*logs?\b/i.test(text)) {
    const rest = text.replace(/^change[\s-]*logs?\s*/i, '')
    if (!rest) return true
    if (VERSION_TOKEN.test(rest) || /\([^)]*\d[^)]*\)/.test(rest)) {
      return rest.length <= 60 && !looksLikeProse(rest)
    }
    return rest.length <= 40 && rest.split(/\s+/).length <= 4
  }

  if (isTitleVersionHeading(text)) return true

  if (classifySection(text)) return false
  return /^(?:whats new|what'?s new)\b/i.test(text) && VERSION_TOKEN.test(text)
}

/** Plain-text version dividers such as `-- Changelog v0.12.2.9 --`. */
function isVersionLine(raw: string): boolean {
  let text = labelText(raw).replace(/^[-–—=\s]+/, '').replace(/[-–—=\s]+$/, '')
  text = text.replace(/^spoiler:\s*/i, '')
  if (!text || text.length > 90) return false
  if (looksLikeProse(text)) return false
  if (/^change[\s-]*logs?$/i.test(text)) return true
  return isVersionHeading(text)
}

function versionLabel(raw: string): string {
  let cleaned = labelText(raw).replace(/^[-–—=\s]+/, '').replace(/[-–—=\s]+$/, '')
  cleaned = cleaned.replace(/^spoiler:\s*/i, '')
  const changelogParen = cleaned.match(/^change[\s-]*logs?\s*\(([^)]+)\)/i)
  if (changelogParen) return labelText(changelogParen[1])
  const changelogVer = cleaned.match(/^change[\s-]*logs?\s+(v?[\w.+-]+)/i)
  if (changelogVer) {
    const rest = changelogVer[1]
    return VERSION_TOKEN.test(rest) || /^v?\d/i.test(rest) || /^wip/i.test(rest) ? rest : ''
  }
  if (/^change[\s-]*logs?\b/i.test(cleaned) && !VERSION_TOKEN.test(cleaned)) return ''
  // Keep full headings like "The Twist 0.52" / "v0.49 Beta2 - bugfix".
  return labelText(cleaned)
}

function isGenericSpoilerTitle(title: string): boolean {
  const text = labelText(title).replace(/^spoiler:\s*/i, '')
  return !text || /^(spoiler|show|hide|reveal|expand|more|click.*)$/i.test(text)
}

function spoilerTitle($: CheerioAPI, el: Element): string {
  const node = $(el)
  // Only this spoiler's button — never nested spoilers' titles.
  const button = node.children('button.bbCodeSpoiler-button, button, .bbCodeSpoiler-button').first()
  const scope = button.length ? button : node
  const titled = normalize(scope.find('.bbCodeSpoiler-button-title').first().text())
  if (titled) return titled
  return normalize(scope.find('.button-text').first().text())
}

function spoilerBody($: CheerioAPI, el: Element): Cheerio<AnyNode> {
  const node = $(el)
  // Prefer the direct content wrapper of this spoiler.
  const direct = node.children('.bbCodeSpoiler-content').first()
  const root = direct.length ? direct : node
  for (const selector of ['.bbCodeBlock-content', '.bbCodeSpoiler-content']) {
    const content = root.find(selector).first()
    if (content.length) return content
  }
  return root
}

function labelIsComplex(el: Cheerio<AnyNode>, label: string): boolean {
  return Boolean(el.find('br').length) || label.length > 90 || Boolean(el.find('.bbCodeSpoiler, .bbCodeBlock').length)
}

function hasContent(text: string): boolean {
  return normalize(text).replace(/[:;.,\-–—·•|]/g, '').length > 0
}

/** Convert changelog HTML fragments into readable plain text. */
function htmlToPlainText(html: string): string {
  if (!html.trim()) return ''
  const $ = load(`<div id="plain-root">${html}</div>`)
  const root = $('#plain-root')

  root.find('.bbCodeSpoiler-button, button').remove()
  root.find('.bbCodeSpoiler, .bbCodeBlock--spoiler').each((_, el) => {
    const body = $(el).find('.bbCodeBlock-content, .bbCodeSpoiler-content').first()
    $(el).replaceWith(body.length ? body.contents() : $(el).contents())
  })
  root.find('script, style, form, input, svg, noscript').remove()

  const parts: string[] = []

  function pushText(text: string): void {
    if (!text) return
    if (parts.length) {
      const prev = parts[parts.length - 1]
      if (/[^\s\n]$/.test(prev) && /^\S/.test(text)) parts.push(' ')
    }
    parts.push(text)
  }

  function walk(list: AnyNode[]): void {
    for (const node of list) {
      if (node.type === 'text') {
        pushText((node.data || '').replace(/\u00a0/g, ' '))
        continue
      }
      if (node.type !== 'tag') continue
      const el = $(node)
      if (el.is('br')) {
        parts.push('\n')
        continue
      }
      if (el.is('li')) {
        if (parts.length && !/\n$/.test(parts[parts.length - 1])) parts.push('\n')
        parts.push('- ')
        walk(node.children ?? [])
        continue
      }
      if (el.is('ul, ol')) {
        walk(node.children ?? [])
        if (parts.length && !/\n$/.test(parts[parts.length - 1])) parts.push('\n')
        continue
      }
      if (el.is('p, div, h1, h2, h3, h4, blockquote, tr')) {
        if (parts.length && !parts[parts.length - 1].endsWith('\n')) parts.push('\n')
        walk(node.children ?? [])
        parts.push('\n')
        continue
      }
      walk(node.children ?? [])
    }
  }

  walk(root.contents().toArray())

  return parts
    .join('')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function stripLeadingVersionHeading(text: string, version: string): string {
  if (!text) return text
  const lines = text.split('\n')
  const first = labelText(lines[0] || '')
  if (!first) return text
  if (version) {
    const v = version.toLowerCase()
    if (first.toLowerCase() === v || first.toLowerCase().startsWith(v)) {
      return lines.slice(1).join('\n').replace(/^\n+/, '').trim()
    }
  }
  if (isVersionLine(first)) {
    return lines.slice(1).join('\n').replace(/^\n+/, '').trim()
  }
  return text
}

/**
 * Parse changelog-section HTML into `[{ "<version>": "<plain text body>" }, ...]`.
 * Unclassified blocks use an empty-string version key.
 */
export function parseChangelog(html: string): Array<Record<string, string>> {
  if (!html.trim()) return []

  const $ = load(`<div id="changelog-parse-root">${html}</div>`)
  const root = $('#changelog-parse-root')
  const entries: Array<Record<string, string>> = []
  let version = ''
  let parts: string[] = []

  function flush(): void {
    const bodyHtml = parts.join('').replace(/^(?:\s|:|<br\s*\/?>)+/i, '')
    parts = []
    const pendingVersion = version
    version = ''
    let text = htmlToPlainText(bodyHtml)
    if (!hasContent(text)) return
    let label = versionLabel(pendingVersion)
    if (!label) {
      const firstLine =
        text
          .split('\n')
          .map((line) => line.trim())
          .find(Boolean) || ''
      if (isVersionLine(firstLine)) label = versionLabel(firstLine)
    }
    text = stripLeadingVersionHeading(text, label)
    if (!hasContent(text) && !label) return
    if (!hasContent(text)) text = ''
    entries.push({ [label]: text })
  }

  function startVersion(label: string): void {
    flush()
    version = label
  }

  function walk(list: AnyNode[]): void {
    for (const node of list) {
      if (node.type === 'text') {
        const text = normalize(node.data || '')
        if (!text) continue
        if (isVersionLine(text)) {
          startVersion(text)
          continue
        }
        parts.push(` ${text} `)
        continue
      }
      if (node.type !== 'tag') continue
      const el = $(node)
      if (el.is('br')) {
        if (parts.length) parts.push('<br>')
        continue
      }
      if (el.is('.bbCodeSpoiler')) {
        const title = spoilerTitle($, node as Element)
        const body = spoilerBody($, node as Element)
        const titled = !isGenericSpoilerTitle(title) && isVersionLine(title)
        if (titled) {
          // One spoiler per version — common older-changelog layout.
          startVersion(title)
          parts.push(body.html() || '')
          continue
        }
        // Untitled / container spoiler — parse its body in place.
        walk(body.contents().toArray())
        continue
      }
      if (el.is('.bbCodeBlock')) {
        const content = el.find('.bbCodeBlock-content').first()
        walk((content.length ? content : el).contents().toArray())
        continue
      }
      if (el.is('span') && !el.find('a, img, br').length) {
        const label = elementText(el)
        if (isVersionLine(label) && label.length <= 90) {
          startVersion(label)
          continue
        }
      }
      if (el.is(LABEL_SELECTOR) && !el.find('a, img').length) {
        const label = elementText(el)
        if (isChangelogLabel(label)) continue
        if (labelIsComplex(el, label)) {
          // Multi-line / nested bold blocks often wrap a version header + body.
          walk(node.children ?? [])
          continue
        }
        if (isVersionHeading(label) || isVersionLine(label)) {
          startVersion(label)
          continue
        }
      }
      parts.push($.html(el) || '')
    }
  }

  walk(root.contents().toArray())
  flush()
  return entries
}
