export type ThreadLink = {
  threadId: number
  slug: string
}

const THREAD_LINK_RE = /f95zone\.to\/threads\/(?:([^/?#\s]*)\.)?(\d+)/gi

/** Unique F95zone thread links found anywhere in pasted text, in first-seen order. */
export function parseThreadLinks(text: string): ThreadLink[] {
  const seen = new Set<number>()
  const links: ThreadLink[] = []
  for (const match of text.matchAll(THREAD_LINK_RE)) {
    const threadId = Number(match[2])
    if (!Number.isSafeInteger(threadId) || threadId <= 0 || seen.has(threadId)) continue
    seen.add(threadId)
    links.push({ threadId, slug: match[1] ?? '' })
  }
  return links
}

/** Placeholder title from a thread URL slug, shown until the thread metadata is fetched. */
export function titleFromThreadSlug(slug: string, threadId: number): string {
  let decoded = slug
  try {
    decoded = decodeURIComponent(slug)
  } catch {
    decoded = slug
  }
  const words = decoded.split(/[-_+\s]+/).filter(Boolean)
  if (!words.length) return `Thread ${threadId}`
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}
