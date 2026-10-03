import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify, type KeyObject } from 'crypto'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { readFile } from 'fs/promises'
import { pathExists } from '../win-path'

function encodeLine(kind: string, a: Buffer, b?: Buffer): string {
  if (!b) return `${kind} ${a.toString('base64')}\n`
  return `${kind} ${a.toString('base64')} ${b.toString('base64')}\n`
}

function decodeLine(line: string): { kind: string; a: Buffer; b: Buffer | null } {
  const trimmed = line.trim()
  if (!trimmed || trimmed.startsWith('#')) return { kind: '', a: Buffer.alloc(0), b: null }
  const parts = trimmed.split(/\s+/, 3)
  try {
    if (parts.length === 2) return { kind: parts[0], a: Buffer.from(parts[1], 'base64'), b: null }
    if (parts.length >= 3) {
      return { kind: parts[0], a: Buffer.from(parts[1], 'base64'), b: Buffer.from(parts[2], 'base64') }
    }
  } catch {
    return { kind: '', a: Buffer.alloc(0), b: null }
  }
  return { kind: '', a: Buffer.alloc(0), b: null }
}

function importSigningKey(der: Buffer): KeyObject {
  try {
    return createPrivateKey({ key: der, format: 'der', type: 'sec1' })
  } catch {
    try {
      return createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
    } catch {
      const b64 = der.toString('base64').match(/.{1,64}/g)?.join('\n') || der.toString('base64')
      return createPrivateKey(`-----BEGIN EC PRIVATE KEY-----\n${b64}\n-----END EC PRIVATE KEY-----\n`)
    }
  }
}

export function parseSigningKeyDers(text: string): Buffer[] {
  const keys: Buffer[] = []
  for (const line of text.split(/\r?\n/)) {
    const { kind, a } = decodeLine(line)
    if (kind === 'signing-key' && a.length) keys.push(a)
  }
  return keys
}

export function signSaveLog(log: Buffer, signingKeyDers: Buffer[]): Buffer {
  if (!signingKeyDers.length) throw new Error("Ren'Py security_keys.txt has no signing key.")
  let text = ''
  let signed = 0
  for (const der of signingKeyDers) {
    try {
      const key = importSigningKey(der)
      const pub = createPublicKey(key).export({ type: 'spki', format: 'der' }) as Buffer
      const sig = cryptoSign('sha1', log, { key, dsaEncoding: 'ieee-p1363' })
      text += encodeLine('signature', pub, sig)
      signed += 1
    } catch {
      continue
    }
  }
  if (!signed) throw new Error("Could not sign the save with this computer's Ren'Py keys.")
  return Buffer.from(text, 'ascii')
}

export function verifySaveLog(log: Buffer, signatures: Buffer | string): boolean {
  const text = typeof signatures === 'string' ? signatures : signatures.toString('ascii')
  for (const line of text.split(/\r?\n/)) {
    const { kind, a, b } = decodeLine(line)
    if (kind !== 'signature' || !a.length || !b?.length) continue
    try {
      const key = createPublicKey({ key: a, format: 'der', type: 'spki' })
      if (cryptoVerify('sha1', log, { key, dsaEncoding: 'ieee-p1363' }, b)) return true
    } catch {
      continue
    }
  }
  return false
}

export function defaultRenpyTokensKeysPath(): string {
  const envRoot = process.env.RENPY_PATH_TO_SAVES?.trim()
  if (envRoot) return join(envRoot, 'tokens', 'security_keys.txt')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'RenPy', 'tokens', 'security_keys.txt')
  if (process.platform === 'linux') return join(homedir(), '.renpy', 'tokens', 'security_keys.txt')
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  return join(appData, 'RenPy', 'tokens', 'security_keys.txt')
}

export function findSecurityKeysFile(
  savePath: string,
  extraRoots: string[] = [],
  defaultKeysPath: string | null = defaultRenpyTokensKeysPath()
): string | null {
  const seen = new Set<string>()
  const tryFile = (file: string): string | null => {
    const resolved = resolve(file)
    if (seen.has(resolved.toLowerCase())) return null
    seen.add(resolved.toLowerCase())
    return pathExists(resolved) ? resolved : null
  }

  const walk = (start: string): string | null => {
    let dir = resolve(start)
    for (let i = 0; i < 12; i++) {
      const found =
        tryFile(join(dir, 'tokens', 'security_keys.txt')) ||
        tryFile(join(dir, "Ren'Py Data", 'tokens', 'security_keys.txt'))
      if (found) return found
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return null
  }

  const fromSave = walk(dirname(savePath))
  if (fromSave) return fromSave
  for (const root of extraRoots) {
    if (!root) continue
    const found = walk(root)
    if (found) return found
  }
  return defaultKeysPath ? tryFile(defaultKeysPath) : null
}

export async function updateSaveSignatures(
  savePath: string,
  names: string[],
  files: Map<string, Buffer>,
  extraRoots: string[] = [],
  defaultKeysPath?: string | null
): Promise<void> {
  const signaturesName = names.find((name) => name.toLowerCase() === 'signatures')
  if (!signaturesName) return
  const logName = names.find((name) => name.toLowerCase() === 'log')
  const log = logName ? files.get(logName) : null
  if (!log) return

  const keysPath = findSecurityKeysFile(
    savePath,
    extraRoots,
    defaultKeysPath === undefined ? defaultRenpyTokensKeysPath() : defaultKeysPath
  )
  if (!keysPath) {
    throw new Error("Could not find this computer's Ren'Py security_keys.txt, so the game would refuse the edited save.")
  }

  const keysText = await readFile(keysPath, 'utf8')
  files.set(signaturesName, signSaveLog(log, parseSigningKeyDers(keysText)))
}
