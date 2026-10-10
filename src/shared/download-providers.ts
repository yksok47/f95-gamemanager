import { isDirectFileHref } from './direct-file'
import type { DownloadMirror } from './types'

export type DownloadProvider = {
  id: string
  label: string
  /** Hostnames without `www.`; subdomains match too. */
  hosts: readonly string[]
  /** Extra link-text spellings, as lowercase alphanumerics. */
  aliases?: readonly string[]
}

/** Registry order is the default priority for new installs. */
export const DOWNLOAD_PROVIDERS = [
  { id: 'mediafire', label: 'MediaFire', hosts: ['mediafire.com'] },
  { id: 'pixeldrain', label: 'Pixeldrain', hosts: ['pixeldrain.com', 'pixeldrain.net'] },
  { id: 'gofile', label: 'GoFile', hosts: ['gofile.io'] },
  {
    id: 'buzzheavier',
    label: 'Buzzheavier',
    hosts: ['buzzheavier.com', 'bzzhr.co', 'bzzhr.to']
  },
  { id: 'datanodes', label: 'DataNodes', hosts: ['datanodes.to'] },
  { id: 'workupload', label: 'Workupload', hosts: ['workupload.com'] },
  { id: 'uploadhaven', label: 'UploadHaven', hosts: ['uploadhaven.com'] },
  { id: 'vikingfile', label: 'VikingFile', hosts: ['vikingfile.com'] },
  { id: 'akirabox', label: 'AkiraBox', hosts: ['akirabox.com'] },
  { id: 'krakenfiles', label: 'KrakenFiles', hosts: ['krakenfiles.com'] },
  { id: 'uploadnow', label: 'UploadNow', hosts: ['uploadnow.io'] },
  { id: 'mega', label: 'MEGA', hosts: ['mega.nz', 'mega.io', 'mega.co.nz'] },
  {
    id: 'mixdrop',
    label: 'Mixdrop',
    hosts: ['mixdrop.ag', 'mixdrop.co', 'mixdrop.sx', 'mixdrop.top']
  },
  {
    id: 'gdrive',
    label: 'Google Drive',
    hosts: ['drive.google.com', 'docs.google.com'],
    aliases: ['gdrive', 'googledrive', 'drive']
  },
  { id: 'onefichier', label: '1fichier', hosts: ['1fichier.com'], aliases: ['1fichier'] },
  { id: 'racaty', label: 'Racaty', hosts: ['racaty.io', 'racaty.net'] },
  { id: 'bowfile', label: 'Bowfile', hosts: ['bowfile.com'] },
  { id: 'nopy', label: 'Nopy', hosts: ['nopy.to'] }
] as const satisfies readonly DownloadProvider[]

type KnownProvider = (typeof DOWNLOAD_PROVIDERS)[number]

export type DownloadProviderId = KnownProvider['id']

/** Providers with a main-process connector that fetches the file without a browser window. */
export const CONNECTED_PROVIDER_IDS = ['mediafire'] as const satisfies readonly DownloadProviderId[]

export type ConnectedProviderId = (typeof CONNECTED_PROVIDER_IDS)[number]

export const DEFAULT_DOWNLOAD_PROVIDER_ORDER: DownloadProviderId[] = DOWNLOAD_PROVIDERS.map(
  (provider) => provider.id
)

const PROVIDER_BY_ID = new Map<string, KnownProvider>(
  DOWNLOAD_PROVIDERS.map((provider) => [provider.id, provider])
)

export function isDownloadProviderId(value: unknown): value is DownloadProviderId {
  return typeof value === 'string' && PROVIDER_BY_ID.has(value)
}

export function isConnectedProvider(id: DownloadProviderId | null): id is ConnectedProviderId {
  return id != null && (CONNECTED_PROVIDER_IDS as readonly string[]).includes(id)
}

export function downloadProviderLabel(id: DownloadProviderId): string {
  return PROVIDER_BY_ID.get(id)?.label ?? id
}

/** Keeps the user's order, drops unknown ids, and appends providers added since it was saved. */
export function normalizeDownloadProviderOrder(value: unknown): DownloadProviderId[] {
  const seen = new Set<DownloadProviderId>()
  const order: DownloadProviderId[] = []
  for (const item of Array.isArray(value) ? value : []) {
    if (!isDownloadProviderId(item) || seen.has(item)) continue
    seen.add(item)
    order.push(item)
  }
  for (const id of DEFAULT_DOWNLOAD_PROVIDER_ORDER) {
    if (!seen.has(id)) order.push(id)
  }
  return order
}

