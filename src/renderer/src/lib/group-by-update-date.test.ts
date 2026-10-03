import { describe, expect, test } from 'bun:test'
import { readGroupByUpdateDate, writeGroupByUpdateDate } from './group-by-update-date'

function installMemoryStorage(): void {
  const memory = new Map<string, string>()
  const storage = {
    getItem(key: string): string | null {
      return memory.get(key) ?? null
    },
    setItem(key: string, value: string): void {
      memory.set(key, String(value))
    },
    clear(): void {
      memory.clear()
    }
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'window', {
    value: { localStorage: storage },
    configurable: true
  })
}

describe('group-by-update-date preference', () => {
  test('is off unless localStorage is explicitly 1', () => {
    installMemoryStorage()
    expect(readGroupByUpdateDate()).toBe(false)
    writeGroupByUpdateDate(true)
    expect(readGroupByUpdateDate()).toBe(true)
    writeGroupByUpdateDate(false)
    expect(readGroupByUpdateDate()).toBe(false)
  })
})
