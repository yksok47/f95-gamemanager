import type { ThreadLastRead } from '@shared/types'

export type ThreadReadRecord = {
  postId: number
  page?: number
  updatedAt: number
}

export type ThreadReadStore = {
  version: 1
  lastRead: Record<string, ThreadReadRecord>
}

export function emptyThreadReadStore(): ThreadReadStore {
  return { version: 1, lastRead: {} }
}

export function saneThreadReadPage(value: unknown): number | undefined {
  const page = Math.floor(Number(value))
  return Number.isFinite(page) && page >= 1 ? page : undefined
}

export function threadLastReadFromRecord(record: ThreadReadRecord): ThreadLastRead {
  return { postId: record.postId, page: record.page ?? null }
}

export function parseThreadReadStore(value: unknown): ThreadReadStore {
  if (!value || typeof value !== 'object') return emptyThreadReadStore()
  const raw = value as Partial<ThreadReadStore> & { lastRead?: Record<string, unknown> }
  if (!raw.lastRead || typeof raw.lastRead !== 'object') return emptyThreadReadStore()
  const lastRead: Record<string, ThreadReadRecord> = {}
  for (const [key, item] of Object.entries(raw.lastRead)) {
    if (!/^\d+$/.test(key) || !item || typeof item !== 'object') continue
    const postId = Number((item as Partial<ThreadReadRecord>).postId)
    if (!Number.isFinite(postId) || postId <= 0) continue
    const page = saneThreadReadPage((item as Partial<ThreadReadRecord>).page)
    lastRead[key] = {
      postId,
      ...(page ? { page } : {}),
      updatedAt: Number((item as Partial<ThreadReadRecord>).updatedAt) || Date.now()
    }
  }
  return { version: 1, lastRead }
}