function hostnameOf(value: string): string {
  return value.toLowerCase().replace(/\.$/, '').replace(/^(www|m)\./, '')
}

function isF95Host(host: string): boolean {
  return /(^|\.)f95zone\.(to|com|ninja)$/.test(host)
}

function maskedHost(url: URL): string | null {
  if (!isF95Host(hostnameOf(url.hostname))) return null
  const match = url.pathname.match(/^\/masked\/([^/]+)/i)
  if (!match?.[1]) return null
  try {
    return hostnameOf(decodeURIComponent(match[1]))
  } catch {
    return hostnameOf(match[1])
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** F95 `/masked/<host>/…` links need a browser round-trip before they reach the host. */
export function isMaskedDownloadLink(url: string): boolean {
  const parsed = parseUrl(url)
  return Boolean(parsed && maskedHost(parsed))
}

function providerForHost(host: string): KnownProvider | null {
  for (const provider of DOWNLOAD_PROVIDERS) {
    const hosts: readonly string[] = provider.hosts
    if (hosts.some((item) => host === item || host.endsWith(`.${item}`))) return provider
  }
  return null
}

function labelKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function providerForLabel(label: string): KnownProvider | null {
  const key = labelKey(label)
  if (!key) return null
  for (const provider of DOWNLOAD_PROVIDERS) {
    const aliases: readonly string[] = 'aliases' in provider ? provider.aliases : []
    if (provider.id === key || labelKey(provider.label) === key || aliases.includes(key)) {
      return provider
    }
  }
  return null
}

export type MirrorTarget =
  | { kind: 'provider'; provider: DownloadProviderId }
  /** A plain archive URL (incl. F95 attachments) that downloads without a host page. */
  | { kind: 'file' }
  | { kind: 'forum' }
  | { kind: 'web'; host: string }

export function mirrorTarget(mirror: DownloadMirror): MirrorTarget {
  const parsed = parseUrl(mirror.url)
  if (!parsed) return { kind: 'web', host: '' }
  const host = maskedHost(parsed) ?? hostnameOf(parsed.hostname)
  const byHost = providerForHost(host)
  if (byHost) return { kind: 'provider', provider: byHost.id }
  if (/^attachments\.f95zone\./.test(host) || isDirectFileHref(parsed.href, mirror.label)) {
    return { kind: 'file' }
  }
  if (isF95Host(host)) return { kind: 'forum' }
  // F95 hides some hosts behind placeholders (`/masked/cancerads/…`); the link text still names them.
  if (!host.includes('.')) {
    const byLabel = providerForLabel(mirror.label)
    if (byLabel) return { kind: 'provider', provider: byLabel.id }
  }
  return { kind: 'web', host }
}

export function mirrorProvider(mirror: DownloadMirror): DownloadProviderId | null {
  const target = mirrorTarget(mirror)
  return target.kind === 'provider' ? target.provider : null
}

/** True when clicking the mirror starts a download without a browser window. */
export function mirrorIsOneClick(mirror: DownloadMirror): boolean {
  const target = mirrorTarget(mirror)
  if (target.kind === 'file') return true
  return (
    target.kind === 'provider' &&
    isConnectedProvider(target.provider) &&
    !isMaskedDownloadLink(mirror.url)
  )
}

function mirrorRank(mirror: DownloadMirror, order: readonly DownloadProviderId[]): number {
  const target = mirrorTarget(mirror)
  if (target.kind === 'file') return -1
  if (target.kind === 'provider') {
    const index = order.indexOf(target.provider)
    return index >= 0 ? index : order.length
  }
  return order.length + 1
}

/** Mirrors best-first: direct files, then the user's provider order, then everything else as posted. */
export function rankMirrors<T extends DownloadMirror>(
  mirrors: readonly T[],
  order: readonly DownloadProviderId[]
): T[] {
  return mirrors
    .map((mirror, index) => ({ mirror, index, rank: mirrorRank(mirror, order) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((item) => item.mirror)
}
