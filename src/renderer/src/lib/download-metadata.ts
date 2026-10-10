import { downloadLinkKey } from '@shared/download-links'
import type { PackageMetadata, ThreadDownloadMetadata } from '@shared/p2p'
import {
  CONTENT_KIND_BY_ID,
  OS_KIND_BY_ID,
  OS_KIND_IDS,
  type ContentKind,
  type ContentKindId,
  type DownloadEntry,
  type DownloadMirror,
  type DownloadSection,
  type DownloadSectionKind,
  type KnownDownloadFile,
  type OsKind,
  type OsKindId
} from '@shared/types'
import { isNewerGameVersion, usableVersion } from '@shared/updates'
import { trustSignal } from './p2p-trust'

export const PEER_SHARED_TITLE = 'Shared by app users'

/** Peer mirrors offered per link list; more distinct files behind one link is rare. */
const MAX_P2P_MIRRORS = 3

export type DownloadMetadataOptions = {
  /** Swarm downloads are possible; otherwise metadata only categorizes the posted links. */
  p2pEnabled: boolean
  /** Thread's current version, to tell current peer-shared builds from older ones. */
  currentVersion: string
}

type LinkedFile = { pkg: PackageMetadata; reports: number }

function consensusOs(pkg: PackageMetadata): OsKind[] {
  return (pkg.consensus?.os ?? [])
    .map((id) => OS_KIND_BY_ID[id as OsKindId])
    .filter((os): os is OsKind => Boolean(os))
}

function consensusKind(pkg: PackageMetadata): ContentKind | null {
  const id = pkg.consensus?.contentKind
  return id == null ? null : (CONTENT_KIND_BY_ID[id as ContentKindId] ?? null)
}

function consensusVersion(pkg: PackageMetadata): string | null {
  return pkg.consensus?.version?.trim() || null
}

function filenameOf(pkg: PackageMetadata): string {
  return pkg.normalizedName || pkg.gameName || pkg.contentHash.slice(0, 12)
}

function sortSystems(systems: Iterable<OsKind>): OsKind[] {
  return [...new Set(systems)].sort((a, b) => OS_KIND_IDS[a] - OS_KIND_IDS[b])
}

function knownFile({ pkg, reports }: LinkedFile): KnownDownloadFile {
  return {
    contentHash: pkg.contentHash.toLowerCase(),
    filename: filenameOf(pkg),
    sizeBytes: pkg.sizeBytes && pkg.sizeBytes > 0 ? pkg.sizeBytes : undefined,
    os: consensusOs(pkg),
    contentKind: consensusKind(pkg),
    version: consensusVersion(pkg) || pkg.gameVersion?.trim() || null,
    installCount: Math.max(0, pkg.installCount ?? 0),
    reports,
    flagCounts: {
      broken: Math.max(0, pkg.flagCounts?.broken ?? 0),
      harmful: Math.max(0, pkg.flagCounts?.harmful ?? 0)
    }
  }
}

function p2pMirror(pkg: PackageMetadata, label: string): DownloadMirror {
  const seeders = pkg.activeSeeders ?? pkg.seeders
  return {
    label,
    url: `p2p:${pkg.contentHash.toLowerCase()}`,
    p2p: {
      contentHash: pkg.contentHash.toLowerCase(),
      filename: filenameOf(pkg),
      sizeBytes: pkg.sizeBytes && pkg.sizeBytes > 0 ? pkg.sizeBytes : undefined,
      seeders: seeders == null ? null : Math.max(0, Number(seeders) || 0),
      installCount: Math.max(0, pkg.installCount ?? 0),
      flagCounts: {
        broken: Math.max(0, pkg.flagCounts?.broken ?? 0),
        harmful: Math.max(0, pkg.flagCounts?.harmful ?? 0)
      }
    }
  }
}

function isMainContent(kind: ContentKind): boolean {
  return kind === 'game' || kind === 'update'
}

/**
 * Votes from people who got the files: a unanimous kind or version wins over the
 * post parser's guess, and voted platforms are added (never removed, so a build is
 * not hidden from a platform the post lists but nobody tagged).
 */
function categorize(entry: DownloadEntry, files: LinkedFile[]): DownloadEntry {
  const tagged = files.filter((file) => file.pkg.consensus)
  if (!tagged.length) return entry
  const kinds = new Set(tagged.map((file) => consensusKind(file.pkg)))
  const [kind] = kinds
  const contentType =
    kinds.size === 1 && kind && (kind !== 'other' || entry.contentType === 'other')
      ? kind
      : entry.contentType
  const versions = tagged.map((file) => consensusVersion(file.pkg))
  const version =
    versions.every(Boolean) && new Set(versions).size === 1 ? versions[0] : entry.version
  const systems = sortSystems([...entry.systems, ...tagged.flatMap((file) => consensusOs(file.pkg))])
  return { ...entry, contentType, version, systems }
}

class LinkIndex {
  private readonly packages = new Map<string, PackageMetadata>()
  private readonly filesByLink = new Map<string, Map<string, number>>()
  readonly linkedHashes = new Set<string>()

  constructor(meta: ThreadDownloadMetadata) {
    for (const pkg of meta.packages) this.packages.set(pkg.contentHash.toLowerCase(), pkg)
    for (const link of meta.links) {
      const key = downloadLinkKey(link.url)
      if (!key) continue
      const files = this.filesByLink.get(key) ?? new Map<string, number>()
      for (const file of link.files) {
        const hash = file.contentHash.toLowerCase()
        files.set(hash, Math.max(files.get(hash) ?? 0, file.reports))
      }
      this.filesByLink.set(key, files)
    }
  }

