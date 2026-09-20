import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { CloudUserDataSyncStatus } from '@shared/types'
import { listGameNotes, replaceGameNotes } from '../game-notes-store'
import { getAppPaths } from '../paths'
import { applyP2pUploadLimit, onP2pEnabledChanged } from '../p2p'
import { listRoster, replaceRoster } from '../roster-store'
import { getSettings, saveSettings } from '../settings-store'
import { listSubscriptions, replaceSubscriptions } from '../subscriptions-store'
import { hasCloudSaveSession } from '../cloud-saves/oauth'
import { mergeUserData, needsApply, needsUpload } from './merge'
import {
  beginApplyingCloudUserData,
  endApplyingCloudUserData,
  notifyUserDataChanged,
  notifyUserDataEnabled,
  notifyUserDataSession,
  setUserDataSyncHandlers,
  type UserDataChangeReason
} from './notify'
import { downloadRemoteUserData, uploadRemoteUserData } from './remote'
import {
  SYNCED_SETTING_KEYS,
  parseEnvelope,
  pickPortableSettings,
  serializeEnvelope,
  toRosterGame,
  toSubscription,
  type UserDataPayload
} from './snapshot'
import {
  getCloudUserDataState,
  patchCloudUserDataState,
  replaceSyncMeta,
  timesFromPayload
} from './state'
import {
  beginCloudUserDataSync,
  endCloudUserDataSync,
  getCloudUserDataStatus,
  hydrateCloudUserDataStatus,
  setCloudUserDataPending
} from './status'

const DATA_DEBOUNCE_MS = 400
const PLAYTIME_INTERVAL_MS = 60_000
const RETRY_MS = 30_000

let started = false
let queue: Promise<unknown> = Promise.resolve()
let dataTimer: ReturnType<typeof setTimeout> | null = null
let playtimeTimer: ReturnType<typeof setInterval> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let playtimeDirty = false
let stopped = false

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn)
  queue = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

async function cloudUserDataReady(): Promise<boolean> {
  const settings = await getSettings()
  if (!settings.cloudUserDataEnabled) return false
  return hasCloudSaveSession()
}

async function collectLocal(): Promise<UserDataPayload> {
  const [settings, state, subscriptions, roster, notes] = await Promise.all([
    getSettings(),
    getCloudUserDataState(),
    listSubscriptions(),
    listRoster(),
    listGameNotes()
  ])
  return {
    version: 1,
    revision: state.lastRevision,
    updatedAt: Date.now(),
    settings: pickPortableSettings(settings),
    settingsTimes: { ...state.settingTimes },
    subscriptions: subscriptions.map((game) => ({
      ...game,
      userUpdatedAt: state.subscriptionUpdatedAt[String(game.threadId)] || game.addedAt
    })),
    subscriptionTombstones: state.subscriptionTombstones,
    roster: roster.map((game) => ({
      ...game,
      userUpdatedAt: state.rosterUpdatedAt[String(game.threadId)] || game.addedAt
    })),
    rosterTombstones: state.rosterTombstones,
    notes,
    noteTombstones: state.noteTombstones
  }
}

async function writeApplyJournal(payload: UserDataPayload): Promise<void> {
  const file = getAppPaths().cloudUserDataApplyFile
  await mkdir(dirname(file), { recursive: true })
  const { bytes } = serializeEnvelope(payload)
  await writeFile(file, bytes)
}

async function readApplyJournal(): Promise<UserDataPayload | null> {
  try {
    const raw = await readFile(getAppPaths().cloudUserDataApplyFile)
    return parseEnvelope(raw)?.payload ?? null
  } catch {
    return null
  }
}

async function clearApplyJournal(): Promise<void> {
  await rm(getAppPaths().cloudUserDataApplyFile, { force: true })
}

