/**
 * LZ-String used by RPG Maker MV / MZ tooling.
 *
 * MV ships the old 1.3.x corescript (`compress` then pack UCS-2 bytes as Base64).
 * Later editors and the Python `lzstring` package use 1.4.x (`compressToBase64`
 * writes 6-bit Base64 directly). Decode tries both; encode keeps the detected codec.
 */

const KEY_STR = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
const fromChar = String.fromCharCode

const baseReverse: Record<string, number> = {}
for (let i = 0; i < KEY_STR.length; i++) baseReverse[KEY_STR.charAt(i)] = i

function compressBits(
  uncompressed: string,
  bitsPerChar: number,
  getCharFromInt: (value: number) => string
): string {
  if (uncompressed == null) return ''
  const dictionary: Record<string, number> = {}
  const dictionaryToCreate: Record<string, boolean> = {}
  let c = ''
  let wc = ''
  let w = ''
  let enlargeIn = 2
  let dictSize = 3
  let numBits = 2
  const data: string[] = []
  let dataVal = 0
  let dataPosition = 0

  function writeBit(bit: number): void {
    dataVal = (dataVal << 1) | (bit & 1)
    if (dataPosition === bitsPerChar - 1) {
      dataPosition = 0
      data.push(getCharFromInt(dataVal))
      dataVal = 0
    } else {
      dataPosition++
    }
  }

  function writeBits(value: number, bits: number): void {
    let n = value
    for (let i = 0; i < bits; i++) {
      writeBit(n)
      n >>= 1
    }
  }

  function writeW(): void {
    if (Object.prototype.hasOwnProperty.call(dictionaryToCreate, w)) {
      if (w.charCodeAt(0) < 256) {
        writeBits(0, numBits)
        writeBits(w.charCodeAt(0), 8)
      } else {
        writeBits(1, numBits)
        writeBits(w.charCodeAt(0), 16)
      }
      enlargeIn--
      if (enlargeIn === 0) {
        enlargeIn = 2 ** numBits
        numBits++
      }
      delete dictionaryToCreate[w]
    } else {
      writeBits(dictionary[w], numBits)
    }
    enlargeIn--
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits
      numBits++
    }
  }

  for (let ii = 0; ii < uncompressed.length; ii++) {
    c = uncompressed.charAt(ii)
    if (!Object.prototype.hasOwnProperty.call(dictionary, c)) {
      dictionary[c] = dictSize++
      dictionaryToCreate[c] = true
    }
    wc = w + c
    if (Object.prototype.hasOwnProperty.call(dictionary, wc)) {
      w = wc
    } else {
      writeW()
      dictionary[wc] = dictSize++
      w = String(c)
    }
  }

  if (w !== '') writeW()
  writeBits(2, numBits)
  while (true) {
    dataVal <<= 1
    if (dataPosition === bitsPerChar - 1) {
      data.push(getCharFromInt(dataVal))
      break
    }
    dataPosition++
  }
  return data.join('')
}

function decompressBits(
  length: number,
  resetValue: number,
  getNextValue: (index: number) => number
): string | null {
  const dictionary: string[] = []
  const result: string[] = []
  const data = { val: getNextValue(0), position: resetValue, index: 1 }
  let enlargeIn = 4
  let dictSize = 4
  let numBits = 3
  let entry = ''
  let w = ''
  let bits = 0
  let resb = 0
  let c = 0

  function readBits(width: number): number {
    let value = 0
    let bit = 1
    const limit = 2 ** width
    while (bit !== limit) {
      resb = data.val & data.position
      data.position >>= 1
      if (data.position === 0) {
        data.position = resetValue
        data.val = getNextValue(data.index++)
      }
      value |= (resb > 0 ? 1 : 0) * bit
      bit <<= 1
    }
    return value
  }

  for (let i = 0; i < 3; i++) dictionary[i] = String(i)

  bits = readBits(2)
  switch (bits) {
    case 0:
      w = fromChar(readBits(8))
      break
    case 1:
      w = fromChar(readBits(16))
      break
    case 2:
      return ''
    default:
      return null
  }
  dictionary[3] = w
  result.push(w)

  while (true) {
    if (data.index > length) return ''
    c = readBits(numBits)
    switch (c) {
      case 0:
        dictionary[dictSize++] = fromChar(readBits(8))
        c = dictSize - 1
        enlargeIn--
        break
      case 1:
        dictionary[dictSize++] = fromChar(readBits(16))
        c = dictSize - 1
        enlargeIn--
        break
      case 2:
        return result.join('')
    }
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits
      numBits++
    }
    if (dictionary[c]) {
      entry = dictionary[c]
    } else if (c === dictSize) {
      entry = w + w.charAt(0)
    } else {
      return null
    }
    result.push(entry)
    dictionary[dictSize++] = w + entry.charAt(0)
    enlargeIn--
    w = entry
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits
      numBits++
    }
  }
}

