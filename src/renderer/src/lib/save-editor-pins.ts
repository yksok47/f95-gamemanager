import { useCallback, useEffect, useMemo, useState } from 'react'

export const SAVE_EDITOR_PINS_STORAGE_KEY = 'save-editor-pins'

export function saveEditorPinGameKey(
  engine: 'renpy' | 'rpgmaker',
  threadId?: number,
  fileId?: string
): string {
  const game = threadId && threadId > 0 ? `thread:${threadId}` : fileId ? `file:${fileId}` : ''
  return game ? `${game}:${engine}` : ''
}

function asPath(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const path = value.trim()
  return path || null
}

export function parseSaveEditorPins(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const path = asPath(entry)
    if (!path || seen.has(path)) continue
    seen.add(path)
    out.push(path)
  }
  return out
}

export function parseSaveEditorPinStore(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string[]> = {}
  for (const [key, pins] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue
    const parsed = parseSaveEditorPins(pins)
    if (parsed.length) out[key] = parsed
  }
  return out
}

export function readSaveEditorPins(gameKey: string): string[] {
  if (!gameKey) return []
  try {
    const raw = window.localStorage.getItem(SAVE_EDITOR_PINS_STORAGE_KEY)
    if (!raw) return []
    const store = parseSaveEditorPinStore(JSON.parse(raw) as unknown)
    return store[gameKey] ?? []
  } catch {
    return []
  }
}

export function writeSaveEditorPins(gameKey: string, pins: string[]): void {
  if (!gameKey) return
  try {
    const raw = window.localStorage.getItem(SAVE_EDITOR_PINS_STORAGE_KEY)
    const store = raw ? parseSaveEditorPinStore(JSON.parse(raw) as unknown) : {}
    if (pins.length) store[gameKey] = parseSaveEditorPins(pins)
    else delete store[gameKey]
    window.localStorage.setItem(SAVE_EDITOR_PINS_STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* ignore quota / private-mode failures */
  }
}

export function toggleSaveEditorPin(pins: string[], path: string): string[] {
  const next = path.trim()
  if (!next) return pins
  if (pins.includes(next)) return pins.filter((item) => item !== next)
  return [...pins, next]
}

export function useSaveEditorPins(gameKey: string): {
  pins: string[]
  pinnedPaths: Set<string>
  togglePin: (path: string) => void
} {
  const [pins, setPins] = useState<string[]>(() => readSaveEditorPins(gameKey))

  useEffect(() => {
    setPins(readSaveEditorPins(gameKey))
  }, [gameKey])

  const togglePin = useCallback(
    (path: string) => {
      setPins((current) => {
        const next = toggleSaveEditorPin(current, path)
        writeSaveEditorPins(gameKey, next)
        return next
      })
    },
    [gameKey]
  )

  const pinnedPaths = useMemo(() => new Set(pins), [pins])
  return { pins, pinnedPaths, togglePin }
}
