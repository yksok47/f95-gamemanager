import { copyFile, readFile, rename, writeFile } from 'fs/promises'
import { basename } from 'path'
import { deflateRawSync, deflateSync, gunzipSync, gzipSync, inflateRawSync, inflateSync } from 'zlib'
import type {
  RpgMakerSaveCodec,
  RpgMakerSaveEditKind,
  RpgMakerSaveEditPatch,
  RpgMakerSaveEditVar,
  RpgMakerSaveEditorData
} from '@shared/types'
import { pathExists, toFsPath } from '../win-path'
import {
  compressToBase64,
  compressToBase64Mv,
  decompressFromBase64,
  decompressFromBase64Mv
} from './lz-string'

/** MV `.rpgsave` is JSON in LZ-String Base64. MZ `.rmmzsave` is JSON in zlib/deflate/gzip. */

const MAX_COMPRESSED = 32 * 1024 * 1024
const MAX_JSON = 32 * 1024 * 1024
const MAX_ROWS = 20_000
const MAX_STRING_EDIT = 4096
const META_KEYS = new Set(['@', '@c', '@r'])

const ZLIB_CMF = new Set([0x78])
const ZLIB_FLG = new Set([0x01, 0x5e, 0x9c, 0xda])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function tryParseJson(text: string): unknown | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const start = trimmed[0]
  if (start !== '{' && start !== '[') return undefined
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return undefined
  }
}

function stringifySave(data: unknown): string {
  return JSON.stringify(data)
}

function bufferLooksUtf8Json(buf: Buffer): boolean {
  let i = 0
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) i = 3
  while (i < buf.length && (buf[i] === 0x20 || buf[i] === 0x09 || buf[i] === 0x0a || buf[i] === 0x0d)) i++
  return buf[i] === 0x7b || buf[i] === 0x5b
}

function inflateJson(buf: Buffer, inflate: (input: Buffer) => Buffer): unknown | undefined {
  try {
    const text = inflate(buf).toString('utf8')
    if (text.length > MAX_JSON) return undefined
    return tryParseJson(text)
  } catch {
    return undefined
  }
}

function decodeLz(text: string, decompress: (input: string) => string | null): unknown | undefined {
  try {
    const json = decompress(text.trim())
    if (!json || json.length > MAX_JSON) return undefined
    return tryParseJson(json)
  } catch {
    return undefined
  }
}

export function decodeSaveBuffer(buf: Buffer): { data: unknown; codec: RpgMakerSaveCodec } {
  if (!buf.length) throw new Error('That save is empty.')
  if (buf.length > MAX_COMPRESSED) throw new Error('That save is too large to edit.')

  if (bufferLooksUtf8Json(buf)) {
    const data = tryParseJson(buf.toString('utf8'))
    if (data !== undefined) return { data, codec: 'json' }
  }

  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    const data = inflateJson(buf, gunzipSync)
    if (data !== undefined) return { data, codec: 'gzip' }
  }

  if (buf.length >= 2 && ZLIB_CMF.has(buf[0]) && ZLIB_FLG.has(buf[1])) {
    const data = inflateJson(buf, inflateSync)
    if (data !== undefined) return { data, codec: 'zlib' }
  }

  const raw = inflateJson(buf, inflateRawSync)
  if (raw !== undefined) return { data: raw, codec: 'deflate' }

  const zlib = inflateJson(buf, inflateSync)
  if (zlib !== undefined) return { data: zlib, codec: 'zlib' }

  const text = buf.toString('utf8')
  const mv = decodeLz(text, decompressFromBase64Mv)
  if (mv !== undefined) return { data: mv, codec: 'lz-mv' }

  const modern = decodeLz(text, decompressFromBase64)
  if (modern !== undefined) return { data: modern, codec: 'lz-modern' }

  throw new Error('Could not decode that RPG Maker save.')
}

export function encodeSaveBuffer(data: unknown, codec: RpgMakerSaveCodec): Buffer {
  const json = stringifySave(data)
  if (json.length > MAX_JSON) throw new Error('Edited save is too large to write.')
  switch (codec) {
    case 'json':
      return Buffer.from(json, 'utf8')
    case 'lz-mv':
      return Buffer.from(compressToBase64Mv(json), 'utf8')
    case 'lz-modern':
      return Buffer.from(compressToBase64(json), 'utf8')
    case 'zlib':
      return deflateSync(Buffer.from(json, 'utf8'))
    case 'deflate':
      return deflateRawSync(Buffer.from(json, 'utf8'))
    case 'gzip':
      return gzipSync(Buffer.from(json, 'utf8'))
  }
}

function typeOf(value: unknown): RpgMakerSaveEditKind | null {
  if (value === null) return 'Null'
  if (typeof value === 'boolean') return 'Boolean'
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? 'Integer' : 'Number'
  }
  if (typeof value === 'string') return 'String'
  return null
}

function formatPath(path: string[]): string {
  let out = ''
  for (const part of path) {
    if (/^(?:0|[1-9]\d*)$/.test(part) || /^[@A-Za-z_$][\w$]*$/.test(part)) {
      out += out ? `.${part}` : part
    } else {
      out += `[${JSON.stringify(part)}]`
    }
  }
  return out
}

function makeRow(path: string[], value: unknown): RpgMakerSaveEditVar | null {
  const kind = typeOf(value)
  if (!kind) return null
  const leaf = path[path.length - 1] || ''
  const meta = META_KEYS.has(leaf)
  const tooLong = kind === 'String' && (value as string).length > MAX_STRING_EDIT
  return {
    path,
    displayName: formatPath(path),
    type: kind,
    value: value as RpgMakerSaveEditVar['value'],
    editable: !meta && kind !== 'Null' && !tooLong
  }
}

