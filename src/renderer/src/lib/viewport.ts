import { useEffect, useState, type RefObject } from 'react'

function scrollRoot(): Element | null {
  const main = document.querySelector('.app-main')
  return main instanceof Element ? main : null
}

/** True when `ref` is in or near the app scrollport. Eager tiles stay mounted. */
export function useNearViewport(
  ref: RefObject<Element | null>,
  options?: { eager?: boolean; rootMargin?: string }
): boolean {
  const eager = Boolean(options?.eager)
  const rootMargin = options?.rootMargin ?? '400px 0px'
  const [near, setNear] = useState(eager)

  useEffect(() => {
    if (eager) {
      setNear(true)
      return
    }
    const el = ref.current
    if (!el) return
    const root = scrollRoot()
    const io = new IntersectionObserver(
      (entries) => {
        setNear(entries.some((entry) => entry.isIntersecting))
      },
      { root, rootMargin }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [eager, ref, rootMargin])

  return eager || near
}
