import type { CloudUserDataSyncStatus } from '@shared/types'
import { sendToRenderer } from '../windows'

const status: CloudUserDataSyncStatus = {
  running: false,
  lastError: null,
  lastRunAt: null,
  lastRevision: null,
  pending: false
}

export function getCloudUserDataStatus(): CloudUserDataSyncStatus {
  return { ...status }
}

function broadcast(): void {
  sendToRenderer('cloud-user-data:status', getCloudUserDataStatus())
}

export function setCloudUserDataPending(pending: boolean): void {
  if (status.pending === pending) return
  status.pending = pending
  broadcast()
}

export function beginCloudUserDataSync(): void {
  status.running = true
  status.lastError = null
  broadcast()
}

export function endCloudUserDataSync(input: {
  error: string | null
  revision: number | null
  pending: boolean
}): void {
  status.running = false
  status.lastError = input.error
  status.lastRevision = input.revision ?? status.lastRevision
  status.pending = input.pending
  status.lastRunAt = Date.now()
  broadcast()
}

export function hydrateCloudUserDataStatus(input: {
  lastRevision: number
  lastSyncedAt: number
  lastError: string | null
  pending: boolean
}): void {
  status.lastRevision = input.lastRevision || null
  status.lastRunAt = input.lastSyncedAt || null
  status.lastError = input.lastError
  status.pending = input.pending
  broadcast()
}
