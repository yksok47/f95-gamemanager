/**
 * Per-thread last-read discussion post, so reopening Posts lands on the same place.
 * The page is a backup when the linked post has been removed.
 */
import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { ThreadLastRead } from '@shared/types'
import { getAppPaths } from './paths'
import {
  emptyThreadReadStore,
  parseThreadReadStore,
  saneThreadReadPage,
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

function queueWrite(store: ThreadReadStore): Promise<void> {
  cache = store
  writeChain = writeChain
    .then(() => persist(store))
    .catch((error) => {
      console.warn('[thread-read] persist failed', error)
    })
  return writeChain
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
  const store = await loadStore()
  const key = String(id)
  const previous = store.lastRead[key]
  const nextPage = saneThreadReadPage(page) ?? previous?.page
  if (previous?.postId === nextPostId && previous?.page === nextPage) {
    return threadLastReadFromRecord(previous)
  }
  const record: ThreadReadRecord = {
    postId: nextPostId,
    ...(nextPage ? { page: nextPage } : {}),
    updatedAt: Date.now()
  }
  await queueWrite({
    version: 1,
    lastRead: {
      ...store.lastRead,
      [key]: record
    }
  })
  return threadLastReadFromRecord(record)
}