function packUcs2ToBase64(compressed: string): string {
  let out = ''
  let n = 0
  let r = 0
  let i = 0
  let f = 0
  while (f < compressed.length * 2) {
    if (f % 2 === 0) {
      n = compressed.charCodeAt(f / 2) >> 8
      r = compressed.charCodeAt(f / 2) & 255
      i = f / 2 + 1 < compressed.length ? compressed.charCodeAt(f / 2 + 1) >> 8 : Number.NaN
    } else {
      n = compressed.charCodeAt((f - 1) / 2) & 255
      if ((f + 1) / 2 < compressed.length) {
        r = compressed.charCodeAt((f + 1) / 2) >> 8
        i = compressed.charCodeAt((f + 1) / 2) & 255
      } else {
        r = Number.NaN
        i = Number.NaN
      }
    }
    f += 3
    const s = n >> 2
    const o = ((n & 3) << 4) | (r >> 4)
    let u = ((r & 15) << 2) | (i >> 6)
    let a = i & 63
    if (Number.isNaN(r)) {
      u = 64
      a = 64
    } else if (Number.isNaN(i)) {
      a = 64
    }
    out += KEY_STR.charAt(s) + KEY_STR.charAt(o) + KEY_STR.charAt(u) + KEY_STR.charAt(a)
  }
  return out
}

function unpackBase64ToUcs2(input: string): string {
  const cleaned = input.replace(/[^A-Za-z0-9+/=]/g, '')
  let out = ''
  let n = 0
  let pending = 0
  let c = 0
  while (c < cleaned.length) {
    const u = KEY_STR.indexOf(cleaned.charAt(c++))
    const a = KEY_STR.indexOf(cleaned.charAt(c++))
    const f = KEY_STR.indexOf(cleaned.charAt(c++))
    const l = KEY_STR.indexOf(cleaned.charAt(c++))
    const i = (u << 2) | (a >> 4)
    const s = ((a & 15) << 4) | (f >> 2)
    const o = ((f & 3) << 6) | l
    if (n % 2 === 0) {
      pending = i << 8
      if (f !== 64) out += fromChar(pending | s)
      if (l !== 64) pending = o << 8
    } else {
      out += fromChar(pending | i)
      if (f !== 64) pending = s << 8
      if (l !== 64) out += fromChar(pending | o)
    }
    n += 3
  }
  return out
}

/** RPG Maker MV corescript: compress as UCS-2, then Base64-encode those bytes. */
export function compressToBase64Mv(input: string): string {
  if (input == null) return ''
  return packUcs2ToBase64(compressBits(input, 16, fromChar))
}

export function decompressFromBase64Mv(input: string): string | null {
  if (input == null) return ''
  const packed = unpackBase64ToUcs2(input)
  if (!packed) return packed === '' ? null : packed
  return decompressBits(packed.length, 32768, (index) => packed.charCodeAt(index))
}

/** lz-string 1.4+ / Python `lzstring`: 6-bit Base64 bitstream. */
export function compressToBase64(input: string): string {
  if (input == null) return ''
  const res = compressBits(input, 6, (value) => KEY_STR.charAt(value))
  switch (res.length % 4) {
    case 1:
      return `${res}===`
    case 2:
      return `${res}==`
    case 3:
      return `${res}=`
    default:
      return res
  }
}

export function decompressFromBase64(input: string): string | null {
  if (input == null) return ''
  if (input === '') return null
  const cleaned = input.replace(/[^A-Za-z0-9+/=]/g, '')
  if (!cleaned) return null
  return decompressBits(cleaned.length, 32, (index) => baseReverse[cleaned.charAt(index)] ?? 0)
}
