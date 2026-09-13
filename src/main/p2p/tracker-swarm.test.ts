import { describe, expect, test } from 'bun:test'
import { hexInfoHashToBinary, scrapeCounts, toHexInfoHash } from './tracker-swarm-parse'

const HEX = 'aabbccddeeff00112233445566778899aabbccdd'

describe('hexInfoHashToBinary', () => {
  test('converts 40-char hex to length-20 binary (tracker WS format)', () => {
    const binary = hexInfoHashToBinary(HEX)
    expect(binary).not.toBeNull()
    expect(binary!.length).toBe(20)
    expect(Buffer.from(binary!, 'binary').toString('hex')).toBe(HEX)
  })

  test('rejects non-hex', () => {
    expect(hexInfoHashToBinary('not-a-hash')).toBeNull()
    expect(hexInfoHashToBinary(HEX.slice(0, 39))).toBeNull()
  })
})

describe('toHexInfoHash / scrapeCounts', () => {
  test('round-trips binary file keys from scrape response', () => {
    const binary = hexInfoHashToBinary(HEX)!
    expect(toHexInfoHash(binary)).toBe(HEX)
    const counts = scrapeCounts({
      [binary]: { complete: 2, incomplete: 0 }
    })
    expect(counts.get(HEX)).toBe(2)
  })

  test('accepts hex file keys', () => {
    const counts = scrapeCounts({
      [HEX]: { complete: 1, incomplete: 1 }
    })
    expect(counts.get(HEX)).toBe(1)
  })
})
