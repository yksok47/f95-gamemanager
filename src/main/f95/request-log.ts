import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { F95RequestLogEntry } from '@shared/types'
import { isF95CdnImageUrl } from './image-cache-key'

export const F95_REQUEST_LOG_LIMIT = 300

const STATIC_EXT =
  /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|ico|css|js|mjs|map|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg)$/i

const entries: F95RequestLogEntry[] = []
const listeners = new Set<(items: F95RequestLogEntry[]) => void>()
let nextId = 1
let persistFile: string | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let writeChain: Promise<void> = Promise.resolve()

function isF95zoneHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return (
    host === 'f95zone.to' ||
    host.endsWith('.f95zone.to') ||
    host === 'f95zone.com' ||
    host.endsWith('.f95zone.com') ||
    host === 'f95zone.ninja' ||
    host.endsWith('.f95zone.ninja')
  )
}

export function shouldLogF95Request(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    if (!isF95zoneHost(parsed.hostname)) return false
    if (isF95CdnImageUrl(url)) return false
    const path = parsed.pathname.toLowerCase()
    if (STATIC_EXT.test(path)) return false
    return true
  } catch {
    return false
  }
}

function snapshot(): F95RequestLogEntry[] {
  return [...entries].reverse()
}

function emit(): void {
  const items = snapshot()
  for (const listener of listeners) listener(items)
}

function persistPayload(): string {
  return JSON.stringify({ version: 1, entries }, null, 2)
}

async function persistNow(): Promise<void> {
  const file = persistFile
  if (!file) return
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, persistPayload(), 'utf8')
}

function queuePersist(): void {
  if (!persistFile) return
  writeChain = writeChain.then(() => persistNow()).catch((error) => {
    console.warn('[f95-request-log] persist failed', error)
  })
}

function schedulePersist(): void {
  if (!persistFile) return
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    queuePersist()
  }, 400)
}

async function persistImmediately(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (!persistFile) return
  queuePersist()
  await writeChain
}

/**
 * Start writing the log to disk. Pass a file path to wipe that file and use it
 * for this session. Pass `null` to keep the log in memory only.
 */
export async function initF95RequestLog(filePath: string | null): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  persistFile = filePath
  entries.length = 0
  nextId = 1
  await persistImmediately()
  emit()
}

export async function flushF95RequestLog(): Promise<void> {
  await persistImmediately()
}

export function recordF95Request(input: {
  method: string
  url: string
  ok: boolean
  status?: number
}): void {
  if (!shouldLogF95Request(input.url)) return
  entries.push({
    id: nextId++,
    at: Date.now(),
    method: (input.method || 'GET').toUpperCase(),
    url: input.url,
    ok: input.ok,
    status: input.status
  })
  if (entries.length > F95_REQUEST_LOG_LIMIT) {
    entries.splice(0, entries.length - F95_REQUEST_LOG_LIMIT)
  }
  emit()
  schedulePersist()
}

export function listF95RequestLog(): F95RequestLogEntry[] {
  return snapshot()
}

export async function clearF95RequestLog(): Promise<F95RequestLogEntry[]> {
  entries.length = 0
  emit()
  await persistImmediately()
  return snapshot()
}

export function onF95RequestLogChange(
  listener: (items: F95RequestLogEntry[]) => void
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
