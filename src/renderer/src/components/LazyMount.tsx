import { useRef, type JSX, type ReactNode } from 'react'
import { useNearViewport } from '../lib/viewport'

type LazyMountProps = {
  eager?: boolean
  children: ReactNode
}

/** Defers mounting heavy grid cards until they approach the scrollport. */
export default function LazyMount({ eager = false, children }: LazyMountProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const near = useNearViewport(ref, { eager, rootMargin: '400px 0px' })
  return (
    <div ref={ref} className={near ? 'lazy-card is-ready' : 'lazy-card'}>
      {near ? children : <div className="lazy-card-placeholder" aria-hidden="true" />}
    </div>
  )
}
