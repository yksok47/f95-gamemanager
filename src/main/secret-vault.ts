import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { safeStorage } from 'electron'
import { tpmSupported, tpmUnwrap, tpmWrap } from './tpm'

export type SealedSecret =
  | { scheme: 'tpm'; keyName: string; key: string; iv: string; tag: string; data: string }
  | { scheme: 'safe-storage'; data: string }

export function isSealedSecret(value: unknown): value is SealedSecret {
  if (!value || typeof value !== 'object') return false
  const raw = value as Record<string, unknown>
  if (raw.scheme === 'tpm') {
    return ['keyName', 'key', 'iv', 'tag', 'data'].every((field) => typeof raw[field] === 'string')
  }
  return raw.scheme === 'safe-storage' && typeof raw.data === 'string'
}

function safeStorageUsable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false
    return process.platform !== 'linux' || safeStorage.getSelectedStorageBackend() !== 'basic_text'
  } catch {
    return false
  }
}

async function sealWithTpm(keyName: string, plain: Buffer): Promise<SealedSecret> {
  const dataKey = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', dataKey, iv)
  const data = Buffer.concat([cipher.update(plain), cipher.final()])
  const wrapped = await tpmWrap(keyName, dataKey)
  return {
    scheme: 'tpm',
    keyName,
    key: wrapped.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64')
  }
}

export async function sealSecret(keyName: string, plain: string): Promise<SealedSecret | null> {
  const bytes = Buffer.from(plain, 'utf8')
  if (tpmSupported()) {
    try {
      return await sealWithTpm(keyName, bytes)
    } catch (error) {
      console.warn('[secret-vault] TPM unavailable, falling back to OS secure storage', error)
    }
  }
  if (safeStorageUsable()) {
    return { scheme: 'safe-storage', data: safeStorage.encryptString(plain).toString('base64') }
  }
  return null
}

export async function unsealSecret(sealed: SealedSecret): Promise<string> {
  if (sealed.scheme === 'safe-storage') {
    return safeStorage.decryptString(Buffer.from(sealed.data, 'base64'))
  }
  const dataKey = await tpmUnwrap(sealed.keyName, Buffer.from(sealed.key, 'base64'))
  const decipher = createDecipheriv('aes-256-gcm', dataKey, Buffer.from(sealed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(sealed.data, 'base64')), decipher.final()]).toString('utf8')
}
