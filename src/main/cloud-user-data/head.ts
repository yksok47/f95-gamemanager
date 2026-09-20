export const USER_DATA_HEAD_NAME = 'head.json'
export const USER_DATA_KEEP_SNAPSHOTS = 3

export type UserDataHeadRef = {
  revision: number
  checksum: string
  fileName: string
  updatedAt: number
}

export type UserDataHead = UserDataHeadRef & {
  version: 1
  previous: UserDataHeadRef[]
}

const SNAPSHOT_NAME = /^snapshot-(\d+)-(\d+)(?:-[a-z0-9]+)?\.json$/i

export function snapshotFileName(revision: number, updatedAt: number, nonce: string): string {
  const safeNonce = nonce.replace(/[^a-z0-9]/gi, '').slice(0, 12) || 'x'
  return `snapshot-${revision}-${updatedAt}-${safeNonce}.json`
}

export function parseSnapshotFileName(
  name: string
): { revision: number; updatedAt: number } | null {
  const match = SNAPSHOT_NAME.exec(name)
  if (!match) return null
  return { revision: Number(match[1]), updatedAt: Number(match[2]) }
}

function asRef(value: unknown): UserDataHeadRef | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<UserDataHeadRef>
  const revision = Number(raw.revision)
  const checksum = typeof raw.checksum === 'string' ? raw.checksum.trim() : ''
  const fileName = typeof raw.fileName === 'string' ? raw.fileName.trim() : ''
  const updatedAt = Number(raw.updatedAt) || 0
  if (!Number.isFinite(revision) || revision < 0 || !checksum || !fileName) return null
  if (!parseSnapshotFileName(fileName) && !fileName.endsWith('.json')) return null
  return { revision: Math.floor(revision), checksum, fileName, updatedAt }
}

export function parseHead(value: unknown): UserDataHead | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<UserDataHead> & { version?: unknown }
  if (raw.version !== 1) return null
  const current = asRef(raw)
  if (!current) return null
  const previous: UserDataHeadRef[] = []
  for (const item of Array.isArray(raw.previous) ? raw.previous : []) {
    const ref = asRef(item)
    if (ref) previous.push(ref)
  }
  return { version: 1, ...current, previous }
}

export function nextHead(current: UserDataHead | null, snapshot: UserDataHeadRef): UserDataHead {
  const previous: UserDataHeadRef[] = []
  if (current) {
    previous.push({
      revision: current.revision,
      checksum: current.checksum,
      fileName: current.fileName,
      updatedAt: current.updatedAt
    })
    for (const item of current.previous) {
      if (previous.length >= USER_DATA_KEEP_SNAPSHOTS - 1) break
      if (item.fileName === snapshot.fileName || item.fileName === current.fileName) continue
      previous.push(item)
    }
  }
  return {
    version: 1,
    revision: snapshot.revision,
    checksum: snapshot.checksum,
    fileName: snapshot.fileName,
    updatedAt: snapshot.updatedAt,
    previous
  }
}

export function snapshotsToKeep(head: UserDataHead): Set<string> {
  const keep = new Set<string>([head.fileName, USER_DATA_HEAD_NAME])
  for (const item of head.previous) keep.add(item.fileName)
  return keep
}

export function staleSnapshotNames(existingNames: string[], keep: Set<string>): string[] {
  return existingNames.filter((name) => {
    if (keep.has(name) || name === USER_DATA_HEAD_NAME) return false
    return Boolean(parseSnapshotFileName(name))
  })
}

/** Prefer HEAD, then previous revisions, then leftover snapshot files newest-first. */
export function recoveryFileOrder(head: UserDataHead | null, fileNames: string[]): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()
  function add(name: string | undefined): void {
    if (!name || seen.has(name)) return
    seen.add(name)
    ordered.push(name)
  }
  if (head) {
    add(head.fileName)
    for (const item of head.previous) add(item.fileName)
  }
  const leftovers = fileNames
    .map((name) => {
      const parsed = parseSnapshotFileName(name)
      return parsed ? { name, ...parsed } : null
    })
    .filter((item): item is { name: string; revision: number; updatedAt: number } => Boolean(item))
    .sort((a, b) => b.revision - a.revision || b.updatedAt - a.updatedAt)
  for (const item of leftovers) add(item.name)
  return ordered
}
