import { copyFile, rename, writeFile } from 'fs/promises'
import { basename } from 'path'
import { deflateRawSync } from 'zlib'
import type { RenpySaveEditKind, RenpySaveEditPatch, RenpySaveEditVar, RenpySaveEditorData } from '@shared/types'
import { openZipReader } from '../zip-read'
import { pathExists, toFsPath } from '../win-path'
import { genops, type PickleOp } from './pickle-ops'
import { parseStoreLeaves } from './pickle-load'
import { updateSaveSignatures } from './save-token'

const LOG_LIMITS = { maxCompressed: 32 * 1024 * 1024, maxUncompressed: 32 * 1024 * 1024 }
const COPY_LIMITS = { maxCompressed: 64 * 1024 * 1024, maxUncompressed: 64 * 1024 * 1024 }
const MAX_STRING_EDIT = 4096

type IntKind = 'BININT1' | 'BININT2' | 'BININT'
type StringKind = 'SHORT_BINUNICODE' | 'BINUNICODE' | 'BINUNICODE8'

const INT_WIDTH: Record<IntKind, { offset: number; min: number; max: number }> = {
  BININT1: { offset: 1, min: 0, max: 255 },
  BININT2: { offset: 1, min: 0, max: 65535 },
  BININT: { offset: 1, min: -2147483648, max: 2147483647 }
}

function isIntKind(kind: RenpySaveEditKind): kind is IntKind {
  return kind === 'BININT1' || kind === 'BININT2' || kind === 'BININT'
}

function isStringKind(kind: RenpySaveEditKind): kind is StringKind {
  return kind === 'SHORT_BINUNICODE' || kind === 'BINUNICODE' || kind === 'BINUNICODE8'
}

const CRC_TABLE = new Uint32Array(256)
for (let i = 0; i < 256; i++) {
  let c = i
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[i] = c >>> 0
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function displayName(name: string): string {
  return name.startsWith('store.') ? name.slice('store.'.length) : name
}

function displayValue(value: unknown): boolean | number | string | null {
  if (value === undefined) return null
  if (value === null || typeof value === 'boolean' || typeof value === 'number') return value
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return `<bytes ${value.length}>`
  return String(value)
}

/** Protocol 4+ uses MEMOIZE; older dumps memoize with PUT / BINPUT / LONG_BINPUT. */
const MEMO_PUT_OPS = new Set(['MEMOIZE', 'BINPUT', 'LONG_BINPUT', 'PUT'])

function skipMemoPuts(ops: PickleOp[], start: number): number {
  let j = start
  while (j < ops.length && MEMO_PUT_OPS.has(ops[j].name)) j++
  return j
}

function makeRow(
  name: string,
  opcode: string,
  arg: unknown,
  pos: number,
  extra?: Partial<Pick<RenpySaveEditVar, 'group' | 'groupKind' | 'field' | 'itemIndex' | 'itemStart' | 'itemEnd' | 'insertPos'>>
): RenpySaveEditVar {
  const row = makeRowValue(name, opcode, arg, pos)
  if (!extra) return row
  return { ...row, ...extra }
}

function makeRowValue(name: string, opcode: string, arg: unknown, pos: number): RenpySaveEditVar {
  if (opcode === 'NEWTRUE' || opcode === 'NEWFALSE') {
    return {
      name,
      displayName: displayName(name),
      type: 'Boolean',
      value: opcode === 'NEWTRUE',
      pos,
      editable: true,
      kind: 'bool'
    }
  }
  if (opcode === 'BININT1' || opcode === 'BININT2' || opcode === 'BININT') {
    const spec = INT_WIDTH[opcode]
    return {
      name,
      displayName: displayName(name),
      type: 'Integer',
      value: typeof arg === 'number' ? arg : Number(arg),
      pos,
      editable: true,
      kind: opcode,
      min: spec.min,
      max: spec.max
    }
  }
  if (opcode === 'NONE') {
    return { name, displayName: displayName(name), type: 'None', value: null, pos, editable: false, kind: null }
  }
  if (opcode === 'SHORT_BINUNICODE' || opcode === 'BINUNICODE' || opcode === 'BINUNICODE8') {
    const text = typeof arg === 'string' ? arg : String(arg ?? '')
    const tooLong = text.length > MAX_STRING_EDIT
    return {
      name,
      displayName: displayName(name),
      type: 'String',
      value: text,
      pos,
      editable: !tooLong,
      kind: tooLong ? null : opcode,
      max: MAX_STRING_EDIT
    }
  }
  if (opcode === 'SHORT_BINSTRING' || opcode === 'BINSTRING' || opcode === 'UNICODE' || opcode === 'STRING') {
    const text = typeof arg === 'string' ? arg : String(arg ?? '')
    return {
      name,
      displayName: displayName(name),
      type: 'String',
      value: text,
      pos,
      editable: false,
      kind: null
    }
  }
  if (opcode === 'BINFLOAT' || opcode === 'FLOAT') {
    return {
      name,
      displayName: displayName(name),
      type: 'Number',
      value: typeof arg === 'number' ? arg : Number(arg),
      pos,
      editable: false,
      kind: null
    }
  }
  return {
    name,
    displayName: displayName(name),
    type: opcode,
    value: displayValue(arg),
    pos,
    editable: false,
    kind: null
  }
}

function parseStoreVariablesLinear(logBytes: Buffer): RenpySaveEditVar[] {
  const ops = genops(logBytes)
  const rows: RenpySaveEditVar[] = []
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]
    if (
      (op.name === 'SHORT_BINUNICODE' || op.name === 'BINUNICODE' || op.name === 'BINUNICODE8') &&
      typeof op.arg === 'string' &&
      op.arg.startsWith('store.')
    ) {
      const j = skipMemoPuts(ops, i + 1)
      if (j < ops.length) {
        const value = ops[j]
        rows.push(makeRow(op.arg, value.name, value.arg, value.pos))
      }
    }
  }
  return rows
}

