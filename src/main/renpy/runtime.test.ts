import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'
import { findGamePython } from './runtime'

const temps: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'renpy-python-'))
  temps.push(dir)
  return dir
}

afterEach(() => {
  while (temps.length) {
    const dir = temps.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('findGamePython', () => {
  test('finds the host python under lib/', () => {
    const root = tempDir()
    const linux = join(root, 'lib', 'py3-linux-x86_64')
    const win = join(root, 'lib', 'py3-windows-x86_64')
    const mac = join(root, 'lib', 'py3-mac-aarch64')
    mkdirSync(linux, { recursive: true })
    mkdirSync(win, { recursive: true })
    mkdirSync(mac, { recursive: true })
    writeFileSync(join(linux, 'python'), '')
    writeFileSync(join(win, 'python.exe'), '')
    writeFileSync(join(mac, 'python'), '')

    const found = findGamePython(root)
    expect(found).toBeTruthy()
    if (process.platform === 'win32') {
      expect(found?.replace(/\\/g, '/').toLowerCase()).toContain('py3-windows')
    } else if (process.platform === 'linux') {
      expect(found?.replace(/\\/g, '/')).toContain('py3-linux')
    } else if (process.platform === 'darwin') {
      expect(found?.replace(/\\/g, '/')).toContain('py3-mac')
    }
  })

  test('returns null when lib has no python', () => {
    const root = tempDir()
    mkdirSync(join(root, 'lib', 'other'), { recursive: true })
    writeFileSync(join(root, 'lib', 'other', 'readme.txt'), '')
    expect(findGamePython(root)).toBeNull()
  })
})
