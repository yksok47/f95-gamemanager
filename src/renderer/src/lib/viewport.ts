import { useEffect, useState, type RefObject } from 'react'

function scrollRoot(): Element | null {
  const main = document.querySelector('.app-main')
  return main instanceof Element ? main : null
}

const listeners = new Map<Element, (near: boolean) => void>()
let observer: IntersectionObserver | null = null

/**
 * `.app-main` is replaced whenever the app shell remounts (sign out and back in,
 * or a session that needs the two-step code again). An observer bound to the old
 * element never reports anything, so rebuild it when the scroll root changes.
 */
function sharedObserver(): IntersectionObserver {
  const root = scrollRoot()
  if (observer && observer.root === root) return observer
  observer?.disconnect()
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        listeners.get(entry.target)?.(entry.isIntersecting)
      }
    },
    { root, rootMargin: '400px 0px' }
  )
  for (const el of listeners.keys()) observer.observe(el)
  return observer
}

export function observeNear(el: Element, onChange: (near: boolean) => void): () => void {
  listeners.set(el, onChange)
  sharedObserver().observe(el)
  return () => {
    listeners.delete(el)
    observer?.unobserve(el)
  }
}

/** True when `ref` is in or near the app scrollport. Eager tiles stay mounted. */
export function useNearViewport(
  ref: RefObject<Element | null>,
  options?: { eager?: boolean }
): boolean {
  const eager = Boolean(options?.eager)
  const [near, setNear] = useState(eager)

  useEffect(() => {
    if (eager) {
      setNear(true)
      return
    }
    const el = ref.current
    if (!el) return
    return observeNear(el, setNear)
  }, [eager, ref])

  return eager || near
}