export function parseStoreVariables(logBytes: Buffer): RenpySaveEditVar[] {
  const leaves = parseStoreLeaves(logBytes)
  if (leaves?.length) {
    return leaves.map((leaf) =>
      makeRow(leaf.name, leaf.opcode, leaf.arg, leaf.pos, {
        group: leaf.group,
        groupKind: leaf.groupKind,
        field: leaf.field,
        itemIndex: leaf.itemIndex,
        itemStart: leaf.itemStart,
        itemEnd: leaf.itemEnd,
        insertPos: leaf.insertPos
      })
    )
  }
  return parseStoreVariablesLinear(logBytes)
}

function unicodeSpan(buf: Buffer, pos: number, kind: StringKind): number {
  if (kind === 'SHORT_BINUNICODE') {
    if (buf[pos] !== 0x8c) throw new Error('That save changed on disk. Reload and try again.')
    return 2 + buf[pos + 1]
  }
  if (kind === 'BINUNICODE') {
    if (buf[pos] !== 0x58) throw new Error('That save changed on disk. Reload and try again.')
    return 5 + buf.readUInt32LE(pos + 1)
  }
  if (buf[pos] !== 0x8d) throw new Error('That save changed on disk. Reload and try again.')
  return 9 + Number(buf.readBigUInt64LE(pos + 1))
}

function encodeUnicode(text: string, prefer: StringKind): Buffer {
  const data = Buffer.from(text, 'utf8')
  const len = data.length
  if (prefer === 'SHORT_BINUNICODE' && len <= 255) {
    return Buffer.concat([Buffer.from([0x8c, len]), data])
  }
  if ((prefer === 'SHORT_BINUNICODE' || prefer === 'BINUNICODE') && len <= 0xffffffff) {
    const head = Buffer.alloc(5)
    head[0] = 0x58
    head.writeUInt32LE(len, 1)
    return Buffer.concat([head, data])
  }
  const head = Buffer.alloc(9)
  head[0] = 0x8d
  head.writeBigUInt64LE(BigInt(len), 1)
  return Buffer.concat([head, data])
}

function bumpFrames(buf: Buffer, splicePos: number, delta: number): void {
  if (!delta) return
  for (const op of genops(buf)) {
    if (op.name !== 'FRAME' || typeof op.arg !== 'number') continue
    const payloadStart = op.pos + 9
    const payloadEnd = payloadStart + op.arg
    if (splicePos < payloadStart || splicePos >= payloadEnd) continue
    const next = op.arg + delta
    if (next < 0) throw new Error('Invalid pickle frame size.')
    buf.writeBigUInt64LE(BigInt(next), op.pos + 1)
  }
}

const MEMO_PUT_NAMES = new Set(['MEMOIZE', 'BINPUT', 'LONG_BINPUT', 'PUT'])
const MAX_LIST_SLICE = 256 * 1024

function cloneListSlice(buf: Buffer, start: number, end: number): Buffer {
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start || start < 0 || end > buf.length) {
    throw new Error('That save changed on disk. Reload and try again.')
  }
  if (end - start > MAX_LIST_SLICE) throw new Error('That list item is too large to copy.')
  const slice = buf.subarray(start, end)
  try {
    const ops = genops(Buffer.concat([slice, Buffer.from([0x2e])]))
    const kept: Buffer[] = []
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i]
      if (op.name === 'STOP') break
      if (MEMO_PUT_NAMES.has(op.name)) continue
      const next = ops[i + 1]
      const opEnd = next?.name === 'STOP' || !next ? slice.length : next.pos
      kept.push(slice.subarray(op.pos, opEnd))
    }
    const out = Buffer.concat(kept)
    if (!out.length) throw new Error('That list item could not be copied.')
    return out
  } catch (error) {
    if (error instanceof Error && /too large|could not be copied|changed on disk/.test(error.message)) throw error
    return Buffer.from(slice)
  }
}

