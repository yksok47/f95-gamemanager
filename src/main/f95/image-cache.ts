import { protocol, session } from 'electron'
import { mkdir, readFile, rename, rm, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { getAppPaths } from '../paths'
import {
  imageCacheFileName,
  normalizeImageCacheUrl,
  originalUrlFromProtocolRequest,
  sniffImageMime
} from './image-cache-key'

const F95_REFERER = 'https://f95zone.to/'
const FETCH_TIMEOUT_MS = 20000

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

const inflight = new Map<string, Promise<CachedImage>>()
let registered = false

function cacheDir(): string {
  return getAppPaths().imageCacheDir
}

function cachePath(url: string): string {
  return join(cacheDir(), imageCacheFileName(url))
}

export async function initF95ImageCache(): Promise<void> {
  const dir = cacheDir()
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
}

export async function clearF95ImageCache(): Promise<void> {
  inflight.clear()
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
    return fetchRemoteImage(keyUrl)
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
}
