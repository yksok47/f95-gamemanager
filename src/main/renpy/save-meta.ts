import { protocol } from 'electron'
import type { RenpySaveFile } from '@shared/types'
import { mapLimit } from '../disk-usage'
import { openZipReader } from '../zip-read'

const META_CACHE_MAX = 400
const SHOT_CACHE_MAX = 120
const JSON_LIMITS = { maxCompressed: 256 * 1024, maxUncompressed: 256 * 1024 }
const SHOT_LIMITS = { maxCompressed: 4 * 1024 * 1024, maxUncompressed: 8 * 1024 * 1024 }
const SHOT_NAMES = ['screenshot.png', 'screenshot.jpg', 'screenshot.jpeg']

type SaveMeta = Pick<RenpySaveFile, 'saveName' | 'gameVersion' | 'renpyVersion' | 'savedAt' | 'thumbnailUrl'>

type MetaCacheEntry = SaveMeta & { mtime: number; size: number }
type ShotCacheEntry = { mtime: number; size: number; mime: string; bytes: Buffer }

const metaCache = new Map<string, MetaCacheEntry>()
const shotCache = new Map<string, ShotCacheEntry>()

function cacheGet<T>(map: Map<string, T>, key: string): T | undefined {
  const value = map.get(key)
  if (!value) return undefined
  map.delete(key)
  map.set(key, value)
  return value
}

function cacheSet<T>(map: Map<string, T>, key: string, value: T, max: number): void {
  if (map.has(key)) map.delete(key)
  map.set(key, value)
  while (map.size > max) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function formatRenpyVersion(value: unknown): string {
  if (Array.isArray(value) && value.length >= 3) {
    const parts = value.slice(0, 3).map((part) => (typeof part === 'number' ? String(part) : textValue(part)))
    if (parts.every(Boolean)) return parts.join('.')
  }
  return textValue(value)
}

function parseCtime(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(n) || n <= 0) return undefined
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n)
}

function parseJsonObject(bytes: Buffer): Record<string, unknown> | null {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '').trim()
  if (!text.startsWith('{')) return null
  try {
    const parsed = JSON.parse(text) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function screenshotName(names: string[]): string | null {
  const lower = new Set(names.map((name) => name.toLowerCase()))
  return SHOT_NAMES.find((name) => lower.has(name)) ?? null
}

export function saveThumbnailUrl(filePath: string, modifiedAt: number): string {
  return `save-thumb://shot/?p=${encodeURIComponent(filePath)}&m=${Math.round(modifiedAt)}`
}

function parseThumbnailRequest(requestUrl: string): { path: string; mtime: number } | null {
  try {
    const url = new URL(requestUrl)
    const filePath = url.searchParams.get('p') || ''
    const mtime = Number(url.searchParams.get('m') || 0)
    if (!filePath) return null
    return { path: filePath, mtime }
  } catch {
    return null
  }
}

export function invalidateSaveMeta(filePath: string): void {
  metaCache.delete(filePath)
  shotCache.delete(filePath)
}

const SAVE_IO_LIMIT = 2
let saveIoActive = 0
const saveIoWait: Array<() => void> = []

async function withSaveIo<T>(work: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    if (saveIoActive < SAVE_IO_LIMIT) {
      saveIoActive += 1
      resolve()
      return
    }
    saveIoWait.push(() => {
      saveIoActive += 1
      resolve()
    })
  })
  try {
    return await work()
  } finally {
    saveIoActive -= 1
    saveIoWait.shift()?.()
  }
}

export async function attachSaveMeta<T extends Pick<RenpySaveFile, 'path' | 'size' | 'modifiedAt' | 'kind'>>(
  files: T[]
): Promise<Array<T & SaveMeta>> {
  return mapLimit(files, SAVE_IO_LIMIT, async (file) => {
    if (file.kind === 'persistent') return file
    const meta = await readSaveMeta(file.path, file.size, file.modifiedAt)
    return { ...file, ...meta }
  })
}

export async function readSaveMeta(filePath: string, size: number, mtime: number): Promise<SaveMeta> {
  const cached = cacheGet(metaCache, filePath)
  if (cached && cached.size === size && cached.mtime === mtime) {
    return {
      saveName: cached.saveName,
      gameVersion: cached.gameVersion,
      renpyVersion: cached.renpyVersion,
      thumbnailUrl: cached.thumbnailUrl,
      savedAt: cached.savedAt
    }
  }

  return withSaveIo(async () => {
    const empty: SaveMeta = {}
    const zip = await openZipReader(filePath).catch(() => null)
    if (!zip) {
      cacheSet(metaCache, filePath, { ...empty, mtime, size }, META_CACHE_MAX)
      return empty
    }

    try {
      const jsonBytes = zip.has('json') ? await zip.read('json', JSON_LIMITS) : null
      const parsed = jsonBytes ? parseJsonObject(jsonBytes) : null
      let saveName = textValue(parsed?._save_name)
      if (!parsed && zip.has('extra_info')) {
        const extraBytes = await zip.read('extra_info', JSON_LIMITS)
        saveName = extraBytes?.toString('utf8').trim() || ''
      }
      const gameVersion = textValue(parsed?._version)
      const renpyVersion = formatRenpyVersion(parsed?._renpy_version)
      const savedAt = parseCtime(parsed?._ctime)
      const thumbnailUrl = screenshotName(zip.names) ? saveThumbnailUrl(filePath, mtime) : undefined
      const meta: SaveMeta = {
        saveName: saveName || undefined,
        gameVersion: gameVersion || undefined,
        renpyVersion: renpyVersion || undefined,
        thumbnailUrl,
        savedAt
      }
      cacheSet(metaCache, filePath, { ...meta, mtime, size }, META_CACHE_MAX)
      return meta
    } finally {
      await zip.close()
    }
  })
}

function sniffImage(bytes: Buffer): { mime: string; bytes: Buffer } | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { mime: 'image/png', bytes }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', bytes }
  }
  return null
}

export async function readSaveScreenshot(
  filePath: string,
  mtime: number
): Promise<{ mime: string; bytes: Buffer } | null> {
  const cached = cacheGet(shotCache, filePath)
  if (cached && cached.mtime === mtime) return { mime: cached.mime, bytes: cached.bytes }

  return withSaveIo(async () => {
    const zip = await openZipReader(filePath).catch(() => null)
    if (!zip) return null
    try {
      const name = screenshotName(zip.names)
      if (!name) return null
      const raw = await zip.read(name, SHOT_LIMITS)
      if (!raw) return null
      const image = sniffImage(raw)
      if (!image) return null
      cacheSet(shotCache, filePath, { mtime, size: image.bytes.length, mime: image.mime, bytes: image.bytes }, SHOT_CACHE_MAX)
      return image
    } finally {
      await zip.close()
    }
  })
}

export const SAVE_THUMB_SCHEME = {
  scheme: 'save-thumb',
  privileges: {
    standard: true,
    secure: true,
    supportFetchAPI: true,
    corsEnabled: true,
    stream: true
  }
}

export function registerSaveThumbProtocol(): void {
  protocol.handle('save-thumb', async (request) => {
    const parsed = parseThumbnailRequest(request.url)
    if (!parsed) return new Response('Not found', { status: 404 })
    const image = await readSaveScreenshot(parsed.path, parsed.mtime).catch(() => null)
    if (!image) return new Response('Not found', { status: 404 })
    return new Response(new Blob([image.bytes as BlobPart], { type: image.mime }), {
      headers: {
        'content-type': image.mime,
        'cache-control': 'public, max-age=31536000, immutable'
      }
    })
  })
}
