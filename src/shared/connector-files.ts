import {
  OS_KIND_BY_ID,
  OS_KIND_LABELS,
  type OsKind,
  type OsKindId
} from './types'

/** A file a locker listing exposed — URL is set when the host already has a direct link. */
export type ConnectorListedFile = {
  name: string
  size?: number
  url?: string
}

export type ConnectorFileChoice = {
  name: string
  size?: number
  os: OsKind[]
}

export type ChooseDownloadFileRequest = {
  id: string
  files: ConnectorFileChoice[]
}

export type ConnectorFileDecision<T> =
  | { kind: 'file'; file: T }
  | { kind: 'choose'; files: T[] }

const PLATFORM_ARCHIVE = /\.(zip|7z|rar|exe|apk|dmg)(?:$|\.)/i

const OS_PATTERNS: Array<[RegExp, OsKind]> = [
  [/(^|[^a-z0-9])(win64|win32|windows|win)([^a-z0-9]|$)/i, 'win'],
  [/(^|[^a-z0-9])(pc)([^a-z0-9]|$)/i, 'win'],
  [/(^|[^a-z0-9])(linux)([^a-z0-9]|$)/i, 'linux'],
  [/(^|[^a-z0-9])(macos|osx|darwin)([^a-z0-9]|$)/i, 'mac'],
  [/(^|[^a-z0-9])(mac)([^a-z0-9]|$)/i, 'mac'],
  [/(^|[^a-z0-9])(android|apk)([^a-z0-9]|$)/i, 'android'],
  [/(^|[^a-z0-9])(ios|iphone|ipad)([^a-z0-9]|$)/i, 'ios'],
  [/(^|[^a-z0-9])(joiplay)([^a-z0-9]|$)/i, 'joiplay'],
  [/(^|[^a-z0-9])(html5|html)([^a-z0-9]|$)/i, 'html'],
  [/(^|[^a-z0-9])(web)([^a-z0-9]|$)/i, 'web']
]

export function isPlatformArchiveName(name: string): boolean {
  return PLATFORM_ARCHIVE.test(name)
}

export function osKindsFromFilename(name: string): OsKind[] {
  const found: OsKind[] = []
  const seen = new Set<OsKind>()
  for (const [pattern, os] of OS_PATTERNS) {
    if (!pattern.test(name) || seen.has(os)) continue
    seen.add(os)
    found.push(os)
  }
  if (/\.apk$/i.test(name) && !seen.has('android')) found.push('android')
  if (/\.dmg$/i.test(name) && !seen.has('mac')) found.push('mac')
  if (/\.exe$/i.test(name) && !seen.has('win')) found.push('win')
  return found
}

export function requestedOsKind(osIds: readonly number[] | undefined): OsKind | null {
  if (!osIds || osIds.length !== 1) return null
  const id = osIds[0] as OsKindId
  return OS_KIND_BY_ID[id] ?? null
}

export function hostOsKind(platform: NodeJS.Platform): OsKind | null {
  if (platform === 'win32') return 'win'
  if (platform === 'darwin') return 'mac'
  if (platform === 'linux') return 'linux'
  return null
}

export function osLabelList(os: readonly OsKind[]): string {
  return os.map((item) => OS_KIND_LABELS[item]).join(', ')
}

function namedFiles<T extends { name?: string | null }>(files: readonly T[]): T[] {
  return files.filter((file) => Boolean(file.name?.trim()))
}

/** Archives/installers when any exist; otherwise every named file. */
export function platformCandidateFiles<T extends { name?: string | null }>(files: readonly T[]): T[] {
  const named = namedFiles(files)
  const platform = named.filter((file) => isPlatformArchiveName(file.name || ''))
  return platform.length ? platform : named
}

function osOf<T extends { name?: string | null }>(file: T): OsKind[] {
  return osKindsFromFilename(file.name || '')
}

function matchesWanted(os: readonly OsKind[], wanted: OsKind): boolean {
  return os.includes(wanted)
}

/**
 * Auto-pick only when the listing is clearly an OS split and exactly one file
 * matches the wanted OS. Anything ambiguous is left for the user.
 */
export function decideConnectorFile<T extends { name?: string | null }>(
  files: readonly T[],
  wantedOs: OsKind | null
): ConnectorFileDecision<T> {
  const candidates = platformCandidateFiles(files)
  if (!candidates.length) return { kind: 'choose', files: [] }
  if (candidates.length === 1) return { kind: 'file', file: candidates[0] as T }

  const tagged = candidates.map((file) => ({ file, os: osOf(file) }))
  const identifiedOs = new Set(tagged.flatMap((item) => item.os))
  const osDifferentiated = identifiedOs.size >= 1

  if (wantedOs && osDifferentiated) {
    const matching = tagged.filter((item) => matchesWanted(item.os, wantedOs))
    const otherTagged = tagged.filter(
      (item) => item.os.length > 0 && !matchesWanted(item.os, wantedOs)
    )
    if (matching.length === 1 && otherTagged.length > 0) {
      return { kind: 'file', file: matching[0]!.file }
    }

    const untagged = tagged.filter((item) => item.os.length === 0)
    const wantedIsTagged = identifiedOs.has(wantedOs)
    if (!wantedIsTagged && untagged.length === 1 && otherTagged.length > 0) {
      return { kind: 'file', file: untagged[0]!.file }
    }
  }

  return { kind: 'choose', files: candidates }
}

export function toConnectorFileChoice<T extends { name?: string | null; size?: number }>(
  file: T
): ConnectorFileChoice {
  return {
    name: file.name?.trim() || 'download',
    size: file.size,
    os: osKindsFromFilename(file.name || '')
  }
}
