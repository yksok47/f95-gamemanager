export const HTML_STORAGE_FILE = 'localStorage.json'

export type HtmlStorageDump = {
  savedAt: number
  keys: Record<string, string>
}

export function emptyHtmlStorageDump(): HtmlStorageDump {
  return { savedAt: 0, keys: {} }
}

export function parseHtmlStorageDump(raw: string): HtmlStorageDump | null {
  if (!raw.trim()) return null
  try {
    const parsed = JSON.parse(raw) as Partial<HtmlStorageDump> & { keys?: unknown }
    const keys: Record<string, string> = {}
    const source =
      parsed.keys && typeof parsed.keys === 'object' && !Array.isArray(parsed.keys)
        ? parsed.keys
        : parsed
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (key === 'savedAt' || key === 'keys' || key === 'origin') continue
      if (typeof key !== 'string' || typeof value !== 'string') continue
      keys[key] = value
    }
    if (parsed.keys && typeof parsed.keys === 'object' && !Array.isArray(parsed.keys)) {
      for (const [key, value] of Object.entries(parsed.keys as Record<string, unknown>)) {
        if (typeof key !== 'string' || typeof value !== 'string') continue
        keys[key] = value
      }
    }
    const savedAt = Number(parsed.savedAt)
    return {
      savedAt: Number.isFinite(savedAt) ? savedAt : 0,
      keys
    }
  } catch {
    return null
  }
}

export function serializeHtmlStorageDump(dump: HtmlStorageDump): string {
  return `${JSON.stringify({ savedAt: dump.savedAt, keys: dump.keys }, null, 2)}\n`
}

export function mergeHtmlStorage(
  live: Record<string, string>,
  backup: Record<string, string>
): Record<string, string> {
  const next = { ...backup }
  for (const [key, value] of Object.entries(live)) {
    if (typeof value === 'string') next[key] = value
  }
  return next
}

export function htmlStorageBytes(keys: Record<string, string>): number {
  let total = 0
  for (const [key, value] of Object.entries(keys)) {
    total += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8')
  }
  return total
}

export function htmlStoragePreview(value: string, max = 80): string {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  return `${compact.slice(0, max - 1)}…`
}
