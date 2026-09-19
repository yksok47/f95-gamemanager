import { compareGameVersions } from './engines'

export const APP_UPDATE_GITHUB_OWNER = 'yksok47'
export const APP_UPDATE_GITHUB_REPO = 'f95-gamemanager'
export const APP_UPDATE_GITHUB_URL = `https://github.com/${APP_UPDATE_GITHUB_OWNER}/${APP_UPDATE_GITHUB_REPO}`
export const APP_EXECUTABLE_NAME = 'F95GameManager'

export type AppInstallKind = 'dev' | 'nsis' | 'appimage' | 'mac' | 'portable'

export type AppUpdatePhase =
  | 'idle'
  | 'checking'
  | 'upToDate'
  | 'available'
  | 'downloading'
  | 'preparing'
  | 'restarting'
  | 'error'

export type AppUpdateStatus = {
  currentVersion: string
  latestVersion: string | null
  available: boolean
  packaged: boolean
  installKind: AppInstallKind
  installLabel: string
  phase: AppUpdatePhase
  percent: number
  bytesReceived: number
  bytesTotal: number
  assetName: string | null
  releaseUrl: string | null
  error: string | null
  canInstall: boolean
}

export type GithubReleaseAsset = {
  name: string
  browser_download_url: string
  size: number
}

export type GithubRelease = {
  tag_name: string
  html_url: string
  draft?: boolean
  prerelease?: boolean
  assets: GithubReleaseAsset[]
}

export type AppUpdateAssetQuery = {
  platform: 'win32' | 'linux' | 'darwin'
  arch: string
  kind: AppInstallKind
}

export function normalizeAppVersion(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/^v/i, '')
}

export function isRemoteAppVersionNewer(current: string, remote: string): boolean {
  const left = normalizeAppVersion(current)
  const right = normalizeAppVersion(remote)
  if (!left || !right) return false
  return compareGameVersions(right, left) > 0
}

export function appInstallLabel(kind: AppInstallKind): string {
  if (kind === 'nsis') return 'Installed'
  if (kind === 'appimage') return 'AppImage'
  if (kind === 'mac') return 'App bundle'
  if (kind === 'portable') return 'Portable'
  return 'Development'
}

export function detectAppInstallKind(input: {
  packaged: boolean
  platform: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  hasUninstaller?: boolean
}): AppInstallKind {
  if (!input.packaged) return 'dev'
  const env = input.env ?? {}
  if (input.platform === 'linux' && env.APPIMAGE) return 'appimage'
  if (env.PORTABLE_EXECUTABLE_FILE) return 'portable'
  if (input.platform === 'win32') return input.hasUninstaller ? 'nsis' : 'portable'
  if (input.platform === 'darwin') return 'mac'
  return 'portable'
}

export function appUpdateChannel(kind: AppInstallKind, platform: NodeJS.Platform): AppInstallKind {
  if (kind === 'dev') {
    if (platform === 'win32') return 'portable'
    if (platform === 'linux') return 'appimage'
    return 'mac'
  }
  return kind
}

function normalizeArch(arch: string): 'arm64' | 'x64' | string {
  const value = arch.toLowerCase()
  if (value === 'arm64' || value === 'aarch64') return 'arm64'
  if (value === 'x64' || value === 'x86_64' || value === 'amd64' || value === 'intel') return 'x64'
  return value
}

function assetArch(name: string): 'arm64' | 'x64' | null {
  const lower = name.toLowerCase()
  if (/(?:^|[^a-z])(arm64|aarch64)(?:[^a-z]|$)/.test(lower)) return 'arm64'
  if (/(?:^|[^a-z])(x64|x86_64|amd64)(?:[^a-z]|$)/.test(lower)) return 'x64'
  return null
}

function scoreAsset(name: string, query: AppUpdateAssetQuery): number {
  const lower = name.toLowerCase()
  if (!lower || lower === 'sha512sums' || lower === 'sha256sums') return -1
  if (/\.(yml|yaml|blockmap|txt|json)$/i.test(lower)) return -1
  if (query.kind === 'dev') return -1

  const wantArch = normalizeArch(query.arch)
  const foundArch = assetArch(lower)
  if (foundArch && foundArch !== wantArch) return -1

  if (query.platform === 'win32') {
    if (query.kind === 'nsis') {
      if (!lower.endsWith('.exe')) return -1
      if (!lower.includes('setup')) return -1
      if (lower.includes('unpacked') || lower.includes('portable')) return -1
      return 100
    }
    if (!lower.endsWith('.zip')) return -1
    if (!lower.includes('win')) return -1
    if (!lower.includes('unpacked') && !lower.includes('portable')) return -1
    return 90
  }

  if (query.platform === 'linux') {
    if (query.kind === 'appimage') {
      if (!lower.endsWith('.appimage')) return -1
      return foundArch === wantArch ? 100 : 80
    }
    if (!lower.endsWith('.zip')) return -1
    if (!lower.includes('linux')) return -1
    if (!lower.includes('unpacked') && !lower.includes('portable')) return -1
    return 90
  }

  if (query.platform === 'darwin') {
    if (!lower.includes('mac') && !lower.includes('darwin') && !lower.includes('osx')) return -1
    if (lower.endsWith('.zip')) return foundArch === wantArch ? 100 : 70
    if (lower.endsWith('.dmg')) return foundArch === wantArch ? 40 : 10
    return -1
  }

  return -1
}

