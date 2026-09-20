import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateRawSync, deflateSync, gzipSync } from 'node:zlib'
import { afterEach, describe, expect, test } from 'bun:test'
import { compressToBase64, compressToBase64Mv, decompressFromBase64, decompressFromBase64Mv } from './lz-string'
import {
  applySaveEditor,
  applySavePatches,
  decodeSaveBuffer,
  encodeSaveBuffer,
  flattenSave,
  readSaveEditor
} from './save-edit'

const temps: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'rpgmaker-save-edit-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

const sample = {
  '@': 'Object',
  party: { '@': 'Game_Party', _gold: 120, _steps: 40 },
  actors: [
    null,
    { '@': 'Game_Actor', _name: 'Hero', _level: 5, _hp: 80, _mp: 20, _exp: 1200 }
  ],
  switches: { _data: [null, true, false] },
  variables: { _data: [null, 7, 0] }
}

describe('lz-string', () => {
  const json = JSON.stringify({ hello: 'world', n: 42, ok: true, name: 'Héro' })

  test('MV corescript Base64 roundtrips JSON', () => {
    const packed = compressToBase64Mv(json)
    expect(packed).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(decompressFromBase64Mv(packed)).toBe(json)
  })

  test('matches RPG Maker MV corescript byte-for-byte', async () => {
    const orig = (await import('./lz-string-mv.fixture.js')).default as {
      compressToBase64: (input: string) => string
      decompressFromBase64: (input: string) => string
    }
    const samples = [
      'hello',
      json,
      JSON.stringify(sample),
      'x'.repeat(2000)
    ]
    for (const text of samples) {
      const packed = orig.compressToBase64(text)
      expect(compressToBase64Mv(text)).toBe(packed)
      expect(decompressFromBase64Mv(packed)).toBe(text)
      expect(orig.decompressFromBase64(compressToBase64Mv(text))).toBe(text)
    }
  })

  test('modern lz-string Base64 roundtrips JSON', () => {
    const packed = compressToBase64(json)
    expect(decompressFromBase64(packed)).toBe(json)
  })

  test('modern-compressed JSON still decodes even if the MV unpacker also accepts it', () => {
    const packed = compressToBase64(json)
    expect(decompressFromBase64(packed)).toBe(json)
    const fromMv = decompressFromBase64Mv(packed)
    expect(fromMv === json || !fromMv).toBe(true)
  })
})

describe('decode/encode save buffer', () => {
  test('detects plain JSON, zlib, raw deflate, gzip, and both LZ flavors', () => {
    const json = JSON.stringify(sample)
    expect(decodeSaveBuffer(Buffer.from(json, 'utf8')).codec).toBe('json')
    expect(decodeSaveBuffer(deflateSync(Buffer.from(json))).codec).toBe('zlib')
    expect(decodeSaveBuffer(deflateRawSync(Buffer.from(json))).codec).toBe('deflate')
    expect(decodeSaveBuffer(gzipSync(Buffer.from(json))).codec).toBe('gzip')
    expect(decodeSaveBuffer(Buffer.from(compressToBase64Mv(json), 'utf8')).codec).toBe('lz-mv')
    expect(decodeSaveBuffer(Buffer.from(compressToBase64(json), 'utf8')).data).toEqual(JSON.parse(json))
  })

  test('rewrites with the detected codec', () => {
    for (const codec of ['json', 'lz-mv', 'zlib', 'deflate', 'gzip'] as const) {
      const buf = encodeSaveBuffer(sample, codec)
      const decoded = decodeSaveBuffer(buf)
      expect(decoded.codec).toBe(codec)
      expect(decoded.data).toEqual(sample)
    }
    expect(decodeSaveBuffer(encodeSaveBuffer(sample, 'lz-modern')).data).toEqual(sample)
  })
})

describe('flattenSave / applySavePatches', () => {
  test('exposes gold, levels, switches, and constructor tags', () => {
    const rows = flattenSave(sample)
    const byName = new Map(rows.map((row) => [row.displayName, row]))
    expect(byName.get('party._gold')).toMatchObject({ type: 'Integer', value: 120, editable: true })
    expect(byName.get('actors.1._level')).toMatchObject({ type: 'Integer', value: 5, editable: true })
    expect(byName.get('actors.1._name')).toMatchObject({ type: 'String', value: 'Hero', editable: true })
    expect(byName.get('switches._data.1')).toMatchObject({ type: 'Boolean', value: true, editable: true })
    expect(byName.get('party.@')).toMatchObject({ type: 'String', value: 'Game_Party', editable: false })
    expect(byName.get('actors.0')).toMatchObject({ type: 'Null', value: null, editable: false })
  })

  test('patches integers, booleans, and strings in the object graph', () => {
    const next = structuredClone(sample)
    applySavePatches(next, [
      { path: ['party', '_gold'], value: 999999 },
      { path: ['actors', '1', '_level'], value: 99 },
      { path: ['switches', '_data', '1'], value: false },
      { path: ['actors', '1', '_name'], value: 'Renamed' }
    ])
    expect(next.party._gold).toBe(999999)
    expect(next.actors[1]?._level).toBe(99)
    expect(next.switches._data[1]).toBe(false)
    expect(next.actors[1]?._name).toBe('Renamed')
    expect(next.party['@']).toBe('Game_Party')
  })

  test('rejects a float for an integer field', () => {
    expect(() => applySavePatches(structuredClone(sample), [{ path: ['party', '_gold'], value: 1.5 }])).toThrow(
      /whole number/
    )
  })
})

describe('read/apply save files', () => {
  test('edits an MV .rpgsave and keeps a backup', async () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    const savePath = join(dir, 'file1.rpgsave')
    writeFileSync(savePath, encodeSaveBuffer(sample, 'lz-mv'))

    const loaded = await readSaveEditor(savePath)
    expect(loaded.codec).toBe('lz-mv')
    const gold = loaded.variables.find((row) => row.displayName === 'party._gold')
    expect(gold).toBeTruthy()
    await applySaveEditor(savePath, [{ path: gold!.path, value: 42 }])

    const again = await readSaveEditor(savePath)
    expect(again.variables.find((row) => row.displayName === 'party._gold')?.value).toBe(42)
    expect(readFileSync(`${savePath}.bak`).length).toBeGreaterThan(0)
    expect(decodeSaveBuffer(readFileSync(savePath)).codec).toBe('lz-mv')
  })

  test('edits an MZ .rmmzsave zlib file', async () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    const savePath = join(dir, 'file1.rmmzsave')
    writeFileSync(savePath, encodeSaveBuffer(sample, 'zlib'))

    const loaded = await readSaveEditor(savePath)
    expect(loaded.codec).toBe('zlib')
    const level = loaded.variables.find((row) => row.displayName === 'actors.1._level')
    await applySaveEditor(savePath, [{ path: level!.path, value: 20 }])
    const again = await readSaveEditor(savePath)
    expect(again.codec).toBe('zlib')
    expect(again.variables.find((row) => row.displayName === 'actors.1._level')?.value).toBe(20)
  })
})
