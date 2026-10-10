import { createCipheriv, createDecipheriv } from 'crypto'
import { Readable } from 'stream'

const BLOCK = 16
const INITIAL_CHUNK_BYTES = 512 * 1024
const MAX_CHUNK_BYTES = 4 * 1024 * 1024
const DEFAULT_CONNECTIONS = 8
const STREAM_BUFFER_BYTES = 8 * 1024 * 1024
const MAC_FIRST_CHUNK = 128 * 1024
const MAC_MAX_CHUNK = 1024 * 1024

/** Fetch encrypted bytes `start..end` (inclusive) from MEGA storage. */
export type MegaRangeFetch = (start: number, end: number, signal: AbortSignal) => Promise<Buffer>

export type MegaChunkStreamOptions = {
  /** 32-byte node key as stored by MEGA (AES key XOR nonce/MAC half). */
  key: Buffer
  size: number
  /** Inclusive plaintext byte range; defaults to the whole file. */
  start?: number
  end?: number
  fetchRange: MegaRangeFetch
  connections?: number
}

type NodeKey = { aesKey: Buffer; nonce: Buffer; mac: Buffer }

function splitNodeKey(key: Buffer): NodeKey {
  if (key.length !== 32) throw new Error('MEGA file key must be 256-bit')
  const aesKey = Buffer.alloc(16)
  for (let i = 0; i < 16; i += 1) aesKey[i] = key[i] ^ key[16 + i]
  return { aesKey, nonce: key.subarray(16, 24), mac: key.subarray(24, 32) }
}

function decryptAt(aesKey: Buffer, nonce: Buffer, offset: number, data: Buffer): Buffer {
  const iv = Buffer.alloc(16)
  nonce.copy(iv, 0)
  iv.writeBigUInt64BE(BigInt(offset / BLOCK), 8)
  return createDecipheriv('aes-128-ctr', aesKey, iv).update(data)
}

/**
 * MEGA's chunked CBC-MAC (chunks of 128K, 256K, … up to 1M) over the plaintext.
 * Each chunk's MAC is the last block of AES-CBC with IV nonce‖nonce, so whole
 * buffers go through one native cipher call instead of one call per block.
 */
export class MegaMac {
  private readonly aesKey: Buffer
  private readonly seed: Buffer
  private state: Buffer
  private chunkEnd = MAC_FIRST_CHUNK
  private chunkSize = MAC_FIRST_CHUNK
  private chunkBytes = 0
  private pos = 0
  private readonly macs: Buffer[] = []

  constructor(aesKey: Buffer, nonce: Buffer) {
    this.aesKey = aesKey
    this.seed = Buffer.concat([nonce, nonce])
    this.state = Buffer.from(this.seed)
  }

  update(data: Buffer): void {
    let offset = 0
    while (offset < data.length) {
      const take = Math.min(data.length - offset, this.chunkEnd - this.pos)
      this.absorb(data.subarray(offset, offset + take))
      offset += take
      this.pos += take
      this.chunkBytes += take
      if (this.pos === this.chunkEnd) {
        this.macs.push(this.state)
        this.state = Buffer.from(this.seed)
        this.chunkBytes = 0
        if (this.chunkSize < MAC_MAX_CHUNK) this.chunkSize += MAC_FIRST_CHUNK
        this.chunkEnd += this.chunkSize
      }
    }
  }

  private absorb(part: Buffer): void {
    if (!part.length) return
    const rem = part.length % BLOCK
    const padded = rem ? Buffer.concat([part, Buffer.alloc(BLOCK - rem)]) : part
    const out = createCipheriv('aes-128-cbc', this.aesKey, this.state)
      .setAutoPadding(false)
      .update(padded)
    this.state = Buffer.from(out.subarray(out.length - BLOCK))
  }