export function selectReleaseAsset<T extends { name: string }>(
  assets: T[],
  query: AppUpdateAssetQuery
): T | null {
  let best: T | null = null
  let bestScore = -1
  for (const asset of assets) {
    const score = scoreAsset(asset.name, query)
    if (score > bestScore) {
      best = asset
      bestScore = score
    }
  }
  return bestScore >= 0 ? best : null
}

export function checksumAssetName(name: string): boolean {
  return /^(sha512sums|sha256sums)$/i.test(name.trim())
}

export function parseChecksumFile(text: string): Map<string, { algorithm: 'sha512' | 'sha256'; hash: string }> {
  const map = new Map<string, { algorithm: 'sha512' | 'sha256'; hash: string }>()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const gnu = line.match(/^([a-f0-9]{64}|[a-f0-9]{128})\s+\*?(.+)$/i)
    if (gnu) {
      const hash = gnu[1].toLowerCase()
      const file = gnu[2].replace(/^\.\//, '').trim()
      map.set(file, { algorithm: hash.length === 128 ? 'sha512' : 'sha256', hash })
      continue
    }
    const bsd = line.match(/^SHA(512|256)\s+\((.+)\)\s+=\s+([a-f0-9]+)$/i)
    if (bsd) {
      map.set(bsd[2].trim(), {
        algorithm: bsd[1] === '512' ? 'sha512' : 'sha256',
        hash: bsd[3].toLowerCase()
      })
    }
  }
  return map
}

export function locateUpdatePayloadFromEntries(
  files: string[],
  options: { platform: NodeJS.Platform; executableName?: string }
): { type: 'app' | 'dir'; root: string } | null {
  const exe = options.executableName || APP_EXECUTABLE_NAME
  const exeWin = `${exe}.exe`
  const candidates: Array<{ type: 'app' | 'dir'; root: string; depth: number }> = []

  for (const raw of files) {
    const rel = raw.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!rel || rel.endsWith('/')) continue
    const parts = rel.split('/').filter(Boolean)
    const base = parts[parts.length - 1]
    if (base !== exe && base !== exeWin) continue

    const appIdx = parts.findIndex((part) => part.toLowerCase().endsWith('.app'))
    if (
      appIdx >= 0 &&
      parts[appIdx + 1] === 'Contents' &&
      parts[appIdx + 2] === 'MacOS'
    ) {
      const root = parts.slice(0, appIdx + 1).join('/')
      candidates.push({ type: 'app', root, depth: appIdx })
      continue
    }

    const root = parts.slice(0, -1).join('/')
    candidates.push({ type: 'dir', root, depth: Math.max(0, parts.length - 1) })
  }

  if (!candidates.length) return null
  candidates.sort((a, b) => {
    if (options.platform === 'darwin' && a.type !== b.type) return a.type === 'app' ? -1 : 1
    return a.depth - b.depth
  })
  return { type: candidates[0].type, root: candidates[0].root }
}

export function parseUpdateResultFile(text: string): { ok: boolean; version: string; error: string } {
  let ok = false
  let version = ''
  let error = ''
  for (const rawLine of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim()
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().toLowerCase()
    const value = line.slice(eq + 1)
    if (key === 'ok') ok = value === '1' || value.toLowerCase() === 'true'
    else if (key === 'version') version = value.trim()
    else if (key === 'error') error = value.trim()
  }
  return { ok, version, error }
}

export function emptyAppUpdateStatus(
  currentVersion: string,
  installKind: AppInstallKind,
  packaged: boolean
): AppUpdateStatus {
  return {
    currentVersion,
    latestVersion: null,
    available: false,
    packaged,
    installKind,
    installLabel: appInstallLabel(installKind),
    phase: 'idle',
    percent: 0,
    bytesReceived: 0,
    bytesTotal: 0,
    assetName: null,
    releaseUrl: null,
    error: null,
    canInstall: false
  }
}
