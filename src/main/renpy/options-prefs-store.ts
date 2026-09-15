/**
 * Desired Ren'Py runtime options: per-thread and optional global override.
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { RenpyToolId } from '@shared/types'
import { getAppPaths } from '../paths'
import { EMPTY_OPTIONS, OPTION_IDS, type OptionValues } from './options'

export type RenpyOptionsPrefsStore = {
  version: 1
  globalEnabled: boolean
  global: OptionValues
  byThread: Record<string, OptionValues>
}

let cache: RenpyOptionsPrefsStore | null = null
let writeChain: Promise<void> = Promise.resolve()

function normalizeValues(value: unknown): OptionValues {
  const raw = value && typeof value === 'object' ? (value as Partial<Record<RenpyToolId, unknown>>) : {}
  const next = { ...EMPTY_OPTIONS }
  for (const id of OPTION_IDS) {
    if (typeof raw[id] === 'boolean') next[id] = raw[id]
  }
  return next
}

function empty(): RenpyOptionsPrefsStore {
  return {
    version: 1,
    globalEnabled: false,
    global: { ...EMPTY_OPTIONS },
    byThread: {}
  }
}

function normalize(value: unknown): RenpyOptionsPrefsStore {
  if (!value || typeof value !== 'object') return empty()
  const raw = value as Partial<RenpyOptionsPrefsStore>
  const byThread: Record<string, OptionValues> = {}
  if (raw.byThread && typeof raw.byThread === 'object') {
    for (const [key, prefs] of Object.entries(raw.byThread)) {
      if (!/^\d+$/.test(key)) continue
      byThread[key] = normalizeValues(prefs)
    }
  }
  return {
    version: 1,
    globalEnabled: Boolean(raw.globalEnabled),
    global: normalizeValues(raw.global),
    byThread
  }
}

async function loadStore(): Promise<RenpyOptionsPrefsStore> {
  if (cache) return cache
  try {
    const raw = await readFile(getAppPaths().renpyOptionsFile, 'utf8')
    cache = normalize(JSON.parse(raw))
  } catch {
    cache = empty()
  }
  return cache
}

async function persist(store: RenpyOptionsPrefsStore): Promise<void> {
  const file = getAppPaths().renpyOptionsFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8')
}

function queueWrite(store: RenpyOptionsPrefsStore): Promise<void> {
  cache = store
  writeChain = writeChain
    .then(() => persist(store))
    .catch((error) => {
      console.warn('[renpy-options] persist failed', error)
    })
  return writeChain
}

export async function getRenpyOptionsPrefs(): Promise<RenpyOptionsPrefsStore> {
  return loadStore()
}

export async function isRenpyOptionsGlobalEnabled(): Promise<boolean> {
  return (await loadStore()).globalEnabled
}

/** Resolved desired prefs for a thread, or null when nothing has been saved yet. */
export async function resolveDesiredRenpyOptions(threadId: number): Promise<OptionValues | null> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) return null
  const store = await loadStore()
  if (store.globalEnabled) return { ...store.global }
  const saved = store.byThread[String(id)]
  return saved ? { ...saved } : null
}

export async function setRenpyOptionsGlobalEnabled(
  enabled: boolean,
  seedFrom?: OptionValues | null
): Promise<RenpyOptionsPrefsStore> {
  const store = await loadStore()
  const next: RenpyOptionsPrefsStore = {
    ...store,
    globalEnabled: Boolean(enabled),
    global: seedFrom && !store.globalEnabled && enabled ? { ...normalizeValues(seedFrom) } : store.global
  }
  await queueWrite(next)
  return next
}

export async function saveDesiredRenpyOptions(
  threadId: number,
  values: OptionValues
): Promise<RenpyOptionsPrefsStore> {
  const store = await loadStore()
  const normalized = normalizeValues(values)
  if (store.globalEnabled) {
    const next = { ...store, global: normalized }
    await queueWrite(next)
    return next
  }
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error('Invalid thread id.')
  }
  const next: RenpyOptionsPrefsStore = {
    ...store,
    byThread: { ...store.byThread, [String(id)]: normalized }
  }
  await queueWrite(next)
  return next
}