function isSetPatch(
  patch: RenpySaveEditPatch
): patch is Extract<RenpySaveEditPatch, { kind: RenpySaveEditKind; value: boolean | number | string }> {
  return !patch.op || patch.op === 'set'
}

function splicePos(patch: RenpySaveEditPatch): number {
  if (isSetPatch(patch)) return patch.pos
  if (patch.op === 'listInsert') return patch.at
  return patch.start
}

export function applySavePatches(logBytes: Buffer, patches: RenpySaveEditPatch[]): Buffer {
  const rows = parseStoreVariables(logBytes)
  const byPos = new Map(rows.map((row) => [row.pos, row]))
  const listSpans = rows
    .filter((row) => row.itemStart != null && row.itemEnd != null && row.itemEnd > row.itemStart)
    .map((row) => ({ start: row.itemStart!, end: row.itemEnd!, insertPos: row.insertPos }))

  for (const patch of patches) {
    if (isSetPatch(patch)) {
      const row = byPos.get(patch.pos)
      if (!row || !row.editable || row.kind !== patch.kind) {
        throw new Error('That save changed on disk. Reload and try again.')
      }
      continue
    }
    if (patch.end <= patch.start || patch.start < 0 || patch.end > logBytes.length) {
      throw new Error('That save changed on disk. Reload and try again.')
    }
    if (patch.op === 'listInsert') {
      if (patch.at < 0 || patch.at > logBytes.length) {
        throw new Error('That save changed on disk. Reload and try again.')
      }
      const known = listSpans.some((span) => span.start === patch.start && span.end === patch.end && span.insertPos === patch.at)
      if (!known) throw new Error('That save changed on disk. Reload and try again.')
    } else {
      const known = listSpans.some((span) => span.start === patch.start && span.end === patch.end)
      if (!known) throw new Error('That save changed on disk. Reload and try again.')
    }
  }

  let buf = Buffer.from(logBytes)
  const ordered = [...patches].sort((a, b) => splicePos(b) - splicePos(a) || (isSetPatch(a) ? -1 : 1) - (isSetPatch(b) ? -1 : 1))
  for (const patch of ordered) {
    if (!isSetPatch(patch)) {
      if (patch.op === 'listRemove') {
        bumpFrames(buf, patch.start, -(patch.end - patch.start))
        buf = Buffer.concat([buf.subarray(0, patch.start), buf.subarray(patch.end)])
        continue
      }
      const cloned = cloneListSlice(buf, patch.start, patch.end)
      bumpFrames(buf, patch.at, cloned.length)
      buf = Buffer.concat([buf.subarray(0, patch.at), cloned, buf.subarray(patch.at)])
      continue
    }
    const row = byPos.get(patch.pos)!
    if (patch.kind === 'bool') {
      if (typeof patch.value !== 'boolean') throw new Error('Boolean values must be true or false.')
      buf[patch.pos] = patch.value ? 0x88 : 0x89
      continue
    }
    if (isStringKind(patch.kind)) {
      if (typeof patch.value !== 'string') throw new Error(`'${row.displayName}' needs text.`)
      if (patch.value.length > MAX_STRING_EDIT) throw new Error('That text is too long to store in the save.')
      const encoded = encodeUnicode(patch.value, patch.kind)
      const oldLen = unicodeSpan(buf, patch.pos, patch.kind)
      bumpFrames(buf, patch.pos, encoded.length - oldLen)
      buf = Buffer.concat([buf.subarray(0, patch.pos), encoded, buf.subarray(patch.pos + oldLen)])
      continue
    }
    if (!isIntKind(patch.kind) || typeof patch.value !== 'number' || !Number.isInteger(patch.value)) {
      throw new Error(`'${row.displayName}' needs a whole number.`)
    }
    const spec = INT_WIDTH[patch.kind]
    if (patch.value < spec.min || patch.value > spec.max) {
      throw new Error(`'${row.displayName}' is out of range for its original storage (${spec.min}..${spec.max}).`)
    }
    if (patch.kind === 'BININT1') buf.writeUInt8(patch.value, patch.pos + spec.offset)
    else if (patch.kind === 'BININT2') buf.writeUInt16LE(patch.value, patch.pos + spec.offset)
    else buf.writeInt32LE(patch.value, patch.pos + spec.offset)
  }
  return buf
}

