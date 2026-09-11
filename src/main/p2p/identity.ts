/**
 * Anonymous P2P identity: Ed25519 keypair in Electron safeStorage.
 * seederPubkey = lowercase hex 64 chars (raw 32-byte pubkey).
 * NEVER send F95 credentials to tracker/metadata.
 */

import { createPrivateKey, createPublicKey, sign, generateKeyPairSync } from 'crypto'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { safeStorage } from 'electron'
import type { P2pIdentityPublic } from '@shared/p2p'
import { getAppPaths } from '../paths'
import { buildShareClaimMessage, type ShareClaimV1Input, type ShareClaimPostBody } from './share-claim'

type StoredIdentity = {
  version: 1
  privateKeyEnc: string
  seederPubkey: string
  createdAt: number
  encrypted: boolean
}

let cached: { seederPubkey: string; privateKeyPem: string; createdAt: number } | null = null

function publicKeyToPubkeyHex(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem)
  const der = Buffer.from(key.export({ type: 'spki', format: 'der' }))
  // Ed25519 SPKI is 44 bytes; raw pubkey is last 32 → 64 hex chars
  const raw = der.length >= 32 ? der.subarray(der.length - 32) : der
  return raw.toString('hex').toLowerCase()
}

async function persist(identity: StoredIdentity): Promise<void> {
  const file = getAppPaths().p2pIdentityFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(identity, null, 2), 'utf8')
}

async function loadOrCreate(): Promise<{ seederPubkey: string; privateKeyPem: string; createdAt: number }> {
  if (cached) return cached
  const file = getAppPaths().p2pIdentityFile
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as StoredIdentity
    let privateKeyPem: string
    if (raw.encrypted && safeStorage.isEncryptionAvailable()) {
      privateKeyPem = safeStorage.decryptString(Buffer.from(raw.privateKeyEnc, 'base64'))
    } else {
      privateKeyPem = Buffer.from(raw.privateKeyEnc, 'base64').toString('utf8')
    }
    const seederPubkey = raw.seederPubkey.trim().toLowerCase()
    cached = { seederPubkey, privateKeyPem, createdAt: raw.createdAt }
    return cached
  } catch {
    // create below
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const seederPubkey = publicKeyToPubkeyHex(publicKeyPem)
  const createdAt = Date.now()

  let privateKeyEnc: string
  let encrypted = false
  if (safeStorage.isEncryptionAvailable()) {
    privateKeyEnc = safeStorage.encryptString(privateKeyPem).toString('base64')
    encrypted = true
  } else {
    console.warn('[p2p] safeStorage unavailable — storing identity key unencrypted locally')
    privateKeyEnc = Buffer.from(privateKeyPem, 'utf8').toString('base64')
  }

  await persist({ version: 1, privateKeyEnc, seederPubkey, createdAt, encrypted })
  cached = { seederPubkey, privateKeyPem, createdAt }
  return cached
}

export async function getP2pIdentity(): Promise<P2pIdentityPublic> {
  const id = await loadOrCreate()
  return { seederPubkey: id.seederPubkey, createdAt: id.createdAt }
}

/** Raw 64-byte Ed25519 signature → standard base64 */
export async function signMessageBytes(message: string): Promise<{ seederPubkey: string; signature: string }> {
  const id = await loadOrCreate()
  const key = createPrivateKey(id.privateKeyPem)
  const signature = sign(null, Buffer.from(message, 'utf8'), key).toString('base64')
  return { seederPubkey: id.seederPubkey, signature }
}

/** Build + sign share-claim v1 POST body fields. */
export async function signShareClaim(
  input: ShareClaimV1Input,
  extra?: Partial<Pick<ShareClaimPostBody, 'gameName' | 'f95ThreadId' | 'f95ThreadUrl' | 'sizeBytes'>>
): Promise<ShareClaimPostBody> {
  const ts = input.ts ?? Math.floor(Date.now() / 1000)
  const contentHash = input.contentHash.trim().toLowerCase()
  const infoHash = (input.infoHash ?? '').trim().toLowerCase()
  const normalizedName = input.normalizedName
  const message = buildShareClaimMessage({ contentHash, infoHash, normalizedName, ts })
  const { seederPubkey, signature } = await signMessageBytes(message)
  return {
    contentHash,
    infoHash,
    normalizedName,
    seederPubkey,
    ts,
    signature,
    ...extra
  }
}
