import { useEffect, useLayoutEffect, useRef, type JSX, type ReactNode } from 'react'

export type PageTurnDirection = 'next' | 'prev'

export type CatalogPageTurnState = {
  direction: PageTurnDirection
  phase: 'preparing' | 'animating'
  fromPage: number
  toPage: number
} | null

type CatalogPageTurnProps = {
  totalPages: number
  disabled?: boolean
  turn: CatalogPageTurnState
  currentKey: number
  incomingKey: number
  incoming: ReactNode | null
  onPrev: () => void
  onNext: () => void
  onTurnAnimationEnd: () => void
  children: ReactNode
}

const ANIM_MS = 680
const ANIM_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

function mainScrollport(): HTMLElement | null {
  const main = document.querySelector('.app-main')
  return main instanceof HTMLElement ? main : null
}

export default function CatalogPageTurn({
  totalPages,
  disabled = false,
  turn,
  currentKey,
  incomingKey,
  incoming,
  onPrev,
  onNext,
  onTurnAnimationEnd,
  children
}: CatalogPageTurnProps): JSX.Element {
  const viewportRef = useRef<HTMLDivElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const currentPanelRef = useRef<HTMLDivElement>(null)
  const incomingPanelRef = useRef<HTMLDivElement>(null)
  const currentInnerRef = useRef<HTMLDivElement>(null)
  const endCalledRef = useRef(false)
  const wasAnimatingRef = useRef(false)
  const lastTurnDirectionRef = useRef<PageTurnDirection>('next')
  const animRafRef = useRef(0)

  const isTurning = Boolean(turn)
  const isPreparing = turn?.phase === 'preparing'
  const isAnimating = turn?.phase === 'animating'
  const controlsLocked = disabled || isTurning
  const direction = turn?.direction ?? 'next'
  const animToken = isAnimating && turn ? `${turn.direction}:${turn.fromPage}:${turn.toPage}` : ''
  const showIncoming = Boolean(isAnimating && incoming)
  const showPrev = currentKey > 1 || turn?.direction === 'prev'
  const showNext = currentKey < totalPages || turn?.direction === 'next'

  function finish(): void {
    if (endCalledRef.current) return
    endCalledRef.current = true
    onTurnAnimationEnd()
  }

  function clearInlineMotion(): void {
    const viewport = viewportRef.current
    const strip = stripRef.current
    const currentPanel = currentPanelRef.current
    const incomingPanel = incomingPanelRef.current
    const currentInner = currentInnerRef.current
    if (viewport) {
      viewport.style.height = ''
      viewport.style.overflow = ''
      viewport.style.marginTop = ''
      viewport.style.marginBottom = ''
    }
    if (strip) {
      strip.style.transform = ''
      strip.style.transition = ''
      strip.style.willChange = ''
      strip.style.height = ''
    }
    if (currentPanel) {
      currentPanel.style.height = ''
      currentPanel.style.overflow = ''
    }
    if (incomingPanel) {
      incomingPanel.style.height = ''
      incomingPanel.style.overflow = ''
    }
    if (currentInner) currentInner.style.transform = ''
  }

  function alignToMainTop(hidePrevControl: boolean): void {
    const root = viewportRef.current?.closest('.catalog-page-turn')
    const main = mainScrollport()
    if (!(root instanceof HTMLElement) || !main) return
    const mainRect = main.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    const delta = rootRect.top - mainRect.top
    if (Math.abs(delta) > 1) main.scrollTop += delta
    if (!hidePrevControl) return
    const prev = root.querySelector('.catalog-page-turn-control-prev')
    if (prev instanceof HTMLElement) main.scrollTop += prev.offsetHeight
  }

  useLayoutEffect(() => {
    if (isAnimating) {
      wasAnimatingRef.current = true
      if (turn) lastTurnDirectionRef.current = turn.direction
      return
    }
    clearInlineMotion()
    if (wasAnimatingRef.current) {
      wasAnimatingRef.current = false
      alignToMainTop(lastTurnDirectionRef.current === 'next')
    }
    endCalledRef.current = false
  }, [isAnimating, direction])

  useLayoutEffect(() => {
    if (!isAnimating || !turn) return

    const viewport = viewportRef.current
    const strip = stripRef.current
    const currentPanel = currentPanelRef.current
    const incomingPanel = incomingPanelRef.current
    const currentInner = currentInnerRef.current
    const main = mainScrollport()
    if (!viewport || !strip || !currentPanel || !incomingPanel || !currentInner || !main) {
      finish()
      return
    }

    endCalledRef.current = false

    const mainRect = main.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const occupiedH = currentPanel.offsetHeight
    const clipTop = Math.max(viewportRect.top, mainRect.top)
    const stageH = Math.max(Math.round(mainRect.bottom - clipTop), 1)
    const marginTop = Math.round(clipTop - viewportRect.top)
    const innerShift = Math.round(viewportRect.top - clipTop)

    currentPanel.style.height = `${stageH}px`
    incomingPanel.style.height = `${stageH}px`
    currentPanel.style.overflow = 'hidden'
    incomingPanel.style.overflow = 'hidden'
    currentInner.style.transform = innerShift ? `translate3d(0, ${innerShift}px, 0)` : ''

    viewport.style.marginTop = `${marginTop}px`
    viewport.style.height = `${stageH}px`
    viewport.style.overflow = 'hidden'
    viewport.style.marginBottom = `${Math.max(0, occupiedH - stageH - marginTop)}px`

    strip.style.height = `${stageH * 2}px`
    strip.style.transition = 'none'
    strip.style.willChange = 'transform'

    const startY = direction === 'next' ? 0 : -stageH
    const endY = direction === 'next' ? -stageH : 0
    strip.style.transform = `translate3d(0, ${startY}px, 0)`

    if (prefersReducedMotion()) {
      strip.style.transform = `translate3d(0, ${endY}px, 0)`
      finish()
      return
    }

    const onEnd = (event: TransitionEvent): void => {
      if (event.target !== strip || event.propertyName !== 'transform') return
      strip.removeEventListener('transitionend', onEnd)
      finish()
    }

    strip.addEventListener('transitionend', onEnd)

    animRafRef.current = window.requestAnimationFrame(() => {
      animRafRef.current = window.requestAnimationFrame(() => {
        strip.style.transition = `transform ${ANIM_MS}ms ${ANIM_EASING}`
        strip.style.transform = `translate3d(0, ${endY}px, 0)`
      })
    })

    return () => {
      strip.removeEventListener('transitionend', onEnd)
      window.cancelAnimationFrame(animRafRef.current)
    }
    // finish/onTurnAnimationEnd omitted — only re-run when the anim phase starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnimating, animToken])

  useEffect(() => {
    if (!isAnimating) return
    if (prefersReducedMotion()) return
    const timer = window.setTimeout(finish, ANIM_MS + 250)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAnimating, direction])

  type Panel = {
    key: number
    node: ReactNode
    role: 'current' | 'incoming'
  }

  const panels: Panel[] = []
  if (showIncoming && incoming && direction === 'prev') {
    panels.push({ key: incomingKey, node: incoming, role: 'incoming' })
  }
  panels.push({ key: currentKey, node: children, role: 'current' })
  if (showIncoming && incoming && direction === 'next') {
    panels.push({ key: incomingKey, node: incoming, role: 'incoming' })
  }

  return (
    <div
      className={[
        'catalog-page-turn',
        isTurning ? 'is-turning' : '',
        isPreparing ? 'is-preparing' : '',
        isAnimating ? 'is-animating' : '',
        turn ? `is-${direction}` : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {showPrev ? (
        <div className="catalog-page-turn-control catalog-page-turn-control-prev">
          <button
            type="button"
            className={[
              'ghost-btn catalog-page-turn-btn',
              isPreparing ? 'is-preparing' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            disabled={controlsLocked || currentKey <= 1}
            aria-label="Previous page"
            aria-busy={isPreparing || undefined}
            onClick={onPrev}
          >
            Previous
          </button>
        </div>
      ) : null}

      <div ref={viewportRef} className="catalog-page-turn-viewport">
        <div ref={stripRef} className="catalog-page-turn-strip">
          {panels.map((panel) => (
            <div
              key={panel.key}
              ref={panel.role === 'current' ? currentPanelRef : incomingPanelRef}
              className={[
                'catalog-page-turn-panel',
                panel.role === 'current'
                  ? showIncoming
                    ? 'is-outgoing'
                    : 'is-settled'
                  : 'is-incoming'
              ].join(' ')}
              aria-hidden={panel.role === 'current' && showIncoming ? true : undefined}
            >
              <div
                ref={panel.role === 'current' ? currentInnerRef : undefined}
                className="catalog-page-turn-panel-inner"
              >
                {panel.node}
              </div>
            </div>
          ))}
        </div>
      </div>

      {showNext ? (
        <div className="catalog-page-turn-control catalog-page-turn-control-next">
          <button
            type="button"
            className={[
              'ghost-btn catalog-page-turn-btn',
              isPreparing ? 'is-preparing' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            disabled={controlsLocked || currentKey >= totalPages}
            aria-label="Next page"
            aria-busy={isPreparing || undefined}
            onClick={onNext}
          >
            Next
          </button>
        </div>
      ) : null}
    </div>
  )
}
