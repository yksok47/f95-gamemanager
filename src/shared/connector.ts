/** Shared HTTP shape so connector logic can run in tests without Electron. */
export type ConnectorFetch = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    redirect?: RequestRedirect
  }
) => Promise<Pick<Response, 'ok' | 'status' | 'url' | 'headers' | 'text'>>

const ARCHIVE_NAME = /\.(zip|7z|rar)(?:$|\.)/i

export function hostnameOf(value: string): string {
  return value.toLowerCase().replace(/\.$/, '').replace(/^(www|m)\./, '')
}

export function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

export function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

export function firstHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const href = decodeHtml(value).trim()
  if (!/^https?:\/\//i.test(href)) return null
  return href
}

export function jsonValue(body: string): unknown {
  const trimmed = body.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

/** Prefer a zip/7z/rar when a folder lists several files; otherwise the largest. */
export function pickPreferredFile<T extends { name?: string | null; size?: number }>(
  files: readonly T[]
): T | null {
  if (!files.length) return null
  if (files.length === 1) return files[0] ?? null
  const archives = files.filter((file) => file.name && ARCHIVE_NAME.test(file.name))
  const pool = archives.length ? archives : files
  return pool.reduce((best, item) => ((item.size ?? 0) > (best.size ?? 0) ? item : best))
}

export function absoluteUrl(value: string, base: string): string | null {
  try {
    return new URL(decodeHtml(value).trim(), base).href
  } catch {
    return null
  }
}

export function redirectUrlFromHeaders(
  headers: { get(name: string): string | null },
  base: string
): string | null {
  const raw = headers.get('location') || headers.get('hx-redirect')
  if (!raw) return null
  return absoluteUrl(raw, base)
}
