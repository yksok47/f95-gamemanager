import { createHash } from 'crypto'

const CDN_HOSTS = new Set([
  'preview.f95zone.to',
  'preview.f95zone.com',
  'preview.f95zone.ninja',
  'attachments.f95zone.to',
  'attachments.f95zone.com',
  'attachments.f95zone.ninja'
])

/** Renderer retry nonce — not part of the remote image identity. */
const RETRY_PARAM = '_gm_retry'

export function isF95CdnImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && CDN_HOSTS.has(parsed.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function normalizeImageCacheUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.searchParams.delete(RETRY_PARAM)
    return parsed.href
  } catch {
    return url
  }
}

export function imageCacheFileName(url: string): string {
  return createHash('sha256').update(normalizeImageCacheUrl(url)).digest('hex')
}

export function f95ImgProtocolUrl(imageUrl: string): string {
  return `f95-img://cache/?u=${encodeURIComponent(imageUrl)}`
}

export function originalUrlFromProtocolRequest(requestUrl: string): string | null {
  try {
    const original = new URL(requestUrl).searchParams.get('u')
    if (!original || !isF95CdnImageUrl(original)) return null
    return original
  } catch {
    return null
  }
}

export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (bytes.length >= 6) {
    const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5])
    if (header === 'GIF87a' || header === 'GIF89a') return 'image/gif'
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  if (
    bytes.length >= 12 &&
    bytes[4] === 0x66 &&
    bytes[5] === 0x74 &&
    bytes[6] === 0x79 &&
    bytes[7] === 0x70
  ) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
  }
  return null
}