export function writeZipBuffer(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name.replace(/\\/g, '/'), 'utf8')
    const compressed = deflateRawSync(file.data)
    const method = compressed.length < file.data.length ? 8 : 0
    const payload = method === 8 ? compressed : file.data
    const crc = crc32(file.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(payload.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const localFull = Buffer.concat([local, name, payload])
    locals.push(localFull)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(payload.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, name]))
    offset += localFull.length
  }

  const localBlob = Buffer.concat(locals)
  const centralBlob = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralBlob.length, 12)
  eocd.writeUInt32LE(localBlob.length, 16)
  return Buffer.concat([localBlob, centralBlob, eocd])
}

async function readSaveZip(filePath: string): Promise<{ names: string[]; files: Map<string, Buffer> }> {
  const zip = await openZipReader(filePath)
  if (!zip) throw new Error("That file is not a Ren'Py save.")
  try {
    const files = new Map<string, Buffer>()
    for (const name of zip.names) {
      const data = await zip.read(name, name.toLowerCase() === 'log' ? LOG_LIMITS : COPY_LIMITS)
      if (!data) throw new Error(`Could not read ${name} from the save.`)
      files.set(name, data)
    }
    return { names: zip.names, files }
  } finally {
    await zip.close()
  }
}

export async function readSaveEditor(filePath: string): Promise<RenpySaveEditorData> {
  const { files } = await readSaveZip(filePath)
  const log = files.get('log') || [...files.entries()].find(([name]) => name.toLowerCase() === 'log')?.[1]
  if (!log) throw new Error("That save has no pickle log to edit.")
  return {
    path: filePath,
    name: basename(filePath),
    variables: parseStoreVariables(log)
  }
}

const EDIT_KINDS = new Set<RenpySaveEditKind>([
  'bool',
  'BININT1',
  'BININT2',
  'BININT',
  'SHORT_BINUNICODE',
  'BINUNICODE',
  'BINUNICODE8'
])

export function sanitizeSavePatches(patches: unknown): RenpySaveEditPatch[] {
  if (!Array.isArray(patches)) return []
  const out: RenpySaveEditPatch[] = []
  for (const item of patches) {
    if (!item || typeof item !== 'object') continue
    const rec = item as { op?: unknown; pos?: unknown; kind?: unknown; value?: unknown; start?: unknown; end?: unknown; at?: unknown }
    if (rec.op === 'listRemove' || rec.op === 'listInsert') {
      const start = Number(rec.start)
      const end = Number(rec.end)
      if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) continue
      if (end - start > MAX_LIST_SLICE) continue
      if (rec.op === 'listRemove') {
        out.push({ op: 'listRemove', start, end })
        continue
      }
      const at = Number(rec.at)
      if (!Number.isInteger(at) || at < 0) continue
      out.push({ op: 'listInsert', at, start, end })
      continue
    }
    const pos = Number(rec.pos)
    const kind = rec.kind
    if (!Number.isInteger(pos) || typeof kind !== 'string' || !EDIT_KINDS.has(kind as RenpySaveEditKind)) continue
    if (kind === 'bool' && typeof rec.value === 'boolean') {
      out.push({ pos, kind: 'bool', value: rec.value })
      continue
    }
    if (isStringKind(kind as RenpySaveEditKind) && typeof rec.value === 'string' && rec.value.length <= MAX_STRING_EDIT) {
      out.push({ pos, kind: kind as StringKind, value: rec.value })
      continue
    }
    if (isIntKind(kind as RenpySaveEditKind) && typeof rec.value === 'number' && Number.isInteger(rec.value)) {
      out.push({ pos, kind: kind as IntKind, value: rec.value })
    }
  }
  return out
}

export async function applySaveEditor(
  filePath: string,
  patches: unknown,
  tokenSearchRoots: string[] = []
): Promise<void> {
  if (!pathExists(filePath)) throw new Error('That save is missing.')
  const unique = sanitizeSavePatches(patches)
  if (!unique.length) return

  const { names, files } = await readSaveZip(filePath)
  const logName = names.find((name) => name.toLowerCase() === 'log')
  if (!logName) throw new Error("That save has no pickle log to edit.")
  const log = files.get(logName)
  if (!log) throw new Error("That save has no pickle log to edit.")

  const nextLog = applySavePatches(log, unique)
  if (nextLog.equals(log)) return

  files.set(logName, nextLog)
  await updateSaveSignatures(filePath, names, files, tokenSearchRoots)
  const zipBytes = writeZipBuffer(names.map((name) => ({ name, data: files.get(name)! })))

  const bakPath = `${filePath}.bak`
  if (!pathExists(bakPath)) await copyFile(toFsPath(filePath), toFsPath(bakPath))
  const tmpPath = `${filePath}.tmp`
  await writeFile(toFsPath(tmpPath), zipBytes)
  await rename(toFsPath(tmpPath), toFsPath(filePath))
}
