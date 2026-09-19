import { describe, expect, test } from 'bun:test'
import {
  compareLaunchCandidates,
  isLaunchCandidate,
  scoreLaunchPath
} from './launch-detect'

describe('isLaunchCandidate', () => {
  test('windows only accepts exe files', () => {
    expect(isLaunchCandidate('Game.exe', 'file', 'win32')).toBe(true)
    expect(isLaunchCandidate('Game.sh', 'file', 'win32')).toBe(false)
    expect(isLaunchCandidate('Game', 'file', 'win32')).toBe(false)
    expect(isLaunchCandidate('Game.app', 'dir', 'win32')).toBe(false)
    expect(isLaunchCandidate('python.exe', 'file', 'win32')).toBe(false)
    expect(isLaunchCandidate('UnityCrashHandler64.exe', 'file', 'win32')).toBe(false)
  })

  test('linux accepts shell scripts, arch binaries, and extensionless files', () => {
    expect(isLaunchCandidate('Game.sh', 'file', 'linux')).toBe(true)
    expect(isLaunchCandidate('Game.x86_64', 'file', 'linux')).toBe(true)
    expect(isLaunchCandidate('Game', 'file', 'linux')).toBe(true)
    expect(isLaunchCandidate('Game.exe', 'file', 'linux')).toBe(false)
    expect(isLaunchCandidate('python', 'file', 'linux')).toBe(false)
    expect(isLaunchCandidate('python3', 'file', 'linux')).toBe(false)
    expect(isLaunchCandidate('libpython.so', 'file', 'linux')).toBe(false)
    expect(isLaunchCandidate('script.rpy', 'file', 'linux')).toBe(false)
    expect(isLaunchCandidate('Game.app', 'dir', 'linux')).toBe(false)
  })

  test('mac accepts app bundles and unix launchers', () => {
    expect(isLaunchCandidate('Game.app', 'dir', 'darwin')).toBe(true)
    expect(isLaunchCandidate('Game.command', 'file', 'darwin')).toBe(true)
    expect(isLaunchCandidate('Game.sh', 'file', 'darwin')).toBe(true)
    expect(isLaunchCandidate('Game', 'file', 'darwin')).toBe(true)
    expect(isLaunchCandidate('Game.exe', 'file', 'darwin')).toBe(false)
    expect(isLaunchCandidate('Game.app', 'file', 'darwin')).toBe(false)
  })
})

describe('scoreLaunchPath', () => {
  test('prefers a linux shell launcher over a nested lib binary', () => {
    const sh = scoreLaunchPath('/game/Title.sh', 'linux', 'x64')
    const bin = scoreLaunchPath('/game/lib/py3-linux-x86_64/Title', 'linux', 'x64')
    expect(sh).toBeGreaterThan(bin)
  })

  test('prefers a mac app bundle over a shell script', () => {
    const app = scoreLaunchPath('/game/Title.app', 'darwin', 'arm64')
    const sh = scoreLaunchPath('/game/Title.sh', 'darwin', 'arm64')
    expect(app).toBeGreaterThan(sh)
  })

  test('prefers host architecture on linux', () => {
    const x64 = scoreLaunchPath('/game/Title.x86_64', 'linux', 'x64')
    const arm = scoreLaunchPath('/game/Title.arm64', 'linux', 'x64')
    expect(x64).toBeGreaterThan(arm)
  })
})

describe('compareLaunchCandidates', () => {
  test('sorts linux candidates with the shell launcher first', () => {
    const files = [
      '/game/lib/py3-linux-x86_64/Title',
      '/game/Title.sh',
      '/game/lib/py3-linux-i686/Title'
    ]
    const ranked = [...files].sort((a, b) => compareLaunchCandidates(a, b, 'linux', 'x64'))
    expect(ranked[0]).toBe('/game/Title.sh')
  })
})
