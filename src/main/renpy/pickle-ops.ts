/** Walk pickle protocol 0–5 opcodes the way pickletools.genops does. */

export type PickleOp = {
  name: string
  arg: unknown
  pos: number
}

type Reader = { buf: Buffer; i: number }

function need(r: Reader, n: number): void {
  if (r.i + n > r.buf.length) throw new Error('Truncated pickle data.')
}

function u1(r: Reader): number {
  need(r, 1)
  return r.buf[r.i++]
}

function u2(r: Reader): number {
  need(r, 2)
  const value = r.buf.readUInt16LE(r.i)
  r.i += 2
  return value
}

function u4(r: Reader): number {
  need(r, 4)
  const value = r.buf.readUInt32LE(r.i)
  r.i += 4
  return value
}

function i4(r: Reader): number {
  need(r, 4)
  const value = r.buf.readInt32LE(r.i)
  r.i += 4
  return value
}

function u8(r: Reader): number {
  need(r, 8)
  const value = Number(r.buf.readBigUInt64LE(r.i))
  r.i += 8
  return value
}

function bytes(r: Reader, n: number): Buffer {
  if (n < 0 || n > 64 * 1024 * 1024) throw new Error('Pickle payload is too large.')
  need(r, n)
  const slice = r.buf.subarray(r.i, r.i + n)
  r.i += n
  return slice
}

function line(r: Reader): string {
  const start = r.i
  while (r.i < r.buf.length && r.buf[r.i] !== 0x0a) r.i++
  if (r.i >= r.buf.length) throw new Error('Truncated pickle data.')
  const text = r.buf.toString('utf8', start, r.i)
  r.i++
  return text
}

function utf8(r: Reader, n: number): string {
  return bytes(r, n).toString('utf8')
}

function decodeLong(data: Buffer): number | string {
  if (!data.length) return 0
  let n = 0n
  for (let i = data.length - 1; i >= 0; i--) n = (n << 8n) + BigInt(data[i])
  const sign = 1n << BigInt(data.length * 8 - 1)
  if (n & sign) n -= sign << 1n
  if (n >= BigInt(Number.MIN_SAFE_INTEGER) && n <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(n)
  return n.toString()
}

function decimal(text: string): unknown {
  if (text === '00') return false
  if (text === '01') return true
  const n = Number(text.replace(/L$/i, ''))
  return Number.isFinite(n) ? n : text
}

type Spec = { name: string; read?: (r: Reader) => unknown }

const OPS: Record<number, Spec> = {
  0x28: { name: 'MARK' },
  0x29: { name: 'EMPTY_TUPLE' },
  0x2e: { name: 'STOP' },
  0x30: { name: 'POP' },
  0x31: { name: 'POP_MARK' },
  0x32: { name: 'DUP' },
  0x42: { name: 'BINBYTES', read: (r) => bytes(r, u4(r)) },
  0x43: { name: 'SHORT_BINBYTES', read: (r) => bytes(r, u1(r)) },
  0x46: { name: 'FLOAT', read: (r) => Number(line(r)) },
  0x47: {
    name: 'BINFLOAT',
    read: (r) => {
      need(r, 8)
      const value = r.buf.readDoubleBE(r.i)
      r.i += 8
      return value
    }
  },
  0x49: { name: 'INT', read: (r) => decimal(line(r)) },
  0x4a: { name: 'BININT', read: i4 },
  0x4b: { name: 'BININT1', read: u1 },
  0x4c: { name: 'LONG', read: (r) => decimal(line(r)) },
  0x4d: { name: 'BININT2', read: u2 },
  0x4e: { name: 'NONE' },
  0x50: { name: 'PERSID', read: line },
  0x51: { name: 'BINPERSID' },
  0x52: { name: 'REDUCE' },
  0x53: { name: 'STRING', read: line },
  0x54: { name: 'BINSTRING', read: (r) => bytes(r, u4(r)).toString('latin1') },
  0x55: { name: 'SHORT_BINSTRING', read: (r) => bytes(r, u1(r)).toString('latin1') },
  0x56: { name: 'UNICODE', read: line },
  0x58: { name: 'BINUNICODE', read: (r) => utf8(r, u4(r)) },
  0x61: { name: 'APPEND' },
  0x62: { name: 'BUILD' },
  0x63: { name: 'GLOBAL', read: (r) => `${line(r)} ${line(r)}` },
  0x64: { name: 'DICT' },
  0x65: { name: 'APPENDS' },
  0x67: { name: 'GET', read: line },
  0x68: { name: 'BINGET', read: u1 },
  0x69: { name: 'INST', read: (r) => `${line(r)} ${line(r)}` },
  0x6a: { name: 'LONG_BINGET', read: u4 },
  0x6c: { name: 'LIST' },
  0x6f: { name: 'OBJ' },
  0x70: { name: 'PUT', read: line },
  0x71: { name: 'BINPUT', read: u1 },
  0x72: { name: 'LONG_BINPUT', read: u4 },
  0x73: { name: 'SETITEM' },
  0x74: { name: 'TUPLE' },
  0x75: { name: 'SETITEMS' },
  0x7d: { name: 'EMPTY_DICT' },
  0x5d: { name: 'EMPTY_LIST' },
  0x80: { name: 'PROTO', read: u1 },
  0x81: { name: 'NEWOBJ' },
  0x82: { name: 'EXT1', read: u1 },
  0x83: { name: 'EXT2', read: u2 },
  0x84: { name: 'EXT4', read: i4 },
  0x85: { name: 'TUPLE1' },
  0x86: { name: 'TUPLE2' },
  0x87: { name: 'TUPLE3' },
  0x88: { name: 'NEWTRUE', read: () => true },
  0x89: { name: 'NEWFALSE', read: () => false },
  0x8a: { name: 'LONG1', read: (r) => decodeLong(bytes(r, u1(r))) },
  0x8b: { name: 'LONG4', read: (r) => decodeLong(bytes(r, u4(r))) },
  0x8c: { name: 'SHORT_BINUNICODE', read: (r) => utf8(r, u1(r)) },
  0x8d: { name: 'BINUNICODE8', read: (r) => utf8(r, u8(r)) },
  0x8e: { name: 'BINBYTES8', read: (r) => bytes(r, u8(r)) },
  0x8f: { name: 'EMPTY_SET' },
  0x90: { name: 'ADDITEMS' },
  0x91: { name: 'FROZENSET' },
  0x92: { name: 'NEWOBJ_EX' },
  0x93: { name: 'STACK_GLOBAL' },
  0x94: { name: 'MEMOIZE' },
  0x95: { name: 'FRAME', read: u8 },
  0x96: { name: 'BYTEARRAY8', read: (r) => bytes(r, u8(r)) },
  0x97: { name: 'NEXT_BUFFER' },
  0x98: { name: 'READONLY_BUFFER' }
}

export function genops(buf: Buffer): PickleOp[] {
  const r: Reader = { buf, i: 0 }
  const ops: PickleOp[] = []
  while (r.i < buf.length) {
    const pos = r.i
    const code = u1(r)
    const spec = OPS[code]
    if (!spec) throw new Error(`Unknown pickle opcode 0x${code.toString(16)} at ${pos}.`)
    const arg = spec.read ? spec.read(r) : undefined
    ops.push({ name: spec.name, arg, pos })
    if (spec.name === 'STOP') break
  }
  return ops
}
