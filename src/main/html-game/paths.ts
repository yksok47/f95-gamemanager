import { extname, isAbsolute, relative, resolve } from 'path'

export const HTML_GAME_SCHEME = 'htmlgame'
export const HTML_GAME_PARTITION = 'persist:htmlgame'

export const HTML_GAME_SCHEME_PRIVILEGES = {
  scheme: HTML_GAME_SCHEME,
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true,
    bypassCSP: true
  }
}

const HOST_PREFIX = 't'

export function htmlGameOrigin(threadId: number): string {
  return `${HTML_GAME_SCHEME}://${HOST_PREFIX}${threadId}`
}

export function htmlGameUrl(threadId: number, relativePath: string): string {
  const trimmed = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  const encoded = trimmed.split('/').filter(Boolean).map(encodeURIComponent).join('/')
  return `${htmlGameOrigin(threadId)}/${encoded}`
}

export function parseHtmlGameRequest(url: string): { threadId: number; pathname: string } | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${HTML_GAME_SCHEME}:`) return null
    const threadId = threadIdFromHost(parsed.hostname)
    if (!threadId) return null
    return { threadId, pathname: parsed.pathname || '/' }
  } catch {
    return null
  }
}

/** Chromium treats a numeric host as IPv4 (`162898` → `0.2.124.82`), so hosts are `t{id}`. */
export function threadIdFromHost(host: string): number | null {
  const prefixed = host.match(/^t(\d+)$/i)
  if (prefixed) {
    const id = Number(prefixed[1])
    return Number.isInteger(id) && id > 0 ? id : null
  }
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4) {
    const id =
      ((Number(ipv4[1]) * 256 + Number(ipv4[2])) * 256 + Number(ipv4[3])) * 256 + Number(ipv4[4])
    return Number.isInteger(id) && id > 0 ? id : null
  }
  const raw = Number(host)
  if (Number.isInteger(raw) && raw > 0) return raw
  return null
}

export function safeGameFile(root: string, pathname: string): string | null {
  let decoded = pathname.split('?')[0] || ''
  try {
    decoded = decodeURIComponent(decoded)
  } catch {
    return null
  }
  const relativePath = decoded.replace(/^\/+/, '')
  if (!relativePath) return null
  const base = resolve(root)
  const file = resolve(base, relativePath)
  const rel = relative(base, file)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null
  return file
}

export function mimeForGameFile(filePath: string): string | undefined {
  return GAME_MIME[extname(filePath).toLowerCase()]
}

const GAME_MIME: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'application/ogg',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml'
}
