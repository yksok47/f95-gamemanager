import { mkdir, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type {
  RequestLogBody,
  RequestLogDetail,
  RequestLogEntry,
  RequestLogHeader,
  RequestLogService
} from '@shared/types'
import { isF95CdnImageUrl } from './f95/image-cache-key'

export const REQUEST_LOG_LIMIT = 300
export const REQUEST_LOG_BODY_LIMIT = 256 * 1024
const DETAIL_BYTE_BUDGET = 32 * 1024 * 1024

const HIDDEN = '[hidden]'
const SECRET_HEADERS = new Set(['cookie', 'set-cookie', 'authorization', 'proxy-authorization'])
const SECRET_FIELD = /pass(?:word|wd)?$|secret|^_xftoken$/i

const STATIC_EXT =
  /\.(?:png|jpe?g|gif|webp|avif|bmp|svg|ico|css|js|mjs|map|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg)$/i

type StoredDetail = Omit<RequestLogDetail, keyof RequestLogEntry> & { bytes: number }

export type RequestLogInput = {
  service: RequestLogService
  method?: string
  url: string
  ok: boolean
  status?: number
  startedAt?: number
  error?: unknown
  note?: string
  requestHeaders?: HeadersInit
  requestBody?: BodyInit | null
  responseHeaders?: Headers | null
  responseBody?: string | null
}

const entries: RequestLogEntry[] = []
const details = new Map<number, StoredDetail>()
const listeners = new Set<(items: RequestLogEntry[]) => void>()
let detailBytes = 0
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

function headerList(headers: HeadersInit | Headers | null | undefined): RequestLogHeader[] {
  if (!headers) return []
  const out: RequestLogHeader[] = []
  new Headers(headers).forEach((value, name) => {
    out.push({ name, value: SECRET_HEADERS.has(name.toLowerCase()) ? HIDDEN : value })
  })
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

function contentTypeOf(headers: RequestLogHeader[]): string {
  return headers.find((header) => header.name.toLowerCase() === 'content-type')?.value.toLowerCase() || ''
}

function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_FIELD.test(key) ? HIDDEN : redactJson(item)
    ])
  )
}

function redactForm(text: string): string {
  const params = new URLSearchParams(text)
  const out = new URLSearchParams()
  params.forEach((value, key) => out.append(key, SECRET_FIELD.test(key) ? HIDDEN : value))
  return out.toString()
}

export function redactBodyText(text: string, contentType: string): string {
  const trimmed = text.trimStart()
  if (contentType.includes('json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(redactJson(JSON.parse(text)), null, 2)
    } catch {
      if (contentType.includes('json')) return text
    }
  }
  if (contentType.includes('x-www-form-urlencoded')) return redactForm(text)
  return text
}

function requestBodyText(body: BodyInit | null | undefined): string | null {
  if (body == null) return null
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (body instanceof Blob) return `[binary data, ${body.size} bytes]`
  if (body instanceof ArrayBuffer) return `[binary data, ${body.byteLength} bytes]`
  if (ArrayBuffer.isView(body)) return `[binary data, ${body.byteLength} bytes]`
  if (body instanceof FormData) {
    const lines: string[] = []
    body.forEach((value, key) => {
      const shown = SECRET_FIELD.test(key)
        ? HIDDEN
        : typeof value === 'string'
          ? value
          : `[file ${value.name}, ${value.size} bytes]`
      lines.push(`${key}: ${shown}`)
    })
    return lines.join('\n')
  }
  return '[streamed body]'
}

function logBody(text: string | null | undefined, contentType: string): RequestLogBody | null {
  if (text == null) return null
  const shown = redactBodyText(text, contentType)
  const size = Buffer.byteLength(text, 'utf8')
  const truncated = shown.length > REQUEST_LOG_BODY_LIMIT
  return { text: truncated ? shown.slice(0, REQUEST_LOG_BODY_LIMIT) : shown, size, truncated }
}

function detailSize(detail: Omit<StoredDetail, 'bytes'>): number {
  const headers = [...detail.requestHeaders, ...detail.responseHeaders].reduce(
    (sum, header) => sum + header.name.length + header.value.length,
    0
  )
  return (detail.requestBody?.text.length ?? 0) + (detail.responseBody?.text.length ?? 0) + headers
}

function dropDetail(id: number): void {
  const detail = details.get(id)
  if (!detail) return
  detailBytes -= detail.bytes
  details.delete(id)
}

function errorMessage(error: unknown): string | undefined {
  if (error == null) return undefined
  if (error instanceof Error) return error.message
  return String(error)
}

function snapshot(): RequestLogEntry[] {
  return [...entries].reverse()
}

function emit(): void {
  const items = snapshot()
  for (const listener of listeners) listener(items)
}

function persistPayload(): string {
  return JSON.stringify({ version: 2, entries }, null, 2)
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
    console.warn('[request-log] persist failed', error)
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

function resetEntries(): void {
  entries.length = 0
  details.clear()
  detailBytes = 0
}

/**
 * Start writing the log to disk. Pass a file path to wipe that file and use it
 * for this session. Pass `null` to keep the log in memory only.
 */
export async function initRequestLog(filePath: string | null): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  persistFile = filePath
  resetEntries()
  nextId = 1
  await persistImmediately()
  emit()
}

export async function flushRequestLog(): Promise<void> {
  await persistImmediately()
}

export function recordRequest(input: RequestLogInput): void {
  if (input.service === 'f95zone' && !shouldLogF95Request(input.url)) return
  const at = Date.now()
  const entry: RequestLogEntry = {
    id: nextId++,
    at: input.startedAt ?? at,
    service: input.service,
    method: (input.method || 'GET').toUpperCase(),
    url: input.url,
    ok: input.ok,
    status: input.status,
    durationMs: input.startedAt != null ? Math.max(0, at - input.startedAt) : undefined,
    error: errorMessage(input.error)
  }
  entries.push(entry)

  const requestHeaders = headerList(input.requestHeaders)
  const responseHeaders = headerList(input.responseHeaders)
  const detail = {
    note: input.note,
    requestHeaders,
    requestBody: logBody(requestBodyText(input.requestBody), contentTypeOf(requestHeaders)),
    responseHeaders,
    responseBody: logBody(input.responseBody, contentTypeOf(responseHeaders))
  }
  const bytes = detailSize(detail)
  details.set(entry.id, { ...detail, bytes })
  detailBytes += bytes

  if (entries.length > REQUEST_LOG_LIMIT) {
    for (const dropped of entries.splice(0, entries.length - REQUEST_LOG_LIMIT)) dropDetail(dropped.id)
  }
  for (const id of details.keys()) {
    if (detailBytes <= DETAIL_BYTE_BUDGET || id === entry.id) break
    dropDetail(id)
  }
  emit()
  schedulePersist()
}

export function listRequestLog(): RequestLogEntry[] {
  return snapshot()
}

export function getRequestLogDetail(id: number): RequestLogDetail | null {
  const entry = entries.find((item) => item.id === id)
  const detail = details.get(id)
  if (!entry || !detail) return null
  return {
    ...entry,
    note: detail.note,
    requestHeaders: detail.requestHeaders,
    requestBody: detail.requestBody,
    responseHeaders: detail.responseHeaders,
    responseBody: detail.responseBody
  }
}

export async function clearRequestLog(): Promise<RequestLogEntry[]> {
  resetEntries()
  emit()
  await persistImmediately()
  return snapshot()
}

export function onRequestLogChange(listener: (items: RequestLogEntry[]) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
