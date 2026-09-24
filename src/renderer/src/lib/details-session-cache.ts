import type { ThreadDetails } from '@shared/types'

/** Main details-modal tabs. Image bytes are not part of this cache. */
export type DetailsModalTab =
  | 'overview'
  | 'about'
  | 'changelog'
  | 'userNotes'
  | 'gallery'
  | 'downloads'
  | 'files'
  | 'saves'
  | 'renpy'
  | 'reviews'

export type DetailsSession = {
  /** Parsed thread text (HTML, fields, review text, gallery URLs). Not image bytes. */
  details: ThreadDetails | null
  tab: DetailsModalTab
}

const sessions = new Map<number, DetailsSession>()
const openThreadIds = new Set<number>()

/** Taskbar membership. Entries for games no longer on the taskbar are dropped. */
export function syncOpenDetailThreads(threadIds: readonly number[]): void {
  openThreadIds.clear()
  for (const threadId of threadIds) openThreadIds.add(threadId)
  for (const threadId of sessions.keys()) {
    if (!openThreadIds.has(threadId)) sessions.delete(threadId)
  }
}

export function readDetailsSession(threadId: number): DetailsSession | undefined {
  if (!openThreadIds.has(threadId)) return undefined
  return sessions.get(threadId)
}

export function writeDetailsSession(
  threadId: number,
  patch: Partial<DetailsSession> & { tab?: DetailsModalTab }
): void {
  if (!openThreadIds.has(threadId)) return
  const current = sessions.get(threadId)
  sessions.set(threadId, {
    details: patch.details !== undefined ? patch.details : (current?.details ?? null),
    tab: patch.tab ?? current?.tab ?? 'overview'
  })
}

export function resetDetailsSessionCacheForTests(): void {
  sessions.clear()
  openThreadIds.clear()
}
