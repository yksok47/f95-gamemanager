import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { applySaveEditor, applySavePatches, parseStoreVariables, readSaveEditor, writeZipBuffer } from './save-edit'
import { genops } from './pickle-ops'

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
  test('finds store.* bools, ints, and strings', () => {
    const rows = parseStoreVariables(pickleLog())
    expect(rows.map((row) => [row.displayName, row.type, row.value, row.editable])).toEqual([
      ['money', 'Integer', 100, true],
      ['flag', 'Boolean', true, true],
      ['name', 'String', 'Ann', true],
      ['score', 'Integer', 1000, true]
    ])
    expect(rows[0].kind).toBe('BININT1')
    expect(rows[1].kind).toBe('bool')
    expect(rows[2].kind).toBe('SHORT_BINUNICODE')
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

  test('patches unicode strings in place, longer, and shorter', () => {
    const name = parseStoreVariables(pickleLog())[2]
    const same = applySavePatches(pickleLog(), [{ pos: name.pos, kind: 'SHORT_BINUNICODE', value: 'Bob' }])
    expect(parseStoreVariables(same)[2].value).toBe('Bob')
    expect(same.length).toBe(pickleLog().length)

    const longer = applySavePatches(pickleLog(), [{ pos: name.pos, kind: 'SHORT_BINUNICODE', value: 'Annie' }])
    const longerRows = parseStoreVariables(longer)
    expect(longerRows[2].value).toBe('Annie')
    expect(longerRows[0].value).toBe(100)
    expect(longerRows[3].value).toBe(1000)

    const shorter = applySavePatches(pickleLog(), [{ pos: name.pos, kind: 'SHORT_BINUNICODE', value: 'Al' }])
    expect(parseStoreVariables(shorter)[2].value).toBe('Al')
    expect(parseStoreVariables(shorter)[3].value).toBe(1000)
  })

  test('promotes SHORT_BINUNICODE when the new text no longer fits', () => {
    const name = parseStoreVariables(pickleLog())[2]
    const text = 'x'.repeat(256)
    const next = applySavePatches(pickleLog(), [{ pos: name.pos, kind: 'SHORT_BINUNICODE', value: text }])
    const row = parseStoreVariables(next)[2]
    expect(row.value).toBe(text)
    expect(row.kind).toBe('BINUNICODE')
  })

  test('updates FRAME size when a string inside the frame grows', () => {
    const log = pickleLog()
    const rest = log.subarray(2)
    const frame = Buffer.alloc(9)
    frame[0] = 0x95
    frame.writeBigUInt64LE(BigInt(rest.length), 1)
    const framed = Buffer.concat([log.subarray(0, 2), frame, rest])
    const name = parseStoreVariables(framed)[2]
    const next = applySavePatches(framed, [{ pos: name.pos, kind: 'SHORT_BINUNICODE', value: 'Annie' }])
    const frameOp = genops(next).find((op) => op.name === 'FRAME')
    expect(frameOp?.arg).toBe(rest.length + 2)
    expect(parseStoreVariables(next)[2].value).toBe('Annie')
    expect(parseStoreVariables(next)[3].value).toBe(1000)
  })

  test('patches a string and a later integer together', () => {
    const rows = parseStoreVariables(pickleLog())
    const next = applySavePatches(pickleLog(), [
      { pos: rows[2].pos, kind: 'SHORT_BINUNICODE', value: 'Annie' },
      { pos: rows[3].pos, kind: 'BININT', value: 9 }
    ])
    const updated = parseStoreVariables(next)
    expect(updated[2].value).toBe('Annie')
    expect(updated[3].value).toBe(9)
  })

  test('rejects strings that are too long', () => {
    const name = parseStoreVariables(pickleLog())[2]
    expect(() =>
      applySavePatches(pickleLog(), [{ pos: name.pos, kind: 'SHORT_BINUNICODE', value: 'x'.repeat(4097) }])
    ).toThrow(/too long/)
  })

  test('edits BINUNICODE values without demoting the opcode', () => {
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
    const log = Buffer.concat([Buffer.from([0x80, 0x04]), uni1('store.title'), uni4('Chapter 1'), Buffer.from([0x2e])])
    const row = parseStoreVariables(log)[0]
    expect(row).toMatchObject({ displayName: 'title', kind: 'BINUNICODE', value: 'Chapter 1', editable: true })
    const next = applySavePatches(log, [{ pos: row.pos, kind: 'BINUNICODE', value: 'Hi' }])
    expect(parseStoreVariables(next)[0]).toMatchObject({ kind: 'BINUNICODE', value: 'Hi' })
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
    const name = loaded.variables[2]
    await applySaveEditor(savePath, [
      { pos: money.pos, kind: 'BININT1', value: 42 },
      { pos: name.pos, kind: 'SHORT_BINUNICODE', value: 'Annie' }
    ])

    const again = await readSaveEditor(savePath)
    expect(again.variables[0].value).toBe(42)
    expect(again.variables[2].value).toBe('Annie')
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
