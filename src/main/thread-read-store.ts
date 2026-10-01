/**
 * Per-thread last-read discussion post, so reopening Posts lands on the same place.
 * This is a high-water mark: visiting an earlier page does not move it back.
 * The page is a backup when the linked post has been removed.
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { ThreadLastRead } from '@shared/types'
import { getAppPaths } from './paths'
import {
  applyThreadReadUpdate,
  emptyThreadReadStore,
  parseThreadReadStore,
  threadLastReadFromRecord,
  type ThreadReadRecord,
  type ThreadReadStore
} from './thread-read-parse'

export type { ThreadReadRecord, ThreadReadStore }

let cache: ThreadReadStore | null = null
let writeChain: Promise<void> = Promise.resolve()

async function loadStore(): Promise<ThreadReadStore> {
  if (cache) return cache
  try {
    const raw = await readFile(getAppPaths().threadReadFile, 'utf8')
    cache = parseThreadReadStore(JSON.parse(raw))
  } catch {
    cache = emptyThreadReadStore()
  }
  return cache
}

async function persist(store: ThreadReadStore): Promise<void> {
  const file = getAppPaths().threadReadFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8')
}

export async function getLastReadPost(threadId: number): Promise<ThreadLastRead | null> {
  const id = Number(threadId)
  if (!Number.isFinite(id) || id <= 0) return null
  const store = await loadStore()
  const record = store.lastRead[String(id)]
  return record ? threadLastReadFromRecord(record) : null
}

export async function setLastReadPost(
  threadId: number,
  postId: number,
  page?: number
): Promise<ThreadLastRead | null> {
  const id = Number(threadId)
  const nextPostId = Number(postId)
  if (!Number.isFinite(id) || id <= 0) return null
  if (!Number.isFinite(nextPostId) || nextPostId <= 0) return null

  const result = writeChain.then(async () => {
    const store = await loadStore()
    const key = String(id)
    const applied = applyThreadReadUpdate(store.lastRead[key], nextPostId, page)
    if (!applied) return null
    if (!applied.changed) return threadLastReadFromRecord(applied.record)
    const nextStore: ThreadReadStore = {
      version: 1,
      lastRead: {
        ...store.lastRead,
        [key]: applied.record
      }
    }
    cache = nextStore
    try {
      await persist(nextStore)
    } catch (error) {
      console.warn('[thread-read] persist failed', error)
    }
    return threadLastReadFromRecord(applied.record)
  })
  writeChain = result.then(() => undefined).catch((error) => {
    console.warn('[thread-read] persist failed', error)
  })
  return result.catch(() => null)
}
