import { protocol, session } from 'electron'
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { getAppPaths } from '../paths'
import { F95_CDN_FILTER } from './cdn-request-headers'
import {
  f95ImgProtocolUrl,
  imageCacheFileName,
  normalizeImageCacheUrl,
  originalUrlFromProtocolRequest,
  sniffImageMime
} from './image-cache-key'

const F95_REFERER = 'https://f95zone.to/'
const FETCH_TIMEOUT_MS = 20000
const FETCH_CONCURRENCY = 6

export const F95_IMG_SCHEME = {
  scheme: 'f95-img',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true
  }
}

type CachedImage = { bytes: Buffer; mime: string }

/** URLs currently downloaded by the cache — must not be redirected back into f95-img. */
const bypassRedirect = new Set<string>()
const inflight = new Map<string, Promise<CachedImage>>()
const fetchWaiters: Array<() => void> = []
let activeFetches = 0
let registered = false

function cacheDir(): string {
  return getAppPaths().imageCacheDir
}

function cachePath(url: string): string {
  return join(cacheDir(), imageCacheFileName(url))
}

function markBypass(url: string): void {
  bypassRedirect.add(url)
  bypassRedirect.add(normalizeImageCacheUrl(url))
}

function unmarkBypass(url: string): void {
  bypassRedirect.delete(url)
  bypassRedirect.delete(normalizeImageCacheUrl(url))
}

function shouldBypassRedirect(url: string): boolean {
  return bypassRedirect.has(url) || bypassRedirect.has(normalizeImageCacheUrl(url))
}

async function withFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeFetches >= FETCH_CONCURRENCY) {
    await new Promise<void>((resolve) => fetchWaiters.push(resolve))
  }
  activeFetches += 1
  try {
    return await fn()
  } finally {
    activeFetches -= 1
    fetchWaiters.shift()?.()
  }
}

export async function initF95ImageCache(): Promise<void> {
  const dir = cacheDir()
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
}

export async function clearF95ImageCache(): Promise<void> {
  inflight.clear()
  bypassRedirect.clear()
  fetchWaiters.length = 0
  activeFetches = 0
  await rm(cacheDir(), { recursive: true, force: true })
}

async function readCachedFile(filePath: string): Promise<Buffer | null> {
  try {
    const bytes = await readFile(filePath)
    return bytes.length ? bytes : null
  } catch {
    return null
  }
}

async function writeCachedFile(filePath: string, bytes: Buffer): Promise<void> {
  const tmpPath = `${filePath}.tmp`
  await mkdir(cacheDir(), { recursive: true })
  await writeFile(tmpPath, bytes)
  try {
    await rename(tmpPath, filePath)
  } catch {
    await unlink(tmpPath).catch(() => undefined)
    if (!(await readCachedFile(filePath))) {
      await writeFile(filePath, bytes)
    }
  }
}

function imageResponse(bytes: Buffer, mime: string): Response {
  return new Response(new Blob([bytes as BlobPart], { type: mime }), {
    headers: {
      'content-type': mime,
      'cache-control': 'public, max-age=31536000, immutable'
    }
  })
}

async function fetchRemoteImageOnce(url: string): Promise<CachedImage> {
  markBypass(url)
  try {
    const response = await session.defaultSession.fetch(url, {
      bypassCustomProtocolHandlers: true,
      credentials: 'include',
      headers: {
        Referer: F95_REFERER,
        Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'User-Agent': session.defaultSession.getUserAgent()
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
    })
    if (!response.ok) {
      throw new Error(`CDN ${response.status}`)
    }

    const bytes = Buffer.from(await response.arrayBuffer())
    const sniffed = sniffImageMime(bytes)
    const contentType = response.headers.get('content-type') || ''
    const mime =
      sniffed || (contentType.toLowerCase().startsWith('image/') ? contentType.split(';')[0].trim() : '')
    if (!bytes.length || !mime) {
      throw new Error('CDN response was not an image')
    }

    await writeCachedFile(cachePath(url), bytes).catch((error) => {
      console.warn('[image-cache] failed to write', url, error)
    })
    return { bytes, mime }
  } finally {
    unmarkBypass(url)
  }
}

async function fetchRemoteImage(url: string): Promise<CachedImage> {
  try {
    return await fetchRemoteImageOnce(url)
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return fetchRemoteImageOnce(url)
  }
}

async function loadImage(url: string): Promise<CachedImage> {
  const keyUrl = normalizeImageCacheUrl(url)
  const pending = inflight.get(keyUrl)
  if (pending) return pending

  const task = (async () => {
    const cached = await readCachedFile(cachePath(keyUrl))
    if (cached) {
      const mime = sniffImageMime(cached) || 'application/octet-stream'
      return { bytes: cached, mime }
    }
    return withFetchSlot(() => fetchRemoteImage(keyUrl))
  })()

  inflight.set(keyUrl, task)
  try {
    return await task
  } finally {
    inflight.delete(keyUrl)
  }
}

export function registerF95ImageCache(): void {
  if (registered) return
  registered = true

  protocol.handle('f95-img', async (request) => {
    const url = originalUrlFromProtocolRequest(request.url)
    if (!url) return new Response(null, { status: 404 })
    try {
      const image = await loadImage(url)
      return imageResponse(image.bytes, image.mime)
    } catch (error) {
      console.warn('[image-cache] fetch failed', url, error)
      return new Response(null, { status: 502 })
    }
  })

  session.defaultSession.webRequest.onBeforeRequest(F95_CDN_FILTER, (details, callback) => {
    if (details.method !== 'GET' || details.resourceType !== 'image' || shouldBypassRedirect(details.url)) {
      callback({})
      return
    }
    callback({ redirectURL: f95ImgProtocolUrl(details.url) })
  })
}