export function flattenSave(data: unknown, limit = MAX_ROWS): RpgMakerSaveEditVar[] {
  const rows: RpgMakerSaveEditVar[] = []
  const seen = new WeakSet<object>()

  function walk(value: unknown, path: string[], depth: number): void {
    if (rows.length >= limit || depth > 48) return
    if (value && typeof value === 'object') {
      if (seen.has(value)) return
      seen.add(value)
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length && rows.length < limit; i++) {
          walk(value[i], [...path, String(i)], depth + 1)
        }
        return
      }
      if (isPlainObject(value)) {
        for (const key of Object.keys(value)) {
          if (rows.length >= limit) return
          walk(value[key], [...path, key], depth + 1)
        }
      }
      return
    }
    const row = makeRow(path, value)
    if (row) rows.push(row)
  }

  if (data === undefined) return rows
  if (data === null || typeof data !== 'object') {
    const row = makeRow(['value'], data)
    if (row) rows.push(row)
    return rows
  }
  walk(data, [], 0)
  return rows
}

function getAt(root: unknown, path: string[]): unknown {
  let current: unknown = root
  for (const part of path) {
    if (Array.isArray(current)) {
      const index = Number(part)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
      continue
    }
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, part)) return undefined
    current = current[part]
  }
  return current
}

function setAt(root: unknown, path: string[], value: boolean | number | string): void {
  if (!path.length) throw new Error('Missing variable path.')
  let current: unknown = root
  for (let i = 0; i < path.length - 1; i++) {
    const part = path[i]
    if (Array.isArray(current)) {
      const index = Number(part)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new Error('That save changed on disk. Reload and try again.')
      }
      current = current[index]
      continue
    }
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, part)) {
      throw new Error('That save changed on disk. Reload and try again.')
    }
    current = current[part]
  }
  const leaf = path[path.length - 1]
  if (Array.isArray(current)) {
    const index = Number(leaf)
    if (!Number.isInteger(index) || index < 0 || index >= current.length) {
      throw new Error('That save changed on disk. Reload and try again.')
    }
    current[index] = value
    return
  }
  if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, leaf)) {
    throw new Error('That save changed on disk. Reload and try again.')
  }
  current[leaf] = value
}

function sameKind(before: unknown, value: boolean | number | string): boolean {
  if (typeof value === 'boolean') return before === true || before === false
  if (typeof value === 'string') return typeof before === 'string'
  return typeof before === 'number' && Number.isFinite(before)
}

export function applySavePatches(data: unknown, patches: RpgMakerSaveEditPatch[]): unknown {
  for (const patch of patches) {
    const before = getAt(data, patch.path)
    if (!sameKind(before, patch.value)) {
      throw new Error('That save changed on disk. Reload and try again.')
    }
    if (typeof patch.value === 'number') {
      if (!Number.isFinite(patch.value)) throw new Error('Numbers must be finite.')
      if (Number.isInteger(before as number) && !Number.isInteger(patch.value)) {
        const name = formatPath(patch.path)
        throw new Error(`'${name}' needs a whole number.`)
      }
    }
    if (typeof patch.value === 'string' && patch.value.length > MAX_STRING_EDIT) {
      throw new Error('That text is too long to store in the save.')
    }
    setAt(data, patch.path, patch.value)
  }
  return data
}

export function sanitizeSavePatches(patches: unknown): RpgMakerSaveEditPatch[] {
  if (!Array.isArray(patches)) return []
  const out: RpgMakerSaveEditPatch[] = []
  const seen = new Set<string>()
  for (const item of patches) {
    if (!item || typeof item !== 'object') continue
    const rec = item as { path?: unknown; value?: unknown }
    if (!Array.isArray(rec.path) || !rec.path.length) continue
    const path = rec.path.map((part) => String(part))
    if (path.some((part) => part === '')) continue
    if (path.some((part) => META_KEYS.has(part))) continue
    const key = path.join('\0')
    if (seen.has(key)) continue
    const value = rec.value
    if (typeof value === 'boolean') {
      seen.add(key)
      out.push({ path, value })
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      seen.add(key)
      out.push({ path, value })
      continue
    }
    if (typeof value === 'string' && value.length <= MAX_STRING_EDIT) {
      seen.add(key)
      out.push({ path, value })
    }
  }
  return out
}

export async function readSaveEditor(filePath: string): Promise<RpgMakerSaveEditorData> {
  if (!pathExists(filePath)) throw new Error('That save is missing.')
  const buf = await readFile(toFsPath(filePath))
  const { data, codec } = decodeSaveBuffer(buf)
  return {
    path: filePath,
    name: basename(filePath),
    codec,
    variables: flattenSave(data)
  }
}

export async function applySaveEditor(filePath: string, patches: unknown): Promise<void> {
  if (!pathExists(filePath)) throw new Error('That save is missing.')
  const unique = sanitizeSavePatches(patches)
  if (!unique.length) return

  const buf = await readFile(toFsPath(filePath))
  const { data, codec } = decodeSaveBuffer(buf)
  applySavePatches(data, unique)
  const next = encodeSaveBuffer(data, codec)
  if (next.equals(buf)) return

  const bakPath = `${filePath}.bak`
  if (!pathExists(bakPath)) await copyFile(toFsPath(filePath), toFsPath(bakPath))
  const tmpPath = `${filePath}.tmp`
  await writeFile(toFsPath(tmpPath), next)
  await rename(toFsPath(tmpPath), toFsPath(filePath))
}
