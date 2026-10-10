import { createDecipheriv } from 'crypto'
import type { MegaLink, MegaNode } from '@shared/mega'

const API_URL = 'https://g.api.mega.co.nz/cs'
const API_TIMEOUT_MS = 20_000
const API_TRIES = 6
const HASHCASH_SLOTS = 262_144
const HASHCASH_SLOT_BYTES = 48

/** EAGAIN, ERATELIMIT, ETEMPUNAVAIL: MEGA asks to try again later. */
const RETRY_CODES = new Set([-3, -4, -18])

const ERROR_TEXT: Record<number, string> = {
  [-2]: 'bad request',
  [-9]: 'file or folder not found',
  [-11]: 'access denied',
  [-14]: 'wrong decryption key',
  [-16]: 'file blocked by MEGA',
  [-17]: 'over quota',
  [-18]: 'temporarily unavailable'
}

export class MegaApiError extends Error {
  constructor(readonly code: number) {
    super(`MEGA API error ${code}${ERROR_TEXT[code] ? ` (${ERROR_TEXT[code]})` : ''}`)
  }
}

class RetryableError extends Error {}

export type MegaShareNode = MegaNode & {
  handle: string
  /** 32 bytes for files (AES key ⊕ nonce/MAC, then nonce, MAC), 16 for folders. */
  key: Buffer
  /** Public folder id the node was listed from; absent for single-file links. */
  folderId?: string
  children?: MegaShareNode[]
}

export type MegaShareFile = MegaShareNode & { size: number }

let sequence = Math.floor(Math.random() * 0x7fffffff)

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true }
    )
  })
}

/** MEGA's anti-abuse proof of work, answered in the `X-Hashcash` request header. */
async function hashcashToken(challenge: string): Promise<string> {
  const [version, easinessText, , token] = challenge.split(':')
  if (Number(version) !== 1 || !token) throw new Error('Unsupported MEGA hashcash challenge')
  const easiness = Number(easinessText)
  const threshold = (((easiness & 63) << 1) + 1) << ((easiness >> 6) * 7 + 3)
  const seed = Buffer.from(token, 'base64url')
  const buffer = Buffer.alloc(4 + HASHCASH_SLOTS * HASHCASH_SLOT_BYTES)
  for (let i = 0; i < HASHCASH_SLOTS; i += 1) buffer.set(seed, 4 + i * HASHCASH_SLOT_BYTES)
  for (;;) {
    const digest = new DataView(await globalThis.crypto.subtle.digest('SHA-256', buffer))
    if (digest.getUint32(0) <= threshold) {
      return `1:${token}:${buffer.subarray(0, 4).toString('base64url')}`
    }
    for (let i = 0; i < 4; i += 1) {
      buffer[i] = (buffer[i] + 1) & 0xff
      if (buffer[i]) break
    }
  }
}

async function apiRequest<T extends object>(
  body: Record<string, unknown>,
  query: Record<string, string> = {}
): Promise<T> {
  let hashcash: string | undefined
  for (let attempt = 1; ; attempt += 1) {
    let failure: unknown
    try {
      const params = new URLSearchParams({ id: String((sequence += 1)), ...query })
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (hashcash) headers['X-Hashcash'] = hashcash
      const res = await fetch(`${API_URL}?${params}`, {
        method: 'POST',
        headers,
        body: JSON.stringify([body]),
        signal: AbortSignal.timeout(API_TIMEOUT_MS)
      })
      const challenge = res.headers.get('x-hashcash')
      if (challenge) {
        hashcash = await hashcashToken(challenge)
        if (attempt < API_TRIES) continue
        throw new Error('MEGA kept asking for a hashcash token')
      }
      if (res.status >= 500 || res.status === 429) {
        throw new RetryableError(`MEGA API returned ${res.status}`)
      }
      if (!res.ok) throw new Error(`MEGA API returned ${res.status}`)
      const json = (await res.json()) as unknown
      const result = Array.isArray(json) ? json[0] : json
      if (typeof result === 'number') {
        if (RETRY_CODES.has(result)) throw new RetryableError(new MegaApiError(result).message)
        throw new MegaApiError(result)
      }
      if (!result || typeof result !== 'object') throw new Error('MEGA API returned no data')
      return result as T
    } catch (error) {
      const retryable =
        error instanceof RetryableError ||
        (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'TypeError'))
      if (!retryable) throw error
      failure = error
    }
    if (attempt >= API_TRIES) throw failure
    await sleep(Math.min(1000 * 2 ** (attempt - 1), 10_000))
  }
}

