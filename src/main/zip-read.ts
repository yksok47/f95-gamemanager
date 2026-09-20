import { open, type FileHandle } from 'fs/promises'
import { promisify } from 'util'
import { inflateRaw as inflateRawCb } from 'zlib'
import { toFsPath } from './win-path'

const inflateRaw = promisify(inflateRawCb)

const LOCAL_SIG = 0x04034b50
const CENTRAL_SIG = 0x02014b50
const EOCD_SIG = 0x06054b50
const MAX_TAIL = 22 + 65535

export type ZipLimits = {
  maxCompressed?: number
  maxUncompressed?: number
}

type ZipIndexEntry = {
  name: string
  method: number
  compressedSize: number
  uncompressedSize: number
  localOffset: number
}

export type ZipReader = {
  names: string[]
  has(name: string): boolean
  read(name: string, limits?: ZipLimits): Promise<Buffer | null>
  close(): Promise<void>
}

async function readAt(file: FileHandle, position: number, length: number): Promise<Buffer> {
  if (length <= 0) return Buffer.alloc(0)
  const buf = Buffer.allocUnsafe(length)
  const { bytesRead } = await file.read(buf, 0, length, position)
  return bytesRead === length ? buf : buf.subarray(0, bytesRead)
}

function findEocd(tail: Buffer): number {
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) !== EOCD_SIG) continue
    const commentLen = tail.readUInt16LE(i + 20)
    if (i + 22 + commentLen === tail.length) return i
  }
  return -1
}

function parseCentralDirectory(cd: Buffer): ZipIndexEntry[] {
  const entries: ZipIndexEntry[] = []
  let offset = 0
  while (offset + 46 <= cd.length) {
    if (cd.readUInt32LE(offset) !== CENTRAL_SIG) break
    const method = cd.readUInt16LE(offset + 10)
    const compressedSize = cd.readUInt32LE(offset + 20)
    const uncompressedSize = cd.readUInt32LE(offset + 24)
    const nameLen = cd.readUInt16LE(offset + 28)
    const extraLen = cd.readUInt16LE(offset + 30)
    const commentLen = cd.readUInt16LE(offset + 32)
    const localOffset = cd.readUInt32LE(offset + 42)
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLen
    if (nameEnd > cd.length) break
    if (
      compressedSize !== 0xffffffff &&
      uncompressedSize !== 0xffffffff &&
      localOffset !== 0xffffffff
    ) {
      entries.push({
        name: cd.toString('utf8', nameStart, nameEnd).replace(/\\/g, '/'),
        method,
        compressedSize,
        uncompressedSize,
        localOffset
      })
    }
    offset = nameEnd + extraLen + commentLen
  }
  return entries
}

async function inflateEntry(method: number, data: Buffer, uncompressedSize: number): Promise<Buffer> {
  if (!data.length && uncompressedSize === 0) return Buffer.alloc(0)
  if (method === 0) return data
  if (method !== 8) throw new Error(`Unsupported ZIP method ${method}`)
  return inflateRaw(data, { maxOutputLength: Math.max(uncompressedSize, 1) })
}

export async function openZipReader(filePath: string): Promise<ZipReader | null> {
  const file = await open(toFsPath(filePath), 'r')
  try {
    const size = (await file.stat()).size
    if (size < 22) {
      await file.close()
      return null
    }
    const magic = await readAt(file, 0, 4)
    if (magic.length < 2 || magic[0] !== 0x50 || magic[1] !== 0x4b) {
      await file.close()
      return null
    }

    const tailLen = Math.min(size, MAX_TAIL)
    const tail = await readAt(file, size - tailLen, tailLen)
    const eocd = findEocd(tail)
    if (eocd < 0) {
      await file.close()
      return null
    }

    const cdSize = tail.readUInt32LE(eocd + 12)
    const cdOffset = tail.readUInt32LE(eocd + 16)
    if (!cdSize || cdOffset === 0xffffffff || cdOffset + cdSize > size) {
      await file.close()
      return null
    }

    const catalog = parseCentralDirectory(await readAt(file, cdOffset, cdSize))
    const byName = new Map(catalog.map((entry) => [entry.name.toLowerCase(), entry]))

    async function read(name: string, limits?: ZipLimits): Promise<Buffer | null> {
      const entry = byName.get(name.replace(/\\/g, '/').toLowerCase())
      if (!entry) return null
      const maxCompressed = limits?.maxCompressed ?? 4 * 1024 * 1024
      const maxUncompressed = limits?.maxUncompressed ?? 8 * 1024 * 1024
      if (entry.compressedSize > maxCompressed || entry.uncompressedSize > maxUncompressed) {
        return null
      }
      const header = await readAt(file, entry.localOffset, 30)
      if (header.length < 30 || header.readUInt32LE(0) !== LOCAL_SIG) return null
      const nameLen = header.readUInt16LE(26)
      const extraLen = header.readUInt16LE(28)
      const dataStart = entry.localOffset + 30 + nameLen + extraLen
      const compressed = await readAt(file, dataStart, entry.compressedSize)
      if (compressed.length !== entry.compressedSize) return null
      try {
        return await inflateEntry(entry.method, compressed, entry.uncompressedSize)
      } catch {
        return null
      }
    }

    return {
      names: catalog.map((entry) => entry.name),
      has(name: string) {
        return byName.has(name.replace(/\\/g, '/').toLowerCase())
      },
      read,
      close: () => file.close()
    }
  } catch (error) {
    await file.close().catch(() => undefined)
    throw error
  }
}
