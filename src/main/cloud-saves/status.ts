import type { CloudSaveSyncStatus } from '@shared/types'
import { sendToRenderer } from '../windows'

const status: CloudSaveSyncStatus = {
  running: false,
  phase: 'idle',
  currentTitle: null,
  signInUrl: null,
  gamesDone: 0,
  gamesTotal: 0,
  uploaded: 0,
  downloaded: 0,
  lastError: null,
  lastRunAt: null,
  cancelled: false
}

export function getCloudSaveStatus(): CloudSaveSyncStatus {
  return { ...status }
}

function broadcast(): void {
  sendToRenderer('cloud-saves:status', getCloudSaveStatus())
}

export function setCloudSavePhase(phase: CloudSaveSyncStatus['phase']): void {
  status.phase = phase
  status.running = phase !== 'idle'
  if (phase === 'idle') {
    status.currentTitle = null
    status.signInUrl = null
  }
  broadcast()
}

export function setCloudSignInUrl(url: string | null): void {
  status.signInUrl = url
  if (url) {
    status.phase = 'signing-in'
    status.running = true
  }
  broadcast()
}

export function beginCloudSync(gamesTotal: number): void {
  status.running = true
  status.phase = 'syncing'
  status.currentTitle = null
  status.signInUrl = null
  status.gamesDone = 0
  status.gamesTotal = gamesTotal
  status.uploaded = 0
  status.downloaded = 0
  status.lastError = null
  status.cancelled = false
  broadcast()
}

export function noteCloudSyncGame(title: string): void {
  status.currentTitle = title
  broadcast()
}

export function finishCloudSyncGame(uploaded: number, downloaded: number): void {
  status.uploaded += uploaded
  status.downloaded += downloaded
  status.gamesDone += 1
  broadcast()
}

export function requestCloudSyncCancel(): void {
  if (status.running && status.phase === 'syncing') {
    status.cancelled = true
    broadcast()
  }
}

export function endCloudSync(error: string | null, cancelled = false): void {
  status.running = false
  status.phase = 'idle'
  status.currentTitle = null
  status.signInUrl = null
  status.lastError = cancelled ? null : error
  status.cancelled = cancelled
  status.lastRunAt = Date.now()
  broadcast()
}
