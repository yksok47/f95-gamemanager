import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getAppPaths } from '../paths'
import type { SettingsTimes, SyncedSettingKey, UserDataTombstone } from './snapshot'

const TOMBSTONE_KEEP_MS = 180 * 24 * 60 * 60 * 1000

export type CloudUserDataState = {
  lastRevision: number
  lastChecksum: string
  lastSyncedAt: number
  dirty: boolean
  lastError: string | null
  settingTimes: SettingsTimes
  subscriptionUpdatedAt: Record<string, number>
  rosterUpdatedAt: Record<string, number>
  subscriptionTombstones: UserDataTombstone[]
  rosterTombstones: UserDataTombstone[]
  noteTombstones: UserDataTombstone[]
}

let loaded: CloudUserDataState | null = null
let writeChain: Promise<void> = Promise.resolve()

function emptyState(): CloudUserDataState {
  return {
    lastRevision: 0,
    lastChecksum: '',
    lastSyncedAt: 0,
    dirty: false,
    lastError: null,
    settingTimes: {},
    subscriptionUpdatedAt: {},
    rosterUpdatedAt: {},
    subscriptionTombstones: [],
    rosterTombstones: [],
    noteTombstones: []
  }
}

function asTimeMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!/^\d+$/.test(key)) continue
    const at = Number(raw)
    if (Number.isFinite(at) && at > 0) out[key] = Math.round(at)
  }
  return out
}

function asTombstones(value: unknown): UserDataTombstone[] {
  if (!Array.isArray(value)) return []
  const byId = new Map<number, number>()
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const raw = item as Partial<UserDataTombstone>
    const threadId = Number(raw.threadId)
    const deletedAt = Number(raw.deletedAt)
    if (!Number.isFinite(threadId) || threadId <= 0 || !Number.isFinite(deletedAt) || deletedAt <= 0) {
      continue
    }
    byId.set(threadId, Math.max(byId.get(threadId) || 0, Math.round(deletedAt)))
  }
  return [...byId.entries()].map(([threadId, deletedAt]) => ({ threadId, deletedAt }))
}

function asSettingTimes(value: unknown): SettingsTimes {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const times: SettingsTimes = {}
  for (const [key, val] of Object.entries(raw)) {
    const at = Number(val)
    if (!Number.isFinite(at) || at <= 0) continue
    times[key as SyncedSettingKey] = Math.round(at)
  }
  return times
}

function pruneTombstones(items: UserDataTombstone[], now: number): UserDataTombstone[] {
  return items.filter((item) => now - item.deletedAt < TOMBSTONE_KEEP_MS)
}

function normalizeState(value: unknown): CloudUserDataState {
  const raw = value && typeof value === 'object' ? (value as Partial<CloudUserDataState>) : {}
  const now = Date.now()
  return {
    lastRevision: Math.max(0, Math.floor(Number(raw.lastRevision) || 0)),
    lastChecksum: typeof raw.lastChecksum === 'string' ? raw.lastChecksum : '',
    lastSyncedAt: Number(raw.lastSyncedAt) || 0,
    dirty: Boolean(raw.dirty),
    lastError: typeof raw.lastError === 'string' && raw.lastError ? raw.lastError : null,
    settingTimes: asSettingTimes(raw.settingTimes),
    subscriptionUpdatedAt: asTimeMap(raw.subscriptionUpdatedAt),
    rosterUpdatedAt: asTimeMap(raw.rosterUpdatedAt),
    subscriptionTombstones: pruneTombstones(asTombstones(raw.subscriptionTombstones), now),
    rosterTombstones: pruneTombstones(asTombstones(raw.rosterTombstones), now),
    noteTombstones: pruneTombstones(asTombstones(raw.noteTombstones), now)
  }
}

async function persist(state: CloudUserDataState): Promise<void> {
  const file = getAppPaths().cloudUserDataStateFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(state, null, 2), 'utf8')
}

async function writeState(state: CloudUserDataState): Promise<CloudUserDataState> {
  loaded = state
  writeChain = writeChain
    .then(() => persist(state))
    .catch((error) => {
      console.warn('[cloud-user-data] persist state failed', error)
    })
  await writeChain
  return state
}

export async function getCloudUserDataState(): Promise<CloudUserDataState> {
  if (loaded) return loaded
  try {
    const raw = await readFile(getAppPaths().cloudUserDataStateFile, 'utf8')
    loaded = normalizeState(JSON.parse(raw))
  } catch {
    loaded = emptyState()
  }
  return loaded
}

export async function patchCloudUserDataState(
  patch: Partial<CloudUserDataState>
): Promise<CloudUserDataState> {
  const current = await getCloudUserDataState()
  return writeState({ ...current, ...patch })
}

function upsertTombstone(items: UserDataTombstone[], threadId: number, at: number): UserDataTombstone[] {
  const next = items.filter((item) => item.threadId !== threadId)
  next.push({ threadId, deletedAt: at })
  return next
}

