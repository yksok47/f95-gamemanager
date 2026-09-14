/**
 * Per-thread private notes the user keeps about a game (sketch pad).
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getAppPaths } from './paths'

export type GameNotesStore = {
  version: 1
  /** threadId → note text */
  notes: Record<string, string>
}

let cache: GameNotesStore | null = null
let writeChain: Promise<void> = Promise.resolve()

function empty(): GameNotesStore {
  return { version: 1, notes: {} }
}

function normalize(value: unknown): GameNotesStore {
  if (!value || typeof value !== 'object') return empty()
  const raw = value as Partial<GameNotesStore>
  if (!raw.notes || typeof raw.notes !== 'object') return empty()
  const notes: Record<string, string> = {}
  for (const [key, text] of Object.entries(raw.notes)) {
    if (!/^\d+$/.test(key)) continue
    if (typeof text !== 'string') continue
    if (!text) continue
    notes[key] = text
  }
  return { version: 1, notes }
}

async function loadStore(): Promise<GameNotesStore> {
  if (cache) return cache
  try {
    const raw = await readFile(getAppPaths().gameNotesFile, 'utf8')
    cache = normalize(JSON.parse(raw))
  } catch {
    cache = empty()
  }
  return cache
}

async function persist(store: GameNotesStore): Promise<void> {
  const file = getAppPaths().gameNotesFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8')
}

function queueWrite(store: GameNotesStore): Promise<void> {
  cache = store
  writeChain = writeChain
    .then(() => persist(store))
    .catch((error) => {
      console.warn('[game-notes] persist failed', error)
    })
  return writeChain
}

export async function getGameNote(threadId: number): Promise<string> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) return ''
  const store = await loadStore()
  return store.notes[String(id)] ?? ''
}

export async function setGameNote(threadId: number, text: string): Promise<string> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Invalid thread id.')
  }
  const store = await loadStore()
  const nextText = typeof text === 'string' ? text : ''
  const key = String(id)
  const notes = { ...store.notes }
  if (!nextText) delete notes[key]
  else notes[key] = nextText
  await queueWrite({ version: 1, notes })
  return nextText
}
