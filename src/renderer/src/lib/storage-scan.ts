import { useCallback, useEffect, useState } from 'react'
import type { GameLibraryFile, LibraryStorageScan, LibraryStorageStats } from '@shared/types'
import { notifyCaught } from '../components/ErrorNotifications'

export const EMPTY_STORAGE_STATS: LibraryStorageStats = {
  archiveBytes: 0,
  installBytes: 0,
  saveBytes: 0,
  totalBytes: 0,
  games: [],
  items: []
}

const EMPTY_SCAN: LibraryStorageScan = {
  scanning: false,
  scannedAt: null,
  error: null,
  stats: null
}

type ScanListener = (scan: LibraryStorageScan) => void

const listeners = new Set<ScanListener>()
let snapshot: LibraryStorageScan = EMPTY_SCAN
let bridged = false
let opened = false
let libraryIdentity = ''
let libraryTimer: number | null = null

function emit(next: LibraryStorageScan): void {
  snapshot = next
  for (const listener of listeners) listener(next)
}

function libraryKey(items: GameLibraryFile[]): string {
  return items
    .map((file) => `${file.id}:${file.isInstalled}:${file.hasArchive}:${file.installPath || ''}`)
    .sort()
    .join('|')
}

let receivedPush = false

function startBridge(): void {
  if (bridged) return
  bridged = true
  window.api.library.onStorageScan((next) => {
    receivedPush = true
    emit(next)
  })
  void window.api.library.storageScan().then((next) => {
    if (!receivedPush) emit(next)
  })
  window.api.library.onChange((items) => {
    const nextIdentity = libraryKey(items)
    if (nextIdentity === libraryIdentity) return
    libraryIdentity = nextIdentity
    if (!opened) return
    if (libraryTimer) window.clearTimeout(libraryTimer)
    libraryTimer = window.setTimeout(() => {
      void window.api.library.storageStats(true).catch((err) => {
        notifyCaught(err, 'Could not measure disk usage.')
      })
    }, 400)
  })
}

async function runScan(force: boolean): Promise<void> {
  opened = true
  startBridge()
  try {
    await window.api.library.storageStats(force)
  } catch (err) {
    notifyCaught(err, 'Could not measure disk usage.')
  }
}

export function useStorageScan(): {
  stats: LibraryStorageStats
  scanning: boolean
  scannedAt: number | null
  hasScan: boolean
  ensure: () => Promise<void>
  refresh: () => Promise<void>
} {
  const [scan, setScan] = useState<LibraryStorageScan>(snapshot)

  useEffect(() => {
    startBridge()
    listeners.add(setScan)
    setScan(snapshot)
    return () => {
      listeners.delete(setScan)
    }
  }, [])

  const ensure = useCallback(() => runScan(false), [])
  const refresh = useCallback(() => runScan(true), [])

  return {
    stats: scan.stats || EMPTY_STORAGE_STATS,
    scanning: scan.scanning,
    scannedAt: scan.scannedAt,
    hasScan: scan.scannedAt != null,
    ensure,
    refresh
  }
}