function dropTombstone(items: UserDataTombstone[], threadId: number): UserDataTombstone[] {
  return items.filter((item) => item.threadId !== threadId)
}

export async function touchSubscription(threadId: number, at = Date.now()): Promise<void> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) return
  const state = await getCloudUserDataState()
  await writeState({
    ...state,
    dirty: true,
    subscriptionUpdatedAt: { ...state.subscriptionUpdatedAt, [String(id)]: at },
    subscriptionTombstones: dropTombstone(state.subscriptionTombstones, id)
  })
}

export async function tombstoneSubscription(threadId: number, at = Date.now()): Promise<void> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) return
  const state = await getCloudUserDataState()
  const updated = { ...state.subscriptionUpdatedAt }
  delete updated[String(id)]
  await writeState({
    ...state,
    dirty: true,
    subscriptionUpdatedAt: updated,
    subscriptionTombstones: upsertTombstone(state.subscriptionTombstones, id, at)
  })
}

export async function touchRoster(threadId: number, at = Date.now()): Promise<void> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) return
  const state = await getCloudUserDataState()
  await writeState({
    ...state,
    dirty: true,
    rosterUpdatedAt: { ...state.rosterUpdatedAt, [String(id)]: at },
    rosterTombstones: dropTombstone(state.rosterTombstones, id)
  })
}

export async function tombstoneRoster(threadId: number, at = Date.now()): Promise<void> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) return
  const state = await getCloudUserDataState()
  const updated = { ...state.rosterUpdatedAt }
  delete updated[String(id)]
  await writeState({
    ...state,
    dirty: true,
    rosterUpdatedAt: updated,
    rosterTombstones: upsertTombstone(state.rosterTombstones, id, at)
  })
}

export async function tombstoneNote(threadId: number, at = Date.now()): Promise<void> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) return
  const state = await getCloudUserDataState()
  await writeState({
    ...state,
    dirty: true,
    noteTombstones: upsertTombstone(state.noteTombstones, id, at)
  })
}

export async function clearNoteTombstone(threadId: number): Promise<void> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) return
  const state = await getCloudUserDataState()
  await writeState({
    ...state,
    dirty: true,
    noteTombstones: dropTombstone(state.noteTombstones, id)
  })
}

export async function bumpSettingTimes(keys: SyncedSettingKey[], at = Date.now()): Promise<void> {
  if (!keys.length) return
  const state = await getCloudUserDataState()
  const settingTimes = { ...state.settingTimes }
  for (const key of keys) settingTimes[key] = at
  await writeState({ ...state, dirty: true, settingTimes })
}

export async function replaceSyncMeta(input: {
  lastRevision: number
  lastChecksum: string
  settingTimes: SettingsTimes
  subscriptionUpdatedAt: Record<string, number>
  rosterUpdatedAt: Record<string, number>
  subscriptionTombstones: UserDataTombstone[]
  rosterTombstones: UserDataTombstone[]
  noteTombstones: UserDataTombstone[]
  dirty: boolean
  lastError?: string | null
}): Promise<void> {
  const current = await getCloudUserDataState()
  await writeState({
    ...current,
    lastRevision: input.lastRevision,
    lastChecksum: input.lastChecksum,
    lastSyncedAt: input.dirty ? current.lastSyncedAt : Date.now(),
    dirty: input.dirty,
    lastError: input.lastError === undefined ? current.lastError : input.lastError,
    settingTimes: input.settingTimes,
    subscriptionUpdatedAt: input.subscriptionUpdatedAt,
    rosterUpdatedAt: input.rosterUpdatedAt,
    subscriptionTombstones: input.subscriptionTombstones,
    rosterTombstones: input.rosterTombstones,
    noteTombstones: input.noteTombstones
  })
}

export function timesFromPayload(payload: {
  settingsTimes: SettingsTimes
  subscriptions: Array<{ threadId: number; userUpdatedAt: number }>
  roster: Array<{ threadId: number; userUpdatedAt: number }>
}): {
  settingTimes: SettingsTimes
  subscriptionUpdatedAt: Record<string, number>
  rosterUpdatedAt: Record<string, number>
} {
  const subscriptionUpdatedAt: Record<string, number> = {}
  for (const item of payload.subscriptions) {
    if (item.userUpdatedAt) subscriptionUpdatedAt[String(item.threadId)] = item.userUpdatedAt
  }
  const rosterUpdatedAt: Record<string, number> = {}
  for (const item of payload.roster) {
    if (item.userUpdatedAt) rosterUpdatedAt[String(item.threadId)] = item.userUpdatedAt
  }
  return {
    settingTimes: { ...payload.settingsTimes },
    subscriptionUpdatedAt,
    rosterUpdatedAt
  }
}
