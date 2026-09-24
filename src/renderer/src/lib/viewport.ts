import { useEffect, useState, type RefObject } from 'react'

function scrollRoot(): Element | null {
  const main = document.querySelector('.app-main')
  return main instanceof Element ? main : null
}

const listeners = new Map<Element, (near: boolean) => void>()
let observer: IntersectionObserver | null = null

function sharedObserver(): IntersectionObserver {
  if (observer) return observer
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        listeners.get(entry.target)?.(entry.isIntersecting)
      }
    },
    { root: scrollRoot(), rootMargin: '400px 0px' }
  )
  return observer
}

function observeNear(el: Element, onChange: (near: boolean) => void): () => void {
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
