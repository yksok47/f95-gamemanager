import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  findSecurityKeysFile,
  parseSigningKeyDers,
  signSaveLog,
  updateSaveSignatures,
  verifySaveLog
} from './save-token'

const temps: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'renpy-save-token-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function makeKeys(): { text: string; ders: Buffer[] } {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const sk = privateKey.export({ format: 'der', type: 'sec1' }) as Buffer
  const vk = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  return {
    text: `signing-key ${sk.toString('base64')} ${vk.toString('base64')}\n`,
    ders: [sk]
  }
}

describe('save token signatures', () => {
  test('signs pickle log bytes the way RenPy verifies them', () => {
    const { ders } = makeKeys()
    const log = Buffer.from('store.money\x4b\x64', 'latin1')
    const signatures = signSaveLog(log, ders)
    expect(signatures.toString('ascii')).toMatch(/^signature [A-Za-z0-9+/]+=* [A-Za-z0-9+/]+=*\n$/)
    expect(verifySaveLog(log, signatures)).toBe(true)
    expect(verifySaveLog(Buffer.from('tampered'), signatures)).toBe(false)
  })

  test('parses signing-key lines and ignores comments', () => {
    const { text, ders } = makeKeys()
    const parsed = parseSigningKeyDers(`# token file\n\n${text}verifying-key QQ==\n`)
    expect(parsed).toEqual(ders)
  })

  test('finds security_keys.txt by walking up from the save', () => {
    const dir = tempDir()
    const nested = join(dir, 'LoveAndSexSecondBase')
    mkdirSync(join(dir, 'tokens'), { recursive: true })
    mkdirSync(nested, { recursive: true })
    const keysPath = join(dir, 'tokens', 'security_keys.txt')
    writeFileSync(keysPath, makeKeys().text)
    expect(findSecurityKeysFile(join(nested, '1-1.save'))).toBe(keysPath)
  })

  test('prefers a portable Ren\'Py Data tokens folder', () => {
    const dir = tempDir()
    const data = join(dir, "Ren'Py Data")
    const saves = join(data, 'GameSaves')
    mkdirSync(join(data, 'tokens'), { recursive: true })
    mkdirSync(saves, { recursive: true })
    const keysPath = join(data, 'tokens', 'security_keys.txt')
    writeFileSync(keysPath, makeKeys().text)
    expect(findSecurityKeysFile(join(saves, '1-1.save'))).toBe(keysPath)
  })

  test('returns null when no keys file exists along the search path', () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    expect(findSecurityKeysFile(join(dir, '1-1.save'), [], join(dir, 'missing', 'security_keys.txt'))).toBeNull()
  })

  test('refuses to update signatures when the computer keys are missing', async () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    const names = ['log', 'signatures']
    const files = new Map<string, Buffer>([
      ['log', Buffer.from('pickle')],
      ['signatures', Buffer.from('old')]
    ])
    await expect(
      updateSaveSignatures(join(dir, '1-1.save'), names, files, [], join(dir, 'missing', 'security_keys.txt'))
    ).rejects.toThrow(/security_keys/)
  })
})
