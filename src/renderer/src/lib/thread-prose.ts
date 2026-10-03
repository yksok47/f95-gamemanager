import type { MouseEvent as ReactMouseEvent } from 'react'
import { isDirectFileHref } from '@shared/direct-file'

type ProseMouseEvent = ReactMouseEvent<HTMLElement>

export type ThreadProseTarget =
  | { kind: 'post'; postId: number }
  | { kind: 'thread'; threadId: number; title: string }
  | { kind: 'url'; href: string; download?: boolean }

export function postIdFromHref(href: string, dataPostId = 0): number {
  return (
    dataPostId ||
    Number(
      (href.match(/\/posts\/(\d+)/i) ||
        href.match(/\/post-(\d+)/i) ||
        href.match(/goto\/post\?id=(\d+)/i) ||
        href.match(/#(?:js-)?post-(\d+)/i))?.[1] || 0
    )
  )
}

export function threadIdFromHref(href: string, dataThreadId = 0): number {
  if (dataThreadId) return dataThreadId
  return Number(href.match(/\/threads\/(?:[^/?#]*\.)?(\d+)/i)?.[1] || 0)
}

/** Toggle spoilers and quote expanders. Returns true when the click was consumed. */
export function consumeBbcodeClick(event: ProseMouseEvent): boolean {
  const spoilerButton = (event.target as HTMLElement).closest('.bbCodeSpoiler-button')
  if (spoilerButton) {
    event.preventDefault()
    const spoiler = spoilerButton.closest('.bbCodeSpoiler')
    spoiler?.classList.toggle('is-active')
    return true
  }
  const expandToggle = (event.target as HTMLElement).closest('.bbCodeBlock-expandToggle')
  if (expandToggle instanceof HTMLElement) {
    event.preventDefault()
    const block = expandToggle.closest('.bbCodeBlock--expandable')
    if (block) {
      const expanded = block.classList.toggle('is-expanded')
      expandToggle.textContent = expanded ? 'Show less' : 'Show more'
      expandToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
    }
    return true
  }
  return false
}

export function threadProseTarget(
  event: ProseMouseEvent,
  currentThreadId: number
): ThreadProseTarget | null {
  if (consumeBbcodeClick(event)) return null
  const target = (event.target as HTMLElement).closest('a')
  if (!target) return null
  const href = target.getAttribute('href')
  if (!href) return null
  event.preventDefault()
  const postId = postIdFromHref(href, Number(target.getAttribute('data-post-id') || 0))
  const nextId = threadIdFromHref(href, Number(target.getAttribute('data-thread-id') || 0))
  if (postId && (!nextId || nextId === currentThreadId)) {
    return { kind: 'post', postId }
  }
  if (nextId) {
    return {
      kind: 'thread',
      threadId: nextId,
      title: target.getAttribute('data-thread-title') || target.textContent?.trim() || ''
    }
  }
  const extraName =
    target.getAttribute('download') ||
    target.getAttribute('title') ||
    target.textContent?.trim() ||
    ''
  return { kind: 'url', href, download: isDirectFileHref(href, extraName) || undefined }
}
