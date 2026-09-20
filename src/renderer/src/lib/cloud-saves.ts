import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CloudSaveAccount,
  CloudSaveGameDetail,
  CloudSaveRemoteFile,
  CloudSaveSyncStatus
} from '@shared/types'

export function useCloudSaveAccount(): CloudSaveAccount {
  const [account, setAccount] = useState<CloudSaveAccount>({ signedIn: false, email: null })

  useEffect(() => {
    let cancelled = false
    void window.api.cloudSaves.account().then((next) => {
      if (!cancelled) setAccount(next)
    })
    const stop = window.api.cloudSaves.onAccount((next) => setAccount(next))
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  return account
}

export function useCloudSaveStatus(): CloudSaveSyncStatus | null {
  const [status, setStatus] = useState<CloudSaveSyncStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.cloudSaves.status().then((next) => {
      if (!cancelled) setStatus(next)
    })
    const stop = window.api.cloudSaves.onStatus((next) => setStatus(next))
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  return status
}

const EMPTY_CLOUD_FILES: CloudSaveRemoteFile[] = []

export const RPG_CLOUD_FOLDER = 'rpgmaker'

export function isPersistentSaveName(name: string): boolean {
  return name.toLowerCase().trim().startsWith('persistent')
}

export function useCloudSavesEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.settings.get().then((next) => {
      if (!cancelled) setEnabled(Boolean(next.cloudSavesEnabled))
    })
    const stop = window.api.settings.onChange((next) => setEnabled(Boolean(next.cloudSavesEnabled)))
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  return enabled
}

export function cloudFolderKey(name: string): string {
  const trimmed = name.trim() || 'saves'
  return trimmed.replace(/[\\/]/g, '_').slice(0, 120)
}

export function filesForSaveFolder(
  files: readonly CloudSaveRemoteFile[],
  folderKey: string,
  threadId = 0
): CloudSaveRemoteFile[] {
  const key = folderKey.trim()
  if (!key) return []
  const exact = files.filter((file) => file.folderKey === key)
  if (exact.length) return exact
  const legacyKey = threadId > 0 ? String(threadId) : ''
  if (!legacyKey) return []
  const hasNested = files.some((file) => file.folderKey && file.folderKey !== legacyKey)
  if (hasNested) return []
  return files.filter((file) => !file.folderKey || file.folderKey === legacyKey)
}

export function useCloudSavesForThread(
  threadId: number,
  options?: { enabled?: boolean }
): {
  files: CloudSaveRemoteFile[]
  names: Set<string>
  syncedNames: Set<string>
  detail: CloudSaveGameDetail | null
  busy: boolean
  enabled: boolean
  signedIn: boolean
  syncing: boolean
  reload: () => Promise<void>
} {
  const settingEnabled = useCloudSavesEnabled()
  const enabled = options?.enabled !== false && settingEnabled
  const status = useCloudSaveStatus()
  const account = useCloudSaveAccount()
  const [detail, setDetail] = useState<CloudSaveGameDetail | null>(null)
  const [busy, setBusy] = useState(false)
  const wasRunning = useRef(false)

  const reload = useCallback(async () => {
    if (!threadId || !account.signedIn || !enabled) {
      setDetail(null)
      return
    }
    setBusy(true)
    try {
      setDetail(await window.api.cloudSaves.listForThread(threadId))
    } catch {
      setDetail({ threadId, title: '', files: [], syncedNames: [] })
    } finally {
      setBusy(false)
    }
  }, [threadId, account.signedIn, enabled])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (!enabled) return
    const stop = window.api.cloudSaves.onInventory(() => {
      void reload()
    })
    return stop
  }, [reload, enabled])

  useEffect(() => {
    if (!enabled) return
    if (status?.running && status.phase === 'syncing') {
      wasRunning.current = true
      return
    }
    if (wasRunning.current) {
      wasRunning.current = false
      void reload()
    }
  }, [status?.running, status?.phase, status?.lastRunAt, reload, enabled])

  const files = detail?.files ?? EMPTY_CLOUD_FILES
  const names = useMemo(() => new Set(files.map((file) => file.name)), [files])
  const syncedNames = useMemo(
    () => new Set(detail?.syncedNames?.length ? detail.syncedNames : files.filter((file) => file.presentLocally).map((file) => file.name)),
    [detail?.syncedNames, files]
  )
  return {
    files,
    names,
    syncedNames,
    detail,
    busy,
    enabled: settingEnabled,
    signedIn: account.signedIn,
    syncing: Boolean(status?.running && status.phase === 'syncing'),
    reload
  }
}
