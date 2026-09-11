import { describe, expect, test } from 'bun:test'
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'crypto'
import { buildShareClaimMessage } from './share-claim'

describe('buildShareClaimMessage', () => {
  test('exact 5-line v1 format, no trailing newline', () => {
    const msg = buildShareClaimMessage({
      contentHash: 'AA',
      infoHash: 'BB',
      normalizedName: 'name',
      ts: 100
    })
    expect(msg).toBe(
      'f95-gm:share:v1\ncontentHash=aa\ninfoHash=bb\nnormalizedName=name\nts=100'
    )
    expect(msg.endsWith('\n')).toBe(false)
  })

  test('empty infoHash allowed', () => {
    const msg = buildShareClaimMessage({
      contentHash: 'cc',
      infoHash: null,
      normalizedName: 'pack.bin',
      ts: 1
    })
    expect(msg).toContain('infoHash=\n')
  })
})

describe('share-claim ed25519 roundtrip (node crypto)', () => {
  test('sign and verify message bytes', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const message = buildShareClaimMessage({
      contentHash: 'a'.repeat(64),
      infoHash: 'b'.repeat(40),
      normalizedName: 'spike.bin',
      ts: 1700000000
    })
    const sig = sign(null, Buffer.from(message, 'utf8'), privateKey)
    expect(sig.length).toBe(64)
    expect(sig.toString('base64').length).toBeGreaterThan(80)

    const der = Buffer.from(publicKey.export({ type: 'spki', format: 'der' }))
    const pubkeyHex = der.subarray(der.length - 32).toString('hex')
    expect(pubkeyHex).toHaveLength(64)

    const ok = verify(null, Buffer.from(message, 'utf8'), publicKey, sig)
    expect(ok).toBe(true)

    // Round-trip through PEM recreate (same as identity store path)
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const key2 = createPrivateKey(pem)
    const pub2 = createPublicKey(key2)
    const sig2 = sign(null, Buffer.from(message, 'utf8'), key2)
    expect(verify(null, Buffer.from(message, 'utf8'), pub2, sig2)).toBe(true)
  })
})