async function applyPayload(payload: UserDataPayload): Promise<void> {
  const before = await getSettings()
  beginApplyingCloudUserData()
  try {
    await writeApplyJournal(payload)
    await replaceSubscriptions(payload.subscriptions.map(toSubscription))
    await replaceRoster(payload.roster.map(toRosterGame))
    await replaceGameNotes(payload.notes)
    const settings = await saveSettings(payload.settings)
    if (before.p2pEnabled !== settings.p2pEnabled) {
      void onP2pEnabledChanged(settings.p2pEnabled).catch((error) =>
        console.warn('[p2p] onP2pEnabledChanged failed', error)
      )
    } else if (before.p2pUploadLimitKBps !== settings.p2pUploadLimitKBps) {
      applyP2pUploadLimit()
    }
    const times = timesFromPayload(payload)
    await replaceSyncMeta({
      lastRevision: payload.revision,
      lastChecksum: '',
      settingTimes: times.settingTimes,
      subscriptionUpdatedAt: times.subscriptionUpdatedAt,
      rosterUpdatedAt: times.rosterUpdatedAt,
      subscriptionTombstones: payload.subscriptionTombstones,
      rosterTombstones: payload.rosterTombstones,
      noteTombstones: payload.noteTombstones,
      dirty: true
    })
    await clearApplyJournal()
  } finally {
    endApplyingCloudUserData()
  }
}

function scheduleRetry(): void {
  if (retryTimer || stopped) return
  retryTimer = setTimeout(() => {
    retryTimer = null
    void syncCloudUserData().catch((error) => {
      console.warn('Cloud user-data retry failed', error)
    })
  }, RETRY_MS)
  retryTimer.unref?.()
}

