/**
 * Per-thread private notes the user keeps about a game (sketch pad).
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getAppPaths } from './paths'
import { sendToRenderer } from './windows'
import { clearNoteTombstone, tombstoneNote } from './cloud-user-data/state'
import { notifyUserDataChanged } from './cloud-user-data/notify'
import type { SyncedNote } from './cloud-user-data/snapshot'

export type GameNoteRecord = {
  text: string
  updatedAt: number
}

export type GameNotesStore = {
  version: 1
  notes: Record<string, GameNoteRecord>
}

let cache: GameNotesStore | null = null
let writeChain: Promise<void> = Promise.resolve()

function empty(): GameNotesStore {
  return { version: 1, notes: {} }
}

function asRecord(value: unknown, fallbackAt: number): GameNoteRecord | null {
  if (typeof value === 'string') {
    if (!value) return null
    return { text: value, updatedAt: fallbackAt }
  }
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<GameNoteRecord>
  const text = typeof raw.text === 'string' ? raw.text : ''
  if (!text) return null
  return { text, updatedAt: Number(raw.updatedAt) || fallbackAt }
}

function normalize(value: unknown): GameNotesStore {
  if (!value || typeof value !== 'object') return empty()
  const raw = value as Partial<GameNotesStore> & { notes?: Record<string, unknown> }
  if (!raw.notes || typeof raw.notes !== 'object') return empty()
  const migratedAt = Date.now()
  const notes: Record<string, GameNoteRecord> = {}
  for (const [key, item] of Object.entries(raw.notes)) {
    if (!/^\d+$/.test(key)) continue
    const next = asRecord(item, migratedAt)
    if (!next) continue
    notes[key] = next
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

function presentMap(store: GameNotesStore): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, note] of Object.entries(store.notes)) out[key] = note.text
  return out
}

function broadcast(store: GameNotesStore): void {
  sendToRenderer('game-notes:changed', presentMap(store))
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
  return store.notes[String(id)]?.text ?? ''
}

export async function listGameNotes(): Promise<SyncedNote[]> {
  const store = await loadStore()
  return Object.entries(store.notes)
    .map(([key, note]) => ({
      threadId: Number(key),
      text: note.text,
      updatedAt: note.updatedAt
    }))
    .filter((item) => item.threadId > 0 && item.text)
    .sort((a, b) => a.threadId - b.threadId)
}

export async function setGameNote(threadId: number, text: string): Promise<string> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Invalid thread id.')
  }
  const store = await loadStore()
  const nextText = typeof text === 'string' ? text : ''
  const key = String(id)
  const previous = store.notes[key]
  if ((previous?.text ?? '') === nextText) return nextText
  const notes = { ...store.notes }
  if (!nextText) {
    delete notes[key]
    await tombstoneNote(id)
  } else {
    notes[key] = { text: nextText, updatedAt: Date.now() }
    await clearNoteTombstone(id)
  }
  const next = { version: 1 as const, notes }
  await queueWrite(next)
  broadcast(next)
  notifyUserDataChanged('data')
  return nextText
}

export async function replaceGameNotes(notes: SyncedNote[]): Promise<void> {
  const mapped: Record<string, GameNoteRecord> = {}
  for (const note of notes) {
    const id = Number(note.threadId)
    if (!Number.isFinite(id) || id <= 0 || !note.text) continue
    mapped[String(id)] = { text: note.text, updatedAt: note.updatedAt || Date.now() }
  }
  const next = { version: 1 as const, notes: mapped }
  await queueWrite(next)
  broadcast(next)
}
