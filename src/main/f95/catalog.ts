import { load } from 'cheerio'
import {
  FALLBACK_PREFIXES,
  classifyPrefix,
  engineFromPrefixIds,
  prefixesFromUnknown
} from '@shared/prefixes'
import { saneLikeCount, saneViewCount } from '@shared/counts'
import { catalogTimestamp } from '@shared/updates'
import { sanitizeCatalogQuery } from './sanitize-query'
import type {
  CatalogFilters,
  CatalogGame,
  CatalogPage,
  CatalogPrefix,
  CatalogQuery,
  CatalogTag
} from '@shared/types'
import { F95Error, f95Fetch } from './http'

type LatestDataGame = {
  thread_id: number
  title: string
  creator: string
  version: string
  views: number
  likes: number
  prefixes?: number[]
  tags?: number[]
  rating: number
  cover?: string
  screens?: string[]
  date: string
  ts: number
  new?: boolean
}

type LatestDataResponse = {
  status?: string
  msg?: {
    data?: LatestDataGame[]
    pagination?: { page: number; total: number }
    count?: number
    prefixes?: unknown
    tags?: unknown
  }
}

/** SAM caps page size at 90; session options must match or list ignores higher `rows`. */
const CATALOG_ROWS_MAX = 90

const CATALOG_SESSION_OPTIONS = {
  newTab: 'true',
  ignoredThreads: 'hide',
  view: 'grid',
  notifications: 'nsfw',
  hover: '50',
  version: 'small',
  filterSticky: 'false',
  searchHighlight: 'true',
  rows: String(CATALOG_ROWS_MAX)
}

let cachedFilters: CatalogFilters | null = null
let filtersPromise: Promise<CatalogFilters> | null = null
let catalogOptionsReady = false
let catalogOptionsPromise: Promise<void> | null = null

