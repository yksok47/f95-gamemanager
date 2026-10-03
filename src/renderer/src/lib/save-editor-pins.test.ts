import { describe, expect, test } from 'bun:test'
import {
  parseSaveEditorPinStore,
  parseSaveEditorPins,
  readSaveEditorPins,
  saveEditorPinGameKey,
  SAVE_EDITOR_PINS_STORAGE_KEY,
  toggleSaveEditorPin,
  writeSaveEditorPins
} from './save-editor-pins'

function installMemoryStorage(): Map<string, string> {
  const memory = new Map<string, string>()
  const storage = {
    getItem(key: string): string | null {
      return memory.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      memory.set(key, String(value))
    },
    removeItem(key: string): void {
      memory.delete(key)
    }
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: storage },
    configurable: true
  })
  return memory
}

describe('save editor pins', () => {
  test('keys pins per game and engine', () => {
    expect(saveEditorPinGameKey('renpy', 42, 'file-1')).toBe('thread:42:renpy')
    expect(saveEditorPinGameKey('rpgmaker', 0, 'file-1')).toBe('file:file-1:rpgmaker')
    expect(saveEditorPinGameKey('renpy')).toBe('')
  })

  test('keeps pin order and drops junk', () => {
    expect(parseSaveEditorPins(['  money  ', 'Hazel', 'money', '', 3, null])).toEqual(['money', 'Hazel'])
    expect(parseSaveEditorPinStore({ 'thread:1:renpy': ['gold'], nope: 'x', '': ['a'] })).toEqual({
      'thread:1:renpy': ['gold']
    })
  })

  test('toggles a path on and off', () => {
    expect(toggleSaveEditorPin([], 'gold')).toEqual(['gold'])
    expect(toggleSaveEditorPin(['gold', 'hp'], 'gold')).toEqual(['hp'])
    expect(toggleSaveEditorPin(['gold'], '  ')).toEqual(['gold'])
  })

  test('persists pins for one game without clobbering another', () => {
    installMemoryStorage()
    writeSaveEditorPins('thread:1:renpy', ['money', 'Hazel'])
    writeSaveEditorPins('thread:2:rpgmaker', ['party._gold'])
    expect(readSaveEditorPins('thread:1:renpy')).toEqual(['money', 'Hazel'])
    expect(readSaveEditorPins('thread:2:rpgmaker')).toEqual(['party._gold'])
    writeSaveEditorPins('thread:1:renpy', [])
    expect(readSaveEditorPins('thread:1:renpy')).toEqual([])
    expect(readSaveEditorPins('thread:2:rpgmaker')).toEqual(['party._gold'])
    const stored = JSON.parse(window.localStorage.getItem(SAVE_EDITOR_PINS_STORAGE_KEY) || '{}') as Record<
      string,
      string[]
    >
    expect(stored['thread:1:renpy']).toBeUndefined()
  })
})
