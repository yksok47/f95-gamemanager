import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { readRenpyOptions, setRenpyOptions } from './options'
import { MANAGED_OPTIONS_FILE } from './tools'

const temps: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'renpy-options-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('save naming option', () => {
  test('writes a prompt hook when enabled and reads it back', async () => {
    const gameDir = tempDir()
    mkdirSync(gameDir, { recursive: true })
    const values = await setRenpyOptions(gameDir, { 'save-naming': true })
    expect(values['save-naming']).toBe(true)

    const source = readFileSync(join(gameDir, MANAGED_OPTIONS_FILE), 'utf8')
    expect(source).toContain('_f95gm_save_naming = True')
    expect(source).toContain('_f95gm_FileSave_named')
    expect(source).toContain("_f95gm_fill_save_name")
    expect(readRenpyOptions(gameDir)['save-naming']).toBe(true)
  })

  test('keeps the flag off without wrapping FileSave', async () => {
    const gameDir = tempDir()
    mkdirSync(gameDir, { recursive: true })
    const values = await setRenpyOptions(gameDir, { 'save-naming': false })
    expect(values['save-naming']).toBe(false)

    const source = readFileSync(join(gameDir, MANAGED_OPTIONS_FILE), 'utf8')
    expect(source).toContain('_f95gm_save_naming = False')
    expect(source).not.toContain('_f95gm_FileSave_named')
    expect(readRenpyOptions(gameDir)['save-naming']).toBe(false)
  })
})
