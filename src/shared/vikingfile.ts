const PAGE_HOSTS = new Set(['vikingfile.com', 'vik1ngfile.site'])
const PAGE_PATH = /^\/f\/([^/?#]+)/i
const DOWNLOAD_HREF =
  /id=["']download-link["'][^>]*href=["']([^"']+)["']/i
const DOWNLOAD_HREF_BEFORE =
  /href=["']([^"']+)["'][^>]*id=["']download-link["']/i

export type VikingFileMeta = {
  exist: boolean
  hash: string | null
  name?: string
  size?: number
}

export type ConnectorFetch = (
  input: string,
  init?: {
    method?: string
    headers?: Record<string, string>
    body?: string
    redirect?: RequestRedirect
  }
) => Promise<Pick<Response, 'ok' | 'url' | 'headers' | 'text'>>

function hostnameOf(value: string): string {
  return value.toLowerCase().replace(/\.$/, '').replace(/^(www|m)\./, '')
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

export function isVikingFileHost(hostname: string): boolean {
  return PAGE_HOSTS.has(hostnameOf(hostname))
}

export function vikingFileHashFromUrl(href: string): string | null {
  const url = parseUrl(href)
  if (!url || !isVikingFileHost(url.hostname)) return null
  const match = url.pathname.match(PAGE_PATH)
  const hash = match?.[1]?.trim()
  return hash || null
}

/** True for VikingFile landing pages (`/f/<id>`), not a generated CDN file URL. */
export function isVikingFilePageUrl(href: string): boolean {
  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    return Boolean(vikingFileHashFromUrl(url.href))
  } catch {
    return false
  }
}

export function isVikingFileCdnUrl(href: string): boolean {
  if (!href || isVikingFilePageUrl(href)) return false
  try {
    const url = new URL(href)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
    if (isVikingFileHost(url.hostname)) {
      return /\.(zip|7z|rar|exe|rpy|rpyc|rpa|rpu)(?:$|\?)/i.test(url.pathname)
    }
    return /vikingfile|vik1ngfile/i.test(url.hostname)
  } catch {
    return false
  }
}

function firstHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const href = decodeHtml(value).trim()
  if (!/^https?:\/\//i.test(href)) return null
  if (isVikingFilePageUrl(href)) return null
  return href
}

/** Reads `{ link }` from the captcha POST, or a filled-in `#download-link`. */
export function vikingFileDirectUrlFromBody(body: string): string | null {
  const trimmed = body.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const json: unknown = JSON.parse(trimmed)
      if (json && typeof json === 'object' && !Array.isArray(json)) {
        const link = firstHttpUrl((json as { link?: unknown }).link)
        if (link) return link
      }
    } catch {
      // Fall through to HTML.
    }
  }
  const candidates = [body.match(DOWNLOAD_HREF)?.[1], body.match(DOWNLOAD_HREF_BEFORE)?.[1]]
  for (const raw of candidates) {
    const href = firstHttpUrl(raw)
    if (href) return href
  }
  return null
}

export function vikingFileMetaFromCheckBody(body: string, hash: string): VikingFileMeta | null {
  try {
    const json: unknown = JSON.parse(body.trim())
    const row = Array.isArray(json) ? json[0] : json
    if (!row || typeof row !== 'object') return null
    const record = row as { exist?: unknown; hash?: unknown; name?: unknown; size?: unknown }
    return {
      exist: record.exist === true,
      hash: typeof record.hash === 'string' ? record.hash : hash,
      name: typeof record.name === 'string' ? record.name : undefined,
      size: typeof record.size === 'number' ? record.size : undefined
    }
  } catch {
    return null
  }
}

export async function checkVikingFile(
  pageUrl: string,
  fetchImpl: ConnectorFetch
): Promise<VikingFileMeta | null> {
  const hash = vikingFileHashFromUrl(pageUrl)
  if (!hash) return null
  try {
    const response = await fetchImpl('https://vikingfile.com/api/check-file', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://vikingfile.com',
        Referer: 'https://vikingfile.com/'
      },
      body: `hash=${encodeURIComponent(hash)}`
    })
    const text = await response.text()
    return vikingFileMetaFromCheckBody(text, hash)
  } catch {
    return null
  }
}

/**
 * Resolve a VikingFile landing URL to a direct file URL using HTTP only.
 * Turnstile-gated pages return null so the caller can finish the flow in a window.
 */
export async function resolveVikingFileFromFetch(
  pageUrl: string,
  fetchImpl: ConnectorFetch
): Promise<string | null> {
  if (!isVikingFilePageUrl(pageUrl)) return null
  try {
    const response = await fetchImpl(pageUrl, {
      method: 'GET',
      headers: {
        Accept: 'application/json, text/html;q=0.9',
        Referer: 'https://vikingfile.com/'
      },
      redirect: 'follow'
    })
    if (isVikingFileCdnUrl(response.url)) return response.url
    const text = await response.text()
    return vikingFileDirectUrlFromBody(text)
  } catch (error) {
    console.warn('[vikingfile] could not resolve download URL', error)
    return null
  }
}