async function applyCatalogSessionOptions(): Promise<void> {
  const body = new URLSearchParams(CATALOG_SESSION_OPTIONS)
  await f95Fetch('/sam/latest_alpha/latest_data.php?cmd=options', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json,text/plain,*/*',
      Origin: 'https://f95zone.to',
      Referer: 'https://f95zone.to/sam/latest_alpha/'
    },
    body: body.toString()
  })
}

/** Persist SAM list preferences on the session cookie so `rows` up to 90 is honored. */
async function ensureCatalogSessionOptions(): Promise<void> {
  if (catalogOptionsReady) return
  if (!catalogOptionsPromise) {
    catalogOptionsPromise = applyCatalogSessionOptions()
      .then(() => {
        catalogOptionsReady = true
      })
      .catch((error) => {
        console.warn('Could not set F95zone catalog session options', error)
      })
      .finally(() => {
        catalogOptionsPromise = null
      })
  }
  await catalogOptionsPromise
}

/** Call after login/logout so options are re-applied on the new session cookie. */
export function invalidateCatalogSessionOptions(): void {
  catalogOptionsReady = false
}

export function uniqueScreenUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of urls) {
    if (typeof item !== 'string') continue
    const url = item.trim()
    if (!url || seen.has(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

export function mapGame(entry: LatestDataGame, catalog?: CatalogPrefix[]): CatalogGame {
  const prefixes = entry.prefixes ?? []
  return {
    threadId: Number(entry.thread_id),
    title: entry.title,
    creator: entry.creator,
    version: typeof entry.version === 'string' ? entry.version : String(entry.version ?? ''),
    views: saneViewCount(entry.views),
    likes: saneLikeCount(entry.likes),
    rating: Number(entry.rating) || 0,
    coverUrl: entry.cover || null,
    updatedAt: '',
    timestamp: catalogTimestamp(entry.ts),
    isNew: Boolean(entry.new),
    threadUrl: `https://f95zone.to/threads/${entry.thread_id}/`,
    prefixes,
    tags: entry.tags ?? [],
    screens: uniqueScreenUrls(entry.screens),
    engine: engineFromPrefixIds(prefixes, catalog)
  }
}

function mapNamedRecord(
  value: Record<string, string> | undefined
): Array<{ id: number; name: string }> {
  if (!value) return []
  return Object.entries(value)
    .map(([id, name]) => ({ id: Number(id), name: String(name) }))
    .filter((item) => Number.isFinite(item.id) && item.name)
}

function tagsFromUnknown(value: unknown): CatalogTag[] {
  if (Array.isArray(value)) {
    const looksLikeGroups = value.some(
      (item) => item && typeof item === 'object' && Array.isArray((item as { tags?: unknown }).tags)
    )
    if (looksLikeGroups) {
      const out: CatalogTag[] = []
      for (const group of value) {
        if (!group || typeof group !== 'object') continue
        const items = (group as { tags?: unknown }).tags
        if (!Array.isArray(items)) continue
        out.push(...tagsFromUnknown(items))
      }
      return out
    }
    return value
      .map((item) => {
        if (typeof item === 'object' && item && 'id' in item && 'name' in item) {
          return { id: Number(item.id), name: String(item.name) }
        }
        return null
      })
      .filter((item): item is CatalogTag => item !== null && Number.isFinite(item.id) && item.id > 0)
  }
  if (value && typeof value === 'object') {
    const root = value as Record<string, unknown>
    if (Array.isArray(root.games)) return tagsFromUnknown(root.games)
    return mapNamedRecord(value as Record<string, string>)
  }
  return []
}

function extractBalancedJson(source: string, start: number): unknown | null {
  const open = source[start]
  if (open !== '{' && open !== '[') return null
  const close = open === '{' ? '}' : ']'
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < source.length; i++) {
    const c = source[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === open) depth += 1
    else if (c === close) {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(source.slice(start, i + 1)) as unknown
        } catch {
          return null
        }
      }
    }
  }
  return null
}

function extractEmbeddedJson(html: string, key: string): unknown | null {
  const objectMatch = new RegExp(`["']${key}["']\\s*:\\s*\\{`).exec(html)
  if (objectMatch) {
    return extractBalancedJson(html, objectMatch.index + objectMatch[0].length - 1)
  }
  const arrayMatch = new RegExp(`["']${key}["']\\s*:\\s*\\[`).exec(html)
  if (!arrayMatch) return null
  return extractBalancedJson(html, arrayMatch.index + arrayMatch[0].length - 1)
}

function finalizeFilters(prefixes: CatalogPrefix[], tags: CatalogTag[]): CatalogFilters {
  const uniquePrefixes = new Map<number, CatalogPrefix>()
  for (const prefix of FALLBACK_PREFIXES) uniquePrefixes.set(prefix.id, prefix)
  for (const prefix of prefixes) uniquePrefixes.set(prefix.id, prefix)
  const uniqueTags = new Map<number, CatalogTag>()
  for (const tag of tags) {
    uniqueTags.set(tag.id, tag)
  }
  return {
    prefixes: [...uniquePrefixes.values()],
    tags: [...uniqueTags.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
}

function parseFiltersFromHtml(html: string): CatalogFilters {
  const prefixes: CatalogPrefix[] = []
  const tags: CatalogTag[] = []
  const $ = load(html)

  const prefixTree =
    extractEmbeddedJson(html, 'prefixes') ??
    extractBalancedJson(html, html.search(/\{\s*"games"\s*:\s*\[\s*\{\s*"id"\s*:/))
  prefixes.push(...prefixesFromUnknown(prefixTree))
  tags.push(...tagsFromUnknown(extractEmbeddedJson(html, 'tags')))

  $('[data-prefix-id], option[data-prefix], select[name*="prefix" i] option').each((_, el) => {
    const node = $(el)
    const id = Number(node.attr('data-prefix-id') || node.attr('data-prefix') || node.attr('value'))
    const name = node.text().trim()
    if (Number.isFinite(id) && id > 0 && name && !prefixes.some((p) => p.id === id)) {
      prefixes.push(classifyPrefix(id, name))
    }
  })

  $('[data-tag-id], option[data-tag], select[name*="tag" i] option').each((_, el) => {
    const node = $(el)
    const id = Number(node.attr('data-tag-id') || node.attr('data-tag') || node.attr('value'))
    const name = node.text().trim()
    if (Number.isFinite(id) && id > 0 && name && !tags.some((t) => t.id === id)) {
      tags.push({ id, name })
    }
  })

  return finalizeFilters(prefixes, tags)
}

async function loadCatalogFilters(): Promise<CatalogFilters> {
  try {
    const { body } = await f95Fetch(
      `/sam/latest_alpha/latest_data.php?cmd=filters&cat=games&_=${Date.now()}`,
      { headers: { Accept: 'application/json,text/plain,*/*' } }
    )
    const parsed = JSON.parse(body) as LatestDataResponse
    if (parsed.status === 'ok' && parsed.msg) {
      const prefixes = prefixesFromUnknown(parsed.msg.prefixes)
      const tags = tagsFromUnknown(parsed.msg.tags)
      if (prefixes.length || tags.length) {
        return finalizeFilters(prefixes, tags)
      }
    }
  } catch {
    // Fall through to HTML scrape / hardcoded list.
  }

  const { body: html } = await f95Fetch('/sam/latest_alpha/')
  return parseFiltersFromHtml(html)
}

export async function fetchCatalogFilters(): Promise<CatalogFilters> {
  if (cachedFilters) return cachedFilters
  if (!filtersPromise) {
    filtersPromise = loadCatalogFilters()
      .then((filters) => {
        cachedFilters = filters
        return filters
      })
      .finally(() => {
        filtersPromise = null
      })
  }
  return filtersPromise
}

function appendArray(params: URLSearchParams, name: string, values?: number[]): void {
  if (!values?.length) return
  for (const value of values) {
    params.append(`${name}[]`, String(value))
  }
}

export async function fetchCatalog(query: CatalogQuery = {}): Promise<CatalogPage> {
  const page = query.page && query.page > 0 ? query.page : 1
  const requested = query.rows && query.rows > 0 ? query.rows : CATALOG_ROWS_MAX
  const rows = Math.min(requested, CATALOG_ROWS_MAX)
  const sort = query.sort ?? 'date'
  const category = query.category ?? 'games'
  const ts = Date.now()
  const search = sanitizeCatalogQuery(query.search ?? '')
  const creator = sanitizeCatalogQuery(query.creator ?? '')
  const filtersPromise = fetchCatalogFilters().catch(
    (): CatalogFilters => ({ prefixes: FALLBACK_PREFIXES, tags: [] })
  )

  await ensureCatalogSessionOptions()

  const params = new URLSearchParams()
  params.set('cmd', 'list')
  params.set('cat', category)
  params.set('page', String(page))
  params.set('sort', sort)
  params.set('rows', String(rows))
  params.set('ignored', 'hide')
  params.set('_', String(ts))
  if (search) params.set('search', search)
  if (creator) params.set('creator', creator)

  appendArray(params, 'prefixes', query.prefixes)
  appendArray(params, 'noprefixes', query.excludePrefixes)
  if ((query.prefixes?.length ?? 0) + (query.excludePrefixes?.length ?? 0) > 0) {
    params.set('prefixtype', query.prefixType ?? 'and')
  }

  appendArray(params, 'tags', query.tags)
  appendArray(params, 'notags', query.excludeTags)
  if ((query.tags?.length ?? 0) + (query.excludeTags?.length ?? 0) > 0) {
    params.set('tagtype', query.tagType ?? 'or')
  }

  const { body } = await f95Fetch(`/sam/latest_alpha/latest_data.php?${params.toString()}`, {
    headers: { Accept: 'application/json,text/plain,*/*' }
  })

  let parsed: LatestDataResponse
  try {
    parsed = JSON.parse(body) as LatestDataResponse
  } catch {
    throw new F95Error('Catalog response was not JSON. You may need to log in again.', 'parse')
  }

  if (parsed.status !== 'ok' || !parsed.msg?.data) {
    throw new F95Error('F95zone catalog request failed.', 'parse')
  }

  const filters = await filtersPromise
  return {
    games: parsed.msg.data.map((entry) => mapGame(entry, filters.prefixes)),
    page: parsed.msg.pagination?.page ?? page,
    totalPages: parsed.msg.pagination?.total ?? 1,
    totalGames: parsed.msg.count ?? parsed.msg.data.length
  }
}
