import { compareGameVersions } from './engines'

export function usableVersion(value: string | undefined | null): string {
  const version = (value || '').trim()
  if (!version || /^unknown$/i.test(version)) return ''
  return version
}

export function isNewerGameVersion(
  latest: string | undefined | null,
  baseline: string | undefined | null
): boolean {
  const next = usableVersion(latest)
  const current = usableVersion(baseline)
  if (!next || !current) return false
  return compareGameVersions(next, current) > 0
}

export function catalogTimestamp(value: number | string | undefined | null): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return 0
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n)
}

export function isRelativeDate(value: string | undefined | null): boolean {
  return /\b(ago|yesterday|today|just now)\b/i.test(value || '')
}

export function formatUpdateDate(at: number | undefined | null): string {
  const ms = catalogTimestamp(at)
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatPlaytime(ms: number): string {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000)
  if (ms <= 0) return '0m'
  if (totalMinutes < 1) return '<1m'
  if (totalMinutes < 60) return `${totalMinutes}m`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (!minutes) return `${hours}h`
  return `${hours}h ${minutes}m`
}

export function formatSessionTime(ms: number): string {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours) return `${hours}h ${minutes}m`
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, '0')}s`
  return `${seconds}s`
}

export function formatRelativeTime(at: number | undefined | null, now = Date.now()): string {
  if (!at) return ''
  const delta = Math.max(0, now - at)
  const minutes = Math.round(delta / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 14) return `${days}d ago`
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function formatDateTime(at: number | undefined | null): string {
  if (!at) return ''
  return new Date(at).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

export type GameUpdateState = {
  updateAvailable: boolean
  unplayedUpdate: boolean
}

export function gameUpdateState(input: {
  latestVersion?: string | null
  installedVersion?: string | null
  lastPlayedVersion?: string | null
}): GameUpdateState {
  return {
    updateAvailable: Boolean(input.installedVersion) &&
      isNewerGameVersion(input.latestVersion, input.installedVersion),
    unplayedUpdate: Boolean(input.lastPlayedVersion) &&
      isNewerGameVersion(input.latestVersion, input.lastPlayedVersion)
  }
}
