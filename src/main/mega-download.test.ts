import { describe, expect, test } from 'bun:test'
import { createCipheriv, createHash, randomBytes } from 'crypto'
import { Readable, Writable } from 'stream'
import { pipeline } from 'stream/promises'
import { createMegaChunkStream, MegaMac, type MegaRangeFetch } from './mega-download'

/** MEGA upload encryption: AES-CTR plus the chunked MAC folded into the node key. */
function encryptWith(plain: Buffer, seed: Buffer): { cipher: Buffer; key: Buffer } {
  const aesKey = seed.subarray(0, 16)
  const nonce = seed.subarray(16, 24)
  const iv = Buffer.concat([nonce, Buffer.alloc(8)])
  const cipher = createCipheriv('aes-128-ctr', aesKey, iv).update(plain)
  const mac = new MegaMac(aesKey, nonce)
  mac.update(plain)
  const key = Buffer.concat([aesKey, nonce, mac.digest()])
  for (let i = 0; i < 16; i += 1) key[i] ^= key[16 + i]
  return { cipher, key }
}

async function encrypted(plain: Buffer): Promise<{ cipher: Buffer; key: Buffer }> {
  return encryptWith(plain, randomBytes(24))
}

async function readAll(stream: Readable): Promise<Buffer> {
  const parts: Buffer[] = []
  for await (const chunk of stream) parts.push(chunk as Buffer)
  return Buffer.concat(parts)
}

function serve(cipher: Buffer, onFetch?: (start: number, end: number) => void): MegaRangeFetch {
  return async (start, end) => {
    onFetch?.(start, end)
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 5))
    return cipher.subarray(start, end + 1)
  }
}

describe('MegaMac', () => {
  test('matches a key and ciphertext produced by MEGA client encryption', () => {
    const plain = Buffer.alloc(300_000)
    for (let i = 0; i < plain.length; i += 1) plain[i] = (i * 31 + 7) & 255
    const seed = Buffer.from(Array.from({ length: 24 }, (_, i) => i))
    const { cipher, key } = encryptWith(plain, seed)
    expect(key.toString('hex')).toBe(
      '10101010101010106cb728ddde561d2f101112131415161764be22d6d25b1320'
    )
    expect(createHash('sha256').update(cipher).digest('hex')).toBe(
      'a630f21c10156cb7944d79058e48d244f49e75d93f61c2d61f4178db6d8fd381'
    )
  })
})

describe('createMegaChunkStream', () => {
  test('decrypts and MAC-verifies a whole file', async () => {
    const plain = randomBytes(5 * 1024 * 1024 + 37)
    const { cipher, key } = await encrypted(plain)
    const out = await readAll(
      createMegaChunkStream({ key, size: plain.length, fetchRange: serve(cipher) })
    )
    expect(out.equals(plain)).toBe(true)
  })

  test('serves an unaligned byte range', async () => {
    const plain = randomBytes(3 * 1024 * 1024)
    const { cipher, key } = await encrypted(plain)
    const out = await readAll(
      createMegaChunkStream({
        key,
        size: plain.length,
        start: 1_000_003,
        end: 2_500_000,
        fetchRange: serve(cipher)
      })
    )
    expect(out.equals(plain.subarray(1_000_003, 2_500_001))).toBe(true)
  })

  test('fails when the content does not match the MAC', async () => {
    const plain = randomBytes(700 * 1024)
    const { cipher, key } = await encrypted(plain)
    const tampered = Buffer.from(cipher)
    tampered[300_000] ^= 1
    await expect(
      readAll(createMegaChunkStream({ key, size: plain.length, fetchRange: serve(tampered) }))
    ).rejects.toThrow('MAC verification failed')
  })

  test('keeps flowing after a burst overfills the buffer for a slow consumer', async () => {
    const plain = randomBytes(60 * 1024 * 1024)
    const { cipher, key } = await encrypted(plain)
    let held: (() => void)[] | null = []
    const fetchRange: MegaRangeFetch = (start, end) =>
      new Promise((resolve) => {
        const send = (): void => resolve(cipher.subarray(start, end + 1))
        if (held) held.push(send)
        else setTimeout(send, 1)
      })
    setTimeout(() => {
      const burst = held ?? []
      held = null
      for (const send of burst) send()
    }, 100)
    const parts: Buffer[] = []
    await pipeline(
      createMegaChunkStream({ key, size: plain.length, fetchRange }),
      new Writable({
        highWaterMark: 64 * 1024,
        write(chunk: Buffer, _encoding, callback) {
          parts.push(chunk)
          setTimeout(callback, chunk.length / 50_000)
        }
      })
    )
    expect(Buffer.concat(parts).equals(plain)).toBe(true)
  }, 20_000)

  test('keeps several range requests in flight', async () => {
    const plain = randomBytes(12 * 1024 * 1024)
    const { cipher, key } = await encrypted(plain)
    let active = 0
    let peak = 0
    const fetchRange: MegaRangeFetch = async (start, end) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
      return cipher.subarray(start, end + 1)
    }
    const out = await readAll(
      createMegaChunkStream({ key, size: plain.length, fetchRange, connections: 4 })
    )
    expect(out.equals(plain)).toBe(true)
    expect(peak).toBe(4)
  })
})
