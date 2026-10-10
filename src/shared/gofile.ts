import {
  asRecord,
  firstHttpUrl,
  hostnameOf,
  jsonValue,
  parseHttpUrl
} from './connector'
import type { ConnectorListedFile } from './connector-files'

const FOLDER_PATH = /^\/d\/([^/?#]+)/i
const CONFIG_WT = /appdata\.wt\s*=\s*["']([^"']+)["']/i
const FETCH_WT = /(?:fetchData|wt)\s*[:=]\s*["']([^"']+)["']/i

export const GOFILE_WT_SALTS = [
  '12af056dacea0b',
  '9844d94d963d30',
  '5d4f7g8sd45fsd'
] as const

export type GoFileItem = {
  id: string
  type: 'file' | 'folder' | string
  name?: string
  size?: number
  link?: string
}

export function isGoFileHost(hostname: string): boolean {
  const host = hostnameOf(hostname)
  return host === 'gofile.io' || host.endsWith('.gofile.io')
}

export function gofileIdFromUrl(href: string): string | null {
  const url = parseHttpUrl(href)
  if (!url || hostnameOf(url.hostname) !== 'gofile.io') return null
  const id = url.pathname.match(FOLDER_PATH)?.[1]?.trim()
  return id || null
}

/** True for GoFile share pages (`/d/<id>`), not store CDN URLs. */
export function isGoFilePageUrl(href: string): boolean {
  return Boolean(gofileIdFromUrl(href))
}

export function gofileAccountTokenFromBody(body: string): string | null {
  const json = asRecord(jsonValue(body))
  const data = asRecord(json?.data) ?? json
  const token = data?.token
  return typeof token === 'string' && token ? token : null
}

export function gofileWebsiteTokenFromScript(source: string): string | null {
  return source.match(CONFIG_WT)?.[1] || source.match(FETCH_WT)?.[1] || null
}

/** Quoted 8–24 char tokens from `wt.obf.js` — used as salt candidates. */
export function gofileSaltsFromScript(source: string): string[] {
  const found: string[] = []
  const seen = new Set<string>(GOFILE_WT_SALTS)
  for (const match of source.matchAll(/["']([a-zA-Z0-9]{8,24})["']/g)) {
    const salt = match[1]
    if (!salt || seen.has(salt)) continue
    seen.add(salt)
    found.push(salt)
  }
  return found
}

export function gofileItemsFromContentsBody(body: string): GoFileItem[] {
  const json = asRecord(jsonValue(body))
  const data = asRecord(json?.data)
  if (!data) return []
  const items: GoFileItem[] = []

  function push(row: Record<string, unknown>): void {
    const id = typeof row.id === 'string' ? row.id : ''
    const type = typeof row.type === 'string' ? row.type : 'file'
    const link = firstHttpUrl(row.link) ?? undefined
    items.push({
      id,
      type,
      name: typeof row.name === 'string' ? row.name : undefined,
      size: typeof row.size === 'number' ? row.size : undefined,
      link
    })
  }

  const children = asRecord(data.children)
  if (children) {
    for (const value of Object.values(children)) {
      const row = asRecord(value)
      if (row) push(row)
    }
  } else if (data.type === 'file' || data.link) {
    push(data)
  }
  return items
}

export function gofileListedFilesFromContentsBody(body: string): ConnectorListedFile[] | null {
  const json = asRecord(jsonValue(body))
  if (json && json.status && json.status !== 'ok') return null
  return gofileItemsFromContentsBody(body)
    .filter((item) => item.type !== 'folder' && item.link)
    .map((item) => ({
      name: item.name || 'download',
      size: item.size,
      url: item.link
    }))
}