  get allPackages(): PackageMetadata[] {
    return [...this.packages.values()]
  }

  /** Files behind any of these mirrors (they carry the same content), most-reported first. */
  filesFor(mirrors: readonly DownloadMirror[]): LinkedFile[] {
    const reports = new Map<string, number>()
    for (const mirror of mirrors) {
      const key = downloadLinkKey(mirror.url)
      const files = key ? this.filesByLink.get(key) : undefined
      for (const [hash, count] of files ?? []) {
        reports.set(hash, Math.max(reports.get(hash) ?? 0, count))
      }
    }
    const found: LinkedFile[] = []
    for (const [hash, count] of reports) {
      const pkg = this.packages.get(hash)
      if (!pkg) continue
      this.linkedHashes.add(hash)
      found.push({ pkg, reports: count })
    }
    return found.sort(
      (a, b) => b.reports - a.reports || (b.pkg.installCount ?? 0) - (a.pkg.installCount ?? 0)
    )
  }
}

function withPeerMirrors(
  mirrors: DownloadMirror[],
  files: LinkedFile[],
  p2pEnabled: boolean
): DownloadMirror[] {
  if (!p2pEnabled) return mirrors
  const shareable = files.filter((file) => file.pkg.infoHash).slice(0, MAX_P2P_MIRRORS)
  const peers = shareable.map((file) =>
    p2pMirror(file.pkg, shareable.length > 1 ? `Peer-to-peer · ${filenameOf(file.pkg)}` : 'Peer-to-peer')
  )
  return peers.length ? [...mirrors, ...peers] : mirrors
}

function enrichEntry(entry: DownloadEntry, index: LinkIndex, p2pEnabled: boolean): DownloadEntry {
  if (entry.parts.length) {
    const linked: LinkedFile[] = []
    const parts = entry.parts.map((part) => {
      const files = index.filesFor(part.mirrors)
      linked.push(...files)
      return { ...part, mirrors: withPeerMirrors(part.mirrors, files, p2pEnabled) }
    })
    const known = linked.map(knownFile)
    return categorize({ ...entry, parts, ...(known.length ? { known } : {}) }, linked)
  }
  const files = index.filesFor(entry.mirrors)
  if (!files.length) return entry
  return categorize(
    {
      ...entry,
      mirrors: withPeerMirrors(entry.mirrors, files, p2pEnabled),
      known: files.map(knownFile)
    },
    files
  )
}

function enrichSections(
  sections: DownloadSection[],
  index: LinkIndex,
  p2pEnabled: boolean
): DownloadSection[] {
  return sections.map((section) => ({
    ...section,
    entries: section.entries.map((entry) => enrichEntry(entry, index, p2pEnabled)),
    sections: enrichSections(section.sections, index, p2pEnabled)
  }))
}

function peerSectionKind(entry: DownloadEntry, currentVersion: string): DownloadSectionKind {
  if (!isMainContent(entry.contentType)) return 'extras'
  if (!usableVersion(currentVersion)) return 'current'
  if (!entry.version || !usableVersion(entry.version)) return 'archive'
  return isNewerGameVersion(currentVersion, entry.version) ? 'archive' : 'current'
}

function peerSharedEntry(pkg: PackageMetadata): DownloadEntry {
  const file = knownFile({ pkg, reports: 0 })
  return {
    contentType: file.contentKind ?? 'other',
    systems: file.os,
    variants: [],
    version: file.version,
    title: file.filename,
    unofficial: false,
    mirrors: [p2pMirror(pkg, 'Peer-to-peer')],
    parts: [],
    known: [file],
    peerShared: true
  }
}

/**
 * Applies link metadata to the parsed post: categorizes entries from the files behind
 * their links, adds peer-to-peer mirrors, and lists swarm-only files of this thread.
 */
export function applyDownloadMetadata(
  sections: DownloadSection[],
  meta: ThreadDownloadMetadata | null,
  options: DownloadMetadataOptions
): DownloadSection[] {
  if (!meta || (!meta.links.length && !meta.packages.length)) return sections
  const index = new LinkIndex(meta)
  const enriched = enrichSections(sections, index, options.p2pEnabled)
  if (!options.p2pEnabled) return enriched

  const byKind = new Map<DownloadSectionKind, DownloadEntry[]>()
  for (const pkg of index.allPackages) {
    if (index.linkedHashes.has(pkg.contentHash.toLowerCase()) || !pkg.infoHash) continue
    // A file with more flags than installs and no posted link vouching for it is not offered.
    if (trustSignal(pkg).level === 'bad') continue
    const entry = peerSharedEntry(pkg)
    const kind = peerSectionKind(entry, options.currentVersion)
    const entries = byKind.get(kind)
    if (entries) entries.push(entry)
    else byKind.set(kind, [entry])
  }
  const order: DownloadSectionKind[] = ['current', 'archive', 'extras']
  const peerSections = order.flatMap((kind) => {
    const entries = byKind.get(kind)
    return entries?.length
      ? [{ title: PEER_SHARED_TITLE, kind, sections: [], entries } satisfies DownloadSection]
      : []
  })
  return [...enriched, ...peerSections]
}