async function runSync(): Promise<CloudUserDataSyncStatus> {
  if (stopped) return getCloudUserDataStatus()
  if (!(await cloudUserDataReady())) return getCloudUserDataStatus()
  beginCloudUserDataSync()
  playtimeDirty = false
  let error: string | null = null
  let revision: number | null = null
  let pending = false
  try {
    const journal = await readApplyJournal()
    if (journal) {
      await applyPayload(journal)
    }
    const local = await collectLocal()
    let remotePayload: UserDataPayload | null = null
    try {
      const remote = await downloadRemoteUserData()
      remotePayload = remote?.payload ?? null
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      pending = true
      await patchCloudUserDataState({ dirty: true, lastError: error })
      scheduleRetry()
      return getCloudUserDataStatus()
    }
    const merged = remotePayload ? mergeUserData(local, remotePayload) : local
    if (needsApply(local, merged)) {
      await applyPayload(merged)
    }
    if (needsUpload(remotePayload, merged)) {
      const updatedAt = Date.now()
      const settingsTimes = { ...merged.settingsTimes }
      for (const key of SYNCED_SETTING_KEYS) {
        if (!settingsTimes[key]) settingsTimes[key] = updatedAt
      }
      const upload: UserDataPayload = {
        ...merged,
        revision: Math.max(local.revision, remotePayload?.revision ?? 0) + 1,
        updatedAt,
        settingsTimes
      }
      await writeApplyJournal(upload)
      try {
        const result = await uploadRemoteUserData(upload)
        revision = result.revision
        const times = timesFromPayload(upload)
        await replaceSyncMeta({
          lastRevision: result.revision,
          lastChecksum: result.checksum,
          settingTimes: times.settingTimes,
          subscriptionUpdatedAt: times.subscriptionUpdatedAt,
          rosterUpdatedAt: times.rosterUpdatedAt,
          subscriptionTombstones: upload.subscriptionTombstones,
          rosterTombstones: upload.rosterTombstones,
          noteTombstones: upload.noteTombstones,
          dirty: false,
          lastError: null
        })
        await clearApplyJournal()
        pending = false
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        pending = true
        await patchCloudUserDataState({ dirty: true, lastError: error })
        scheduleRetry()
      }
    } else {
      revision = merged.revision
      const times = timesFromPayload(merged)
      await replaceSyncMeta({
        lastRevision: merged.revision,
        lastChecksum: remotePayload ? serializeEnvelope(remotePayload).checksum : '',
        settingTimes: times.settingTimes,
        subscriptionUpdatedAt: times.subscriptionUpdatedAt,
        rosterUpdatedAt: times.rosterUpdatedAt,
        subscriptionTombstones: merged.subscriptionTombstones,
        rosterTombstones: merged.rosterTombstones,
        noteTombstones: merged.noteTombstones,
        dirty: false,
        lastError: null
      })
      await clearApplyJournal()
      pending = false
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
    pending = true
    await patchCloudUserDataState({ dirty: true, lastError: error }).catch(() => undefined)
    scheduleRetry()
  } finally {
    const state = await getCloudUserDataState().catch(() => null)
    endCloudUserDataSync({
      error,
      revision: revision ?? state?.lastRevision ?? null,
      pending: pending || Boolean(state?.dirty)
    })
  }
  return getCloudUserDataStatus()
}

export async function syncCloudUserData(): Promise<CloudUserDataSyncStatus> {
  if (!(await cloudUserDataReady())) {
    throw new Error('Turn on user data sync and sign in to Google Drive first.')
  }
  return enqueue(() => runSync())
}

function scheduleDataSync(): void {
  if (dataTimer) return
  dataTimer = setTimeout(() => {
    dataTimer = null
    void syncCloudUserData().catch((error) => {
      console.warn('Could not sync user data', error)
    })
  }, DATA_DEBOUNCE_MS)
  dataTimer.unref?.()
}

function ensurePlaytimeTimer(): void {
  if (playtimeTimer || stopped) return
  playtimeTimer = setInterval(() => {
    if (!playtimeDirty) return
    void syncCloudUserData().catch((error) => {
      console.warn('Could not sync playtime', error)
    })
  }, PLAYTIME_INTERVAL_MS)
  playtimeTimer.unref?.()
}

function clearTimers(): void {
  if (dataTimer) {
    clearTimeout(dataTimer)
    dataTimer = null
  }
  if (playtimeTimer) {
    clearInterval(playtimeTimer)
    playtimeTimer = null
  }
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function handleChange(reason: UserDataChangeReason): void {
  if (stopped) return
  void cloudUserDataReady().then((ready) => {
    if (!ready) return
    if (reason === 'playtime') {
      playtimeDirty = true
      setCloudUserDataPending(true)
      ensurePlaytimeTimer()
      return
    }
    setCloudUserDataPending(true)
    scheduleDataSync()
  })
}

async function handleEnabled(enabled: boolean): Promise<void> {
  if (!enabled) {
    stopped = true
    clearTimers()
    playtimeDirty = false
    setCloudUserDataPending(false)
    return
  }
  stopped = false
  ensurePlaytimeTimer()
  void syncCloudUserData().catch((error) => {
    console.warn('Could not sync user data', error)
  })
}

async function handleSession(): Promise<void> {
  if (stopped) return
  if (await cloudUserDataReady()) {
    ensurePlaytimeTimer()
    void syncCloudUserData().catch((error) => {
      console.warn('Could not sync user data', error)
    })
  } else {
    clearTimers()
    playtimeTimer = null
  }
}

export async function startCloudUserDataSync(): Promise<void> {
  if (!started) {
    started = true
    setUserDataSyncHandlers({
      onChange: handleChange,
      onEnabled: (enabled) => {
        void handleEnabled(enabled)
      },
      onSession: () => {
        void handleSession()
      }
    })
  }
  const state = await getCloudUserDataState()
  hydrateCloudUserDataStatus({
    lastRevision: state.lastRevision,
    lastSyncedAt: state.lastSyncedAt,
    lastError: state.lastError,
    pending: state.dirty
  })
  stopped = false
  if (await cloudUserDataReady()) {
    ensurePlaytimeTimer()
    void syncCloudUserData().catch((error) => {
      console.warn('Could not sync user data', error)
    })
  }
}

export async function flushCloudUserDataSync(): Promise<void> {
  if (!(await cloudUserDataReady())) return
  if (dataTimer) {
    clearTimeout(dataTimer)
    dataTimer = null
  }
  await syncCloudUserData()
}

export { getCloudUserDataStatus, notifyUserDataChanged, notifyUserDataEnabled, notifyUserDataSession }
