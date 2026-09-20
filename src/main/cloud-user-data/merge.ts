import { mergeVersionPlayStats } from '@shared/updates'
import {
  contentFingerprint,
  emptySyncedSettings,
  mergeCatalogFields,
  type SettingsTimes,
  type SyncedNote,
  type SyncedRosterGame,
  type SyncedSettingKey,
  type SyncedSettings,
  type SyncedSubscription,
  type UserDataPayload,
  type UserDataTombstone,
  SYNCED_SETTING_KEYS
} from './snapshot'

function tombstoneMap(items: UserDataTombstone[]): Map<number, number> {
  const map = new Map<number, number>()
  for (const item of items) {
    map.set(item.threadId, Math.max(map.get(item.threadId) || 0, item.deletedAt))
  }
  return map
}

export function mergeTombstones(
  left: UserDataTombstone[],
  right: UserDataTombstone[]
): UserDataTombstone[] {
  const map = tombstoneMap([...left, ...right])
  return [...map.entries()]
    .map(([threadId, deletedAt]) => ({ threadId, deletedAt }))
    .sort((a, b) => a.threadId - b.threadId)
}

function isDeleted(deletedAt: number, updatedAt: number): boolean {
  return deletedAt > 0 && deletedAt >= updatedAt
}

function pruneTombstones(
  tombs: UserDataTombstone[],
  present: Array<{ threadId: number; userUpdatedAt: number; addedAt?: number }>
): UserDataTombstone[] {
  const live = new Map(present.map((item) => [item.threadId, item.userUpdatedAt || item.addedAt || 0]))
  return tombs.filter((item) => {
    const updatedAt = live.get(item.threadId)
    if (updatedAt == null) return true
    return isDeleted(item.deletedAt, updatedAt)
  })
}

function mergeSettings(
  local: SyncedSettings,
  localTimes: SettingsTimes,
  remote: SyncedSettings,
  remoteTimes: SettingsTimes
): { settings: SyncedSettings; times: SettingsTimes } {
  const settings = emptySyncedSettings()
  const times: SettingsTimes = {}
  for (const key of SYNCED_SETTING_KEYS) {
    const leftAt = localTimes[key] || 0
    const rightAt = remoteTimes[key] || 0
    const useRemote = rightAt > leftAt
    const source = useRemote ? remote : local
    const at = useRemote ? rightAt : leftAt
    ;(settings as Record<SyncedSettingKey, SyncedSettings[SyncedSettingKey]>)[key] = source[key]
    if (at) times[key] = at
  }
  return { settings, times }
}

function mergeSubscriptionPair(local: SyncedSubscription, remote: SyncedSubscription): SyncedSubscription {
  const catalog = mergeCatalogFields(local, remote)
  const newerUser = remote.userUpdatedAt >= local.userUpdatedAt ? remote : local
  const olderUser = newerUser === remote ? local : remote
  const lastPlayedAt = Math.max(local.lastPlayedAt || 0, remote.lastPlayedAt || 0)
  const lastPlayedVersion =
    (local.lastPlayedAt || 0) >= (remote.lastPlayedAt || 0)
      ? local.lastPlayedVersion || remote.lastPlayedVersion
      : remote.lastPlayedVersion || local.lastPlayedVersion
  return {
    ...newerUser,
    ...catalog,
    engine: catalog.engine || newerUser.engine || olderUser.engine || '',
    addedAt: Math.min(local.addedAt || newerUser.addedAt, remote.addedAt || newerUser.addedAt),
    rarity: newerUser.rarity,
    archived: newerUser.archived,
    source: newerUser.source,
    userUpdatedAt: Math.max(local.userUpdatedAt, remote.userUpdatedAt),
    playtimeMs: Math.max(local.playtimeMs || 0, remote.playtimeMs || 0),
    lastPlayedAt,
    lastPlayedVersion,
    playedVersions: mergeVersionPlayStats(olderUser.playedVersions, newerUser.playedVersions),
    checkedAt: Math.max(local.checkedAt || 0, remote.checkedAt || 0)
  }
}

