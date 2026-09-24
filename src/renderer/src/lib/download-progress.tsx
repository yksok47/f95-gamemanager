import { useEffect, useRef, useSyncExternalStore, type JSX, type ReactNode } from 'react'
import type { ThreadDownloadProgress } from './downloads'

let current = new Map<number, ThreadDownloadProgress>()
const threadListeners = new Map<number, Set<() => void>>()
const listListeners = new Set<() => void>()
let listSnapshot = current
let listKey = ''

/** Library rows care which downloads exist, not the latest percent. */
function listKeyOf(map: Map<number, ThreadDownloadProgress>): string {
  const parts: string[] = []
  for (const item of map.values()) {
    parts.push(
      [
        item.threadId,
        item.title,
        item.version,
        item.creator,
        item.coverUrl ?? '',
        item.engine,
        item.startedAt
      ].join('\u0001')
    )
  }
  parts.sort()
  return parts.join('\u0002')
}

function subscribeThread(threadId: number, listener: () => void): () => void {
  let set = threadListeners.get(threadId)
  if (!set) {
    set = new Set()
    threadListeners.set(threadId, set)
  }
  set.add(listener)
  return () => {
    set.delete(listener)
    if (set.size === 0) threadListeners.delete(threadId)
  }
}

function subscribeList(listener: () => void): () => void {
  listListeners.add(listener)
  return () => {
    listListeners.delete(listener)
  }
}

function notify(prev: Map<number, ThreadDownloadProgress>, next: Map<number, ThreadDownloadProgress>): void {
  const ids = new Set<number>([...prev.keys(), ...next.keys()])
  for (const id of ids) {
    const before = prev.get(id)
    const after = next.get(id)
    if (before === after) continue
    if (
      before &&
      after &&
      before.percent === after.percent &&
      before.title === after.title &&
      before.version === after.version &&
      before.coverUrl === after.coverUrl &&
      before.engine === after.engine
    ) {
      continue
    }
    const set = threadListeners.get(id)
    if (!set) continue
    for (const listener of set) listener()
  }
}

export function DownloadProgressProvider({
  value,
  children
}: {
  value: Map<number, ThreadDownloadProgress>
  children: ReactNode
}): JSX.Element {
  const previous = useRef(current)
  const listChanged = useRef(false)
  if (value !== current) {
    previous.current = current
    current = value
    const key = listKeyOf(value)
    listChanged.current = key !== listKey
    if (listChanged.current) {
      listKey = key
      listSnapshot = value
    }
  }

  useEffect(() => {
    notify(previous.current, current)
    previous.current = current
    if (!listChanged.current) return
    listChanged.current = false
    for (const listener of listListeners) listener()
  }, [value])

  return <>{children}</>
}

/** Stable while only download percents change, so library tiles are not rebuilt every tick. */
export function usePendingDownloads(): Map<number, ThreadDownloadProgress> {
  return useSyncExternalStore(subscribeList, () => listSnapshot, () => listSnapshot)
}

export function useGameDownloadProgress(threadId: number): ThreadDownloadProgress | undefined {
  return useSyncExternalStore(
    (listener) => subscribeThread(threadId, listener),
    () => current.get(threadId),
    () => undefined
  )
}