  digest(): Buffer {
    const macs = this.chunkBytes > 0 || !this.macs.length ? [...this.macs, this.state] : this.macs
    const ecb = createCipheriv('aes-128-ecb', this.aesKey, null).setAutoPadding(false)
    let mac: Buffer = Buffer.alloc(BLOCK)
    for (const item of macs) {
      for (let i = 0; i < BLOCK; i += 1) mac[i] ^= item[i]
      mac = ecb.update(mac)
    }
    const out = Buffer.alloc(8)
    out.writeInt32BE(mac.readInt32BE(0) ^ mac.readInt32BE(4), 0)
    out.writeInt32BE(mac.readInt32BE(8) ^ mac.readInt32BE(12), 4)
    return out
  }
}

/**
 * Parallel, ordered MEGA download. Keeps `connections` range requests in flight
 * at all times and decrypts each chunk on its own.
 * Whole-file streams are MAC-verified before the stream ends.
 */
export function createMegaChunkStream(opts: MegaChunkStreamOptions): Readable {
  const { aesKey, nonce, mac: expectedMac } = splitNodeKey(opts.key)
  const size = opts.size
  const start = opts.start ?? 0
  const end = Math.min(opts.end ?? size - 1, size - 1)
  const connections = Math.max(1, opts.connections ?? DEFAULT_CONNECTIONS)
  const maxAhead = connections * 2
  const alignedStart = start - (start % BLOCK)
  const mac = start === 0 && end === size - 1 ? new MegaMac(aesKey, nonce) : null
  const controller = new AbortController()
  const ready = new Map<number, Buffer>()

  let skip = start - alignedStart
  let nextOffset = alignedStart
  let chunkSize = INITIAL_CHUNK_BYTES
  let nextIndex = 0
  let flushIndex = 0
  let inFlight = 0
  let finished = false
  /**
   * Set when `push` reports a full buffer; only `read()` clears it. Checking
   * `readableLength` instead deadlocks: Node calls `read()` before it removes the
   * data being consumed, so the buffer can still look full and nothing is fetched.
   */
  let backpressure = false

  const fail = (error: unknown): void => {
    if (finished) return
    finished = true
    controller.abort()
    stream.destroy(error instanceof Error ? error : new Error(String(error)))
  }

  const flush = (): void => {
    while (!finished && ready.has(flushIndex)) {
      let chunk = ready.get(flushIndex) as Buffer
      ready.delete(flushIndex)
      flushIndex += 1
      mac?.update(chunk)
      if (skip) {
        chunk = chunk.subarray(skip)
        skip = 0
      }
      if (!stream.push(chunk)) backpressure = true
    }
    if (finished) return
    if (nextOffset > end && flushIndex === nextIndex) {
      if (mac && !mac.digest().equals(expectedMac)) {
        fail(new Error('MEGA MAC verification failed'))
        return
      }
      finished = true
      stream.push(null)
      return
    }
    pump()
  }

  const pump = (): void => {
    while (
      !finished &&
      nextOffset <= end &&
      inFlight < connections &&
      inFlight + ready.size < maxAhead &&
      !backpressure
    ) {
      const index = nextIndex
      const chunkStart = nextOffset
      const chunkEnd = Math.min(end, chunkStart + chunkSize - 1)
      nextIndex += 1
      nextOffset = chunkEnd + 1
      if (chunkSize < MAX_CHUNK_BYTES) chunkSize = Math.min(MAX_CHUNK_BYTES, chunkSize * 2)
      inFlight += 1
      opts
        .fetchRange(chunkStart, chunkEnd, controller.signal)
        .then(
          (cipher) => {
            inFlight -= 1
            if (finished) return
            if (cipher.length !== chunkEnd - chunkStart + 1) {
              fail(new Error(`MEGA returned ${cipher.length} bytes for ${chunkStart}-${chunkEnd}`))
              return
            }
            ready.set(index, decryptAt(aesKey, nonce, chunkStart, cipher))
            flush()
          },
          (error) => {
            inFlight -= 1
            fail(error)
          }
        )
    }
  }

  const stream = new Readable({
    highWaterMark: STREAM_BUFFER_BYTES,
    read() {
      if (start > end) {
        finished = true
        this.push(null)
        return
      }
      backpressure = false
      pump()
    },
    destroy(error, callback) {
      finished = true
      controller.abort()
      ready.clear()
      callback(error)
    }
  })

  return stream
}
