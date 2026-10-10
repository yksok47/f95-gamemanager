import { describe, expect, test } from 'bun:test'
import {
  decideConnectorFile,
  hostOsKind,
  osKindsFromFilename,
  platformCandidateFiles,
  requestedOsKind
} from './connector-files'
import { OS_KIND_IDS } from './types'

const file = (name: string, size = 1) => ({ name, size })

describe('osKindsFromFilename', () => {
  test('reads common F95 filename spellings', () => {
    expect(osKindsFromFilename('Game-Win-v1.2.zip')).toEqual(['win'])
    expect(osKindsFromFilename('Game_Linux_v1.7z')).toEqual(['linux'])
    expect(osKindsFromFilename('Build-macOS.dmg')).toEqual(['mac'])
    expect(osKindsFromFilename('Game.apk')).toEqual(['android'])
    expect(osKindsFromFilename('Setup.exe')).toEqual(['win'])
    expect(osKindsFromFilename('PC-Linux-Mac.zip')).toEqual(['win', 'linux', 'mac'])
  })

  test('does not invent an OS from a generic archive name', () => {
    expect(osKindsFromFilename('Harem_Hotel_v1.2.zip')).toEqual([])
    expect(osKindsFromFilename('winning-entry.zip')).toEqual([])
    expect(osKindsFromFilename('compact-edition.zip')).toEqual([])
  })
})

describe('platformCandidateFiles', () => {
  test('drops sidecars when archives exist', () => {
    const picked = platformCandidateFiles([
      file('readme.txt', 12),
      file('Game-Win.zip', 100),
      file('cover.jpg', 40)
    ])
    expect(picked.map((item) => item.name)).toEqual(['Game-Win.zip'])
  })
})

describe('requestedOsKind / hostOsKind', () => {
  test('only a single F95 OS tag counts as a request', () => {
    expect(requestedOsKind([OS_KIND_IDS.linux])).toBe('linux')
    expect(requestedOsKind([OS_KIND_IDS.win, OS_KIND_IDS.linux])).toBeNull()
    expect(requestedOsKind([])).toBeNull()
    expect(hostOsKind('win32')).toBe('win')
    expect(hostOsKind('darwin')).toBe('mac')
    expect(hostOsKind('linux')).toBe('linux')
  })
})

describe('decideConnectorFile', () => {
  test('picks the only archive', () => {
    const decision = decideConnectorFile(
      [file('readme.txt', 9_000), file('Game.zip', 100)],
      'win'
    )
    expect(decision.kind).toBe('file')
    if (decision.kind === 'file') expect(decision.file.name).toBe('Game.zip')
  })

  test('picks the host OS when Win/Linux/Android are labeled', () => {
    const files = [
      file('Game-Win.zip', 800),
      file('Game-Linux.zip', 790),
      file('Game-Android.apk', 200)
    ]
    const win = decideConnectorFile(files, 'win')
    expect(win.kind).toBe('file')
    if (win.kind === 'file') expect(win.file.name).toBe('Game-Win.zip')

    const linux = decideConnectorFile(files, 'linux')
    expect(linux.kind).toBe('file')
    if (linux.kind === 'file') expect(linux.file.name).toBe('Game-Linux.zip')
  })

  test('does not pick the largest file when OS tags are missing', () => {
    const decision = decideConnectorFile(
      [file('Game.zip', 100), file('Game-alt.zip', 900)],
      'win'
    )
    expect(decision.kind).toBe('choose')
    if (decision.kind === 'choose') {
      expect(decision.files.map((item) => item.name)).toEqual(['Game.zip', 'Game-alt.zip'])
    }
  })

  test('does not auto-pick when two files match the wanted OS', () => {
    const decision = decideConnectorFile(
      [file('Game-Win.zip', 800), file('Game-Win-HQ.zip', 1200), file('Game-Linux.zip', 700)],
      'win'
    )
    expect(decision.kind).toBe('choose')
  })

  test('treats an untagged archive as the remainder when others are labeled', () => {
    const decision = decideConnectorFile(
      [file('Game.zip', 800), file('Game-Android.apk', 200)],
      'win'
    )
    expect(decision.kind).toBe('file')
    if (decision.kind === 'file') expect(decision.file.name).toBe('Game.zip')
  })

  test('prompts when an untagged extra sits next to a single labeled OS', () => {
    const decision = decideConnectorFile(
      [file('Game.zip', 800), file('Game-Win.zip', 700)],
      'win'
    )
    expect(decision.kind).toBe('choose')
  })

  test('prompts when the wanted OS is unknown', () => {
    const decision = decideConnectorFile(
      [file('Game-Win.zip'), file('Game-Linux.zip')],
      null
    )
    expect(decision.kind).toBe('choose')
  })
})
