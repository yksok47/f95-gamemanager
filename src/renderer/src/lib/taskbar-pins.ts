import type { GameSummary } from '@shared/types'

export const TASKBAR_PINS_STORAGE_KEY = 'taskbar-pins'

export type TaskbarPin = {
  threadId: number
  title: string
  coverUrl: string | null
  creator: string
  version: string
  threadUrl: string
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseTaskbarPins(value: unknown): TaskbarPin[] {
  if (!Array.isArray(value)) return []
  const pins: TaskbarPin[] = []
  const seen = new Set<number>()
  for (const entry of value) {
    const pin = parseTaskbarPin(entry)
    if (!pin || seen.has(pin.threadId)) continue
    seen.add(pin.threadId)
    pins.push(pin)
  }
  return pins
}

export function parseTaskbarPin(value: unknown): TaskbarPin | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<TaskbarPin>
  const threadId = Number(raw.threadId)
  if (!Number.isFinite(threadId) || threadId <= 0) return null
  const title = asText(raw.title) || `Thread ${threadId}`
  return {
    threadId,
    title,
    coverUrl: asText(raw.coverUrl) || null,
    creator: asText(raw.creator),
    version: asText(raw.version),
    threadUrl: asText(raw.threadUrl) || `https://f95zone.to/threads/${threadId}/`
  }
}

export function pinsEqual(a: TaskbarPin, b: TaskbarPin): boolean {
  return (
    a.threadId === b.threadId &&
    a.title === b.title &&
    a.coverUrl === b.coverUrl &&
    a.creator === b.creator &&
    a.version === b.version &&
    a.threadUrl === b.threadUrl
  )
}

export function pinFromSummary(
  game: Pick<GameSummary, 'threadId' | 'title' | 'coverUrl' | 'creator' | 'version' | 'threadUrl'>
): TaskbarPin | null {
  return parseTaskbarPin(game)
}

export function summaryFromPin(pin: TaskbarPin): GameSummary {
  return {
    threadId: pin.threadId,
    title: pin.title || `Thread ${pin.threadId}`,
    creator: pin.creator,
    version: pin.version,
    coverUrl: pin.coverUrl,
    rating: 0,
    likes: 0,
    views: 0,
    threadUrl: pin.threadUrl
  }
}

export function addTaskbarPin(pins: TaskbarPin[], pin: TaskbarPin): TaskbarPin[] {
  if (pins.some((item) => item.threadId === pin.threadId)) return pins
  return [...pins, pin]
}

export function removeTaskbarPin(pins: TaskbarPin[], threadId: number): TaskbarPin[] {
  const next = pins.filter((item) => item.threadId !== threadId)
  return next.length === pins.length ? pins : next
}

export function updateTaskbarPin(pins: TaskbarPin[], pin: TaskbarPin): TaskbarPin[] {
  const index = pins.findIndex((item) => item.threadId === pin.threadId)
  if (index === -1) return pins
  if (pinsEqual(pins[index], pin)) return pins
  const next = pins.slice()
  next[index] = pin
  return next
}

/** Keep pinned games in the current taskbar order. */
export function pinsFromWindows(
  windows: Array<Pick<GameSummary, 'threadId' | 'title' | 'coverUrl' | 'creator' | 'version' | 'threadUrl'>>,
  pinnedIds: ReadonlySet<number>,
  previous: TaskbarPin[]
): TaskbarPin[] {
  const prevById = new Map(previous.map((pin) => [pin.threadId, pin]))
  const next: TaskbarPin[] = []
  const seen = new Set<number>()
  for (const game of windows) {
    if (!pinnedIds.has(game.threadId) || seen.has(game.threadId)) continue
    const pin = pinFromSummary(game) ?? prevById.get(game.threadId)
    if (!pin) continue
    seen.add(pin.threadId)
    next.push(pin)
  }
  for (const pin of previous) {
    if (!pinnedIds.has(pin.threadId) || seen.has(pin.threadId)) continue
    seen.add(pin.threadId)
    next.push(pin)
  }
  return next
}

export function loadTaskbarPins(): TaskbarPin[] {
  try {
    const raw = window.localStorage.getItem(TASKBAR_PINS_STORAGE_KEY)
    if (!raw) return []
    return parseTaskbarPins(JSON.parse(raw) as unknown)
  } catch {
    return []
  }
}

export function saveTaskbarPins(pins: TaskbarPin[]): void {
  try {
    window.localStorage.setItem(TASKBAR_PINS_STORAGE_KEY, JSON.stringify(pins))
  } catch {
    /* ignore quota / private-mode failures */
  }
}
