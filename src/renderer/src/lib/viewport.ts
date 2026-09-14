import { useEffect, useRef, useState, type RefObject } from 'react'

function scrollRoot(): Element | null {
  const main = document.querySelector('.app-main')
  return main instanceof Element ? main : null
}

/** True once `ref` is in or near the app scrollport. Stays true after the first hit. */
export function useNearViewport(
  ref: RefObject<Element | null>,
  options?: { eager?: boolean; rootMargin?: string }
): boolean {
  const eager = Boolean(options?.eager)
  const rootMargin = options?.rootMargin ?? '1200px 0px'
  const revealed = useRef(eager)
  if (eager) revealed.current = true
  const [near, setNear] = useState(eager)

  useEffect(() => {
    if (revealed.current) {
      setNear(true)
      return
    }
    const el = ref.current
    if (!el) return
    const root = scrollRoot()
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        revealed.current = true
        setNear(true)
        io.disconnect()
      },
      { root, rootMargin }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [eager, ref, rootMargin])

  return revealed.current || near
}