function foldKey(key: Buffer): Buffer {
  if (key.length === 16) return key
  const folded = Buffer.alloc(16)
  for (let i = 0; i < 16; i += 1) folded[i] = key[i] ^ key[16 + i]
  return folded
}

function decryptKey(encrypted: Buffer, shareKey: Buffer): Buffer {
  return createDecipheriv('aes-128-ecb', shareKey, null).setAutoPadding(false).update(encrypted)
}

function decryptName(attributes: string, key: Buffer): string | null {
  const data = Buffer.from(attributes, 'base64url')
  if (!data.length || data.length % 16) return null
  const plain = createDecipheriv('aes-128-cbc', foldKey(key), Buffer.alloc(16))
    .setAutoPadding(false)
    .update(data)
    .toString('utf8')
  if (!plain.startsWith('MEGA{')) return null
  try {
    const parsed = JSON.parse(plain.slice(4, plain.lastIndexOf('}') + 1)) as { n?: unknown }
    return typeof parsed.n === 'string' ? parsed.n : null
  } catch {
    return null
  }
}

function linkKey(link: MegaLink, length: number): Buffer {
  const key = Buffer.from(link.key, 'base64url')
  if (key.length !== length) throw new MegaApiError(-14)
  return key
}

type RawNode = { h: string; p: string; t: number; a: string; k: string; s?: number }

async function loadFile(link: MegaLink): Promise<MegaShareNode> {
  const key = linkKey(link, 32)
  const res = await apiRequest<{ s?: number; at?: string }>({ a: 'g', p: link.id })
  const name = res.at ? decryptName(res.at, key) : null
  if (name == null) throw new MegaApiError(-14)
  return { handle: link.id, key, name, size: res.s ?? 0 }
}

async function loadFolder(link: Extract<MegaLink, { kind: 'folder' }>): Promise<MegaShareNode> {
  const shareKey = linkKey(link, 16)
  const res = await apiRequest<{ f?: RawNode[] }>({ a: 'f', c: 1, r: 1, ca: 1 }, { n: link.id })
  const raw = res.f ?? []
  const handles = new Set(raw.map((node) => node.h))
  const top = raw.find((node) => !handles.has(node.p))
  if (!top) throw new MegaApiError(-9)

  const nodes = new Map<string, MegaShareNode>()
  for (const node of raw) {
    const parts = node.k.split('/').map((part) => part.split(':'))
    const encrypted = (parts.find(([owner]) => owner === top.h) ?? parts[0])?.[1]
    if (!encrypted) continue
    const key = decryptKey(Buffer.from(encrypted, 'base64url'), shareKey)
    const directory = node.t === 1
    if (key.length !== (directory ? 16 : 32)) continue
    nodes.set(node.h, {
      handle: node.h,
      key,
      folderId: link.id,
      name: decryptName(node.a, key),
      size: node.s ?? 0,
      directory,
      children: directory ? [] : undefined
    })
  }
  for (const node of raw) {
    const child = nodes.get(node.h)
    if (child && node.h !== top.h) nodes.get(node.p)?.children?.push(child)
  }

  const root = nodes.get(link.node ?? top.h)
  if (!root || root.name == null) throw new MegaApiError(link.node && !root ? -9 : -14)
  return root
}

/** Load a share's metadata: a single file, or a folder tree with decrypted names and keys. */
export function loadMegaShare(link: MegaLink): Promise<MegaShareNode> {
  return link.kind === 'file' ? loadFile(link) : loadFolder(link)
}

/** A fresh storage URL; append `/<start>-<end>` to fetch encrypted bytes. */
export async function megaStorageUrl(file: MegaShareNode): Promise<string> {
  const res = file.folderId
    ? await apiRequest<{ g?: unknown; e?: unknown }>(
        { a: 'g', g: 1, ssl: 2, n: file.handle },
        { n: file.folderId }
      )
    : await apiRequest<{ g?: unknown; e?: unknown }>({ a: 'g', g: 1, ssl: 2, p: file.handle })
  if (typeof res.e === 'number' && res.e < 0) throw new MegaApiError(res.e)
  if (typeof res.g !== 'string' || !/^https?:/i.test(res.g)) {
    throw new Error('MEGA returned no download URL')
  }
  return res.g
}