function mergeRosterPair(local: SyncedRosterGame, remote: SyncedRosterGame): SyncedRosterGame {
  const catalog = mergeCatalogFields(local, remote)
  const newerUser = remote.userUpdatedAt >= local.userUpdatedAt ? remote : local
  return {
    ...newerUser,
    ...catalog,
    engine: catalog.engine || newerUser.engine || '',
    addedAt: Math.min(local.addedAt || newerUser.addedAt, remote.addedAt || newerUser.addedAt),
    userUpdatedAt: Math.max(local.userUpdatedAt, remote.userUpdatedAt)
  }
}

function mergeKeyed<T extends { threadId: number; userUpdatedAt: number; addedAt?: number }>(
  local: T[],
  remote: T[],
  localTombs: UserDataTombstone[],
  remoteTombs: UserDataTombstone[],
  mergePair: (left: T, right: T) => T
): { items: T[]; tombstones: UserDataTombstone[] } {
  const tombs = tombstoneMap(mergeTombstones(localTombs, remoteTombs))
  const left = new Map(local.map((item) => [item.threadId, item]))
  const right = new Map(remote.map((item) => [item.threadId, item]))
  const ids = new Set([...left.keys(), ...right.keys(), ...tombs.keys()])
  const items: T[] = []
  for (const id of ids) {
    const a = left.get(id)
    const b = right.get(id)
    const deletedAt = tombs.get(id) || 0
    if (!a && !b) continue
    const merged = a && b ? mergePair(a, b) : (a || b)!
    const updatedAt = merged.userUpdatedAt || merged.addedAt || 0
    if (isDeleted(deletedAt, updatedAt)) continue
    items.push(merged)
  }
  items.sort((a, b) => a.threadId - b.threadId)
  return { items, tombstones: pruneTombstones(mergeTombstones(localTombs, remoteTombs), items) }
}

function mergeNotes(
  local: SyncedNote[],
  remote: SyncedNote[],
  localTombs: UserDataTombstone[],
  remoteTombs: UserDataTombstone[]
): { notes: SyncedNote[]; tombstones: UserDataTombstone[] } {
  const tombs = tombstoneMap(mergeTombstones(localTombs, remoteTombs))
  const left = new Map(local.map((item) => [item.threadId, item]))
  const right = new Map(remote.map((item) => [item.threadId, item]))
  const ids = new Set([...left.keys(), ...right.keys(), ...tombs.keys()])
  const notes: SyncedNote[] = []
  for (const id of ids) {
    const a = left.get(id)
    const b = right.get(id)
    const deletedAt = tombs.get(id) || 0
    if (!a && !b) continue
    const winner = a && b ? (b.updatedAt >= a.updatedAt ? b : a) : (a || b)!
    if (isDeleted(deletedAt, winner.updatedAt)) continue
    notes.push(winner)
  }
  notes.sort((a, b) => a.threadId - b.threadId)
  return {
    notes,
    tombstones: pruneTombstones(
      mergeTombstones(localTombs, remoteTombs),
      notes.map((note) => ({ threadId: note.threadId, userUpdatedAt: note.updatedAt }))
    )
  }
}

export function mergeUserData(local: UserDataPayload, remote: UserDataPayload): UserDataPayload {
  const settings = mergeSettings(local.settings, local.settingsTimes, remote.settings, remote.settingsTimes)
  const subscriptions = mergeKeyed(
    local.subscriptions,
    remote.subscriptions,
    local.subscriptionTombstones,
    remote.subscriptionTombstones,
    mergeSubscriptionPair
  )
  const roster = mergeKeyed(
    local.roster,
    remote.roster,
    local.rosterTombstones,
    remote.rosterTombstones,
    mergeRosterPair
  )
  const notes = mergeNotes(local.notes, remote.notes, local.noteTombstones, remote.noteTombstones)
  return {
    version: 1,
    revision: Math.max(local.revision, remote.revision),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    settings: settings.settings,
    settingsTimes: settings.times,
    subscriptions: subscriptions.items,
    subscriptionTombstones: subscriptions.tombstones,
    roster: roster.items,
    rosterTombstones: roster.tombstones,
    notes: notes.notes,
    noteTombstones: notes.tombstones
  }
}

export function needsApply(local: UserDataPayload, merged: UserDataPayload): boolean {
  return contentFingerprint(local) !== contentFingerprint(merged)
}

export function needsUpload(remote: UserDataPayload | null, merged: UserDataPayload): boolean {
  if (!remote) return true
  return contentFingerprint(remote) !== contentFingerprint(merged)
}
