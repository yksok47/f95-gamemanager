import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { applySaveEditor, applySavePatches, parseStoreVariables, readSaveEditor, writeZipBuffer } from './save-edit'

const temps: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'renpy-save-edit-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

function pickleLog(): Buffer {
  function uni1(text: string): Buffer {
    const data = Buffer.from(text)
    return Buffer.concat([Buffer.from([0x8c, data.length]), data])
  }
  function uni4(text: string): Buffer {
    const data = Buffer.from(text)
    const head = Buffer.alloc(5)
    head[0] = 0x58
    head.writeUInt32LE(data.length, 1)
    return Buffer.concat([head, data])
  }
  const binint = Buffer.alloc(5)
  binint[0] = 0x4a
  binint.writeInt32LE(1000, 1)
  return Buffer.concat([
    Buffer.from([0x80, 0x04]),
    uni1('store.money'),
    Buffer.from([0x94, 0x4b, 100]),
    uni1('store.flag'),
    Buffer.from([0x94, 0x88]),
    uni1('store.name'),
    Buffer.concat([Buffer.from([0x94, 0x8c, 3]), Buffer.from('Ann')]),
    uni4('store.score'),
    binint,
    Buffer.from([0x2e])
  ])
}

describe('parseStoreVariables', () => {
  test('finds store.* bools, ints, and read-only strings', () => {
    const rows = parseStoreVariables(pickleLog())
    expect(rows.map((row) => [row.displayName, row.type, row.value, row.editable])).toEqual([
      ['money', 'Integer', 100, true],
      ['flag', 'Boolean', true, true],
      ['name', 'String', 'Ann', false],
      ['score', 'Integer', 1000, true]
    ])
    expect(rows[0].kind).toBe('BININT1')
    expect(rows[1].kind).toBe('bool')
    expect(rows[3].kind).toBe('BININT')
  })

  test('walks a FRAME header before store names', () => {
    const framed = Buffer.concat([Buffer.from([0x95, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), pickleLog()])
    expect(parseStoreVariables(framed).map((row) => row.displayName)).toEqual(['money', 'flag', 'name', 'score'])
  })
})

describe('applySavePatches', () => {
  test('patches bool and integer opcodes in place', () => {
    const next = applySavePatches(pickleLog(), [
      { pos: parseStoreVariables(pickleLog())[0].pos, kind: 'BININT1', value: 7 },
      { pos: parseStoreVariables(pickleLog())[1].pos, kind: 'bool', value: false },
      { pos: parseStoreVariables(pickleLog())[3].pos, kind: 'BININT', value: -20 }
    ])
    const rows = parseStoreVariables(next)
    expect(rows[0].value).toBe(7)
    expect(rows[1].value).toBe(false)
    expect(rows[3].value).toBe(-20)
  })

  test('rejects integers outside the original opcode width', () => {
    const money = parseStoreVariables(pickleLog())[0]
    expect(() => applySavePatches(pickleLog(), [{ pos: money.pos, kind: 'BININT1', value: 300 }])).toThrow(
      /out of range/
    )
  })
})

describe('read/apply save zip', () => {
  test('rewrites the log in a .save zip and keeps a backup', async () => {
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    const savePath = join(dir, '1-1.save')
    writeFileSync(
      savePath,
      writeZipBuffer([
        { name: 'json', data: Buffer.from('{"_save_name":"slot"}') },
        { name: 'log', data: pickleLog() }
      ])
    )

    const loaded = await readSaveEditor(savePath)
    expect(loaded.variables).toHaveLength(4)
    const money = loaded.variables[0]
    await applySaveEditor(savePath, [{ pos: money.pos, kind: 'BININT1', value: 42 }])

    const again = await readSaveEditor(savePath)
    expect(again.variables[0].value).toBe(42)
    expect(readFileSync(`${savePath}.bak`).length).toBeGreaterThan(0)
  })
})

describe('save zip inflate', () => {
  test('inflates compressed save entries without blocking the zip reader', async () => {
    const { openZipReader } = await import('../zip-read')
    const dir = tempDir()
    mkdirSync(dir, { recursive: true })
    const savePath = join(dir, '1-1.save')
    writeFileSync(
      savePath,
      writeZipBuffer([
        { name: 'json', data: Buffer.from('{"_save_name":"Evening"}') },
        { name: 'log', data: pickleLog() }
      ])
    )
    const zip = await openZipReader(savePath)
    expect(zip).not.toBeNull()
    try {
      const json = await zip!.read('json')
      expect(json?.toString('utf8')).toContain('Evening')
    } finally {
      await zip?.close()
    }
  })
})
