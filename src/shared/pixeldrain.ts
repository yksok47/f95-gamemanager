import {
  asRecord,
  hostnameOf,
  jsonValue,
  parseHttpUrl,
  type ConnectorFetch
} from './connector'
import type { ConnectorListedFile } from './connector-files'

const PAGE_HOSTS = new Set(['pixeldrain.com', 'pixeldrain.net'])
const FILE_PATH = /^\/u\/([^/?#]+)/i
const LIST_PATH = /^\/l\/([^/?#]+)/i
const API_FILE_PATH = /^\/api\/file\/([^/?#,]+)/i

export function isPixeldrainHost(hostname: string): boolean {
  return PAGE_HOSTS.has(hostnameOf(hostname))
}

export function pixeldrainOrigin(href: string): string {
  const url = parseHttpUrl(href)
  if (!url || !isPixeldrainHost(url.hostname)) return 'https://pixeldrain.com'
  return `https://${hostnameOf(url.hostname)}`
}

export function pixeldrainFileIdFromUrl(href: string): string | null {
  const url = parseHttpUrl(href)
  if (!url || !isPixeldrainHost(url.hostname)) return null
  const file = url.pathname.match(FILE_PATH)?.[1] || url.pathname.match(API_FILE_PATH)?.[1]
  const id = file?.trim()
  return id || null
}

export function pixeldrainListIdFromUrl(href: string): string | null {
  const url = parseHttpUrl(href)
  if (!url || !isPixeldrainHost(url.hostname)) return null
  const id = url.pathname.match(LIST_PATH)?.[1]?.trim()
  return id || null
}

/** True for Pixeldrain file or list pages, not a constructed `/api/file` URL. */
export function isPixeldrainPageUrl(href: string): boolean {
  return Boolean(pixeldrainFileIdFromUrl(href) || pixeldrainListIdFromUrl(href))
}

export function pixeldrainDownloadUrl(origin: string, fileId: string): string {
  return `${origin}/api/file/${encodeURIComponent(fileId)}?download`
}

export function pixeldrainFilesFromListBody(
  body: string
): Array<{ id: string; name?: string; size?: number }> {
  const json = asRecord(jsonValue(body))
  const files = json?.files
  if (!Array.isArray(files)) return []
  const out: Array<{ id: string; name?: string; size?: number }> = []
  for (const item of files) {
    const row = asRecord(item)
    if (typeof row?.id !== 'string' || !row.id) continue
    out.push({
      id: row.id,
      name: typeof row.name === 'string' ? row.name : undefined,
      size: typeof row.size === 'number' ? row.size : undefined
    })
  }
  return out
}

export async function resolvePixeldrainFromFetch(
  pageUrl: string,
  fetchImpl: ConnectorFetch
): Promise<string | ConnectorListedFile[] | null> {
  const origin = pixeldrainOrigin(pageUrl)
  const fileId = pixeldrainFileIdFromUrl(pageUrl)
  if (fileId) return pixeldrainDownloadUrl(origin, fileId)

  const listId = pixeldrainListIdFromUrl(pageUrl)
  if (!listId) return null
  try {
    const response = await fetchImpl(`${origin}/api/list/${encodeURIComponent(listId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    })
    const files = pixeldrainFilesFromListBody(await response.text())
    if (!files.length) return null
    return files.map((file) => ({
      name: file.name || file.id,
      size: file.size,
      url: pixeldrainDownloadUrl(origin, file.id)
    }))
  } catch (error) {
    console.warn('[pixeldrain] could not resolve download URL', error)
    return null
  }
}
