export type CloudSaveKind = 'slot' | 'auto' | 'quick' | 'always'

export type CloudSaveCandidate = {
  name: string
  localPath: string
  size: number
  modifiedAt: number
  kind: CloudSaveKind
}

const SKIP_META_NAMES = new Set([
  'game.txt',
  'game.json',
  'manifest.json',
  'f95gm-manifest.json'
])

export function isCloudMetaName(name: string): boolean {
  return SKIP_META_NAMES.has(name.toLowerCase().trim())
}

/** Classify a save filename. Returns null for files that should not be synced. */
export function classifySaveName(name: string): CloudSaveKind | null {
  const lower = name.toLowerCase().trim()
  if (!lower || SKIP_META_NAMES.has(lower)) return null
  if (lower === 'persistent' || lower.startsWith('persistent')) return 'always'
  if (lower.endsWith('.save')) {
    if (lower.startsWith('auto-')) return 'auto'
    if (lower.startsWith('quick-')) return 'quick'
    return 'slot'
  }
  if (/\.(rpgsave|rmmzsave)$/i.test(lower)) {
    if (/^auto/i.test(lower)) return 'auto'
    if (/^quick/i.test(lower)) return 'quick'
    if (/^config/i.test(lower) || /^global/i.test(lower)) return 'always'
    return 'slot'
  }
  return null
}

/**
 * Keep always-synced files, optional auto/quick (uncapped), and the newest N slot saves.
 * `keepCount` 0 means unlimited slots.
 */
export function selectCloudSaves(
  files: readonly CloudSaveCandidate[],
  keepCount: number,
  includeAutoQuick: boolean
): CloudSaveCandidate[] {
  const always: CloudSaveCandidate[] = []
  const autoQuick: CloudSaveCandidate[] = []
  const slots: CloudSaveCandidate[] = []
  for (const file of files) {
    if (file.kind === 'always') always.push(file)
    else if (file.kind === 'auto' || file.kind === 'quick') {
      if (includeAutoQuick) autoQuick.push(file)
    } else slots.push(file)
  }
  slots.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name))
  const keptSlots = keepCount > 0 ? slots.slice(0, keepCount) : slots
  return [...always, ...autoQuick, ...keptSlots]
}

/** Opaque Drive blob name derived from content hash (`f95gm-<sha256>`). */
export function cloudBlobName(hash: string): string {
  const id = hash.trim().toLowerCase()
  return id ? `f95gm-${id}` : ''
}

export function isCloudBlobName(name: string): boolean {
  return /^f95gm-[0-9a-f]{16,}$/i.test(name.trim())
}

export function cloudSaveNameAllowed(name: string): boolean {
  if (!name || name.includes('..') || name.includes('/') || name.includes('\\')) return false
  return isCloudBlobName(name) || classifySaveName(name) != null
}
