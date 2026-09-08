export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export const THREAD_URL_RE = /\/threads\/(?:[^/?#]*\.)?(\d+)/i

export const PREFIX_NODE_SELECTOR =
  '.label, .label-append, .labelLink, [class^="pre-"], [class*=" pre-"]'

const TITLE_PREFIXES = [
  "Ren'Py",
  'RenPy',
  'RPG Maker',
  'RPGM',
  'Unity',
  'Unreal Engine',
  'Unreal',
  'Godot',
  'HTML',
  'Java',
  'WebGL',
  'Wolf RPG',
  'Adrift',
  'Flash',
  'Others',
  'Completed',
  'Complete',
  'Ongoing',
  'Abandoned',
  'On Hold',
  'Cancelled',
  'Collection',
  'VN'
]

export function extractThreadId(value: string | undefined | null): number | null {
  if (!value) return null
  const match = value.match(THREAD_URL_RE)
  if (!match) return null
  const id = Number(match[1])
  return Number.isFinite(id) ? id : null
}

export function threadUrl(threadId: number): string {
  return `https://f95zone.to/threads/${threadId}/`
}

export type ParsedGameTitle = {
  title: string
  version: string
  creator: string
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isVersionTag(value: string): boolean {
  return /^(v?\d|ch\.?\s*\d|chapter|episode|ep\.?\s*\d|s\d|season|final|hotfix|public|beta|alpha|demo|day\s*\d)/i.test(
    value.trim()
  )
}

function stripLeadingPrefixes(text: string): string {
  let result = text
  let changed = true
  while (changed) {
    changed = false
    for (const prefix of TITLE_PREFIXES) {
      const pattern = new RegExp(`^${escapeRegExp(prefix)}(?=[A-Z]|\\s|\\[|$)`, 'i')
      if (pattern.test(result)) {
        result = result.replace(pattern, '').trim()
        changed = true
      }
    }
  }
  return result
}

export function parseGameTitle(raw: string): ParsedGameTitle {
  let text = raw.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim()
  text = stripLeadingPrefixes(text)

  const tags: string[] = []
  for (;;) {
    const match = text.match(/\s*\[([^\]]+)\]\s*$/)
    if (!match || match.index === undefined) break
    tags.unshift(match[1].trim())
    text = text.slice(0, match.index).trim()
  }

  let creator = ''
  let version = ''
  if (tags.length >= 2) {
    creator = tags[tags.length - 1]
    version = tags.slice(0, -1).join(' ')
  } else if (tags.length === 1) {
    if (isVersionTag(tags[0])) version = tags[0]
    else creator = tags[0]
  }

  return {
    title: text || stripLeadingPrefixes(raw.replace(/\s+/g, ' ').trim()),
    version,
    creator
  }
}

export function cleanThreadTitle(raw: string): string {
  return parseGameTitle(raw).title
}
