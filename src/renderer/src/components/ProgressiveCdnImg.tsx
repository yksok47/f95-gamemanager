import { useEffect, useRef, useState, type JSX, type MouseEventHandler } from 'react'
import { f95AttachmentThumbUrl } from '../lib/f95-cdn-url'

type ProgressiveCdnImgProps = {
  src: string
  alt?: string
  className?: string
  draggable?: boolean
  /** Load the original file. Grid/thumbs stay on the `/thumb/` preview. */
  full?: boolean
  /**
   * Show the `/thumb/` preview first and swap in the original once it is on
   * screen and decoded. F95zone thumbs are only ~100px wide, too small for tiles.
   */
  upgrade?: boolean
  onClick?: MouseEventHandler<HTMLImageElement>
}

const MAX_PARALLEL_UPGRADES = 3
const decoded = new Set<string>()
const failed = new Set<string>()
const waiting: Array<() => void> = []
let running = 0

function nextUpgrade(): void {
  while (running < MAX_PARALLEL_UPGRADES && waiting.length) {
    running += 1
    waiting.shift()?.()
  }
}

function preloadFull(url: string, signal: AbortSignal): Promise<boolean> {
  if (decoded.has(url)) return Promise.resolve(true)
  if (failed.has(url)) return Promise.resolve(false)
  return new Promise((resolve) => {
    const start = (): void => {
      if (signal.aborted) {
        running -= 1
        nextUpgrade()
        resolve(false)
        return
      }
      const probe = new Image()
      probe.referrerPolicy = 'no-referrer'
      probe.decoding = 'async'
      const finish = (ok: boolean): void => {
        if (ok) decoded.add(url)
        else failed.add(url)
        running -= 1
        nextUpgrade()
        resolve(ok)
      }
      probe.onload = () => {
        void probe.decode().then(
          () => finish(true),
          () => finish(true)
        )
      }
      probe.onerror = () => finish(false)
      probe.src = url
    }
    waiting.push(start)
    nextUpgrade()
  })
}

export default function ProgressiveCdnImg({
  src,
  alt = '',
  className,
  draggable,
  full = false,
  upgrade = false,
  onClick
}: ProgressiveCdnImgProps): JSX.Element {
  const thumb = f95AttachmentThumbUrl(src)
  const [useFull, setUseFull] = useState(
    () => (full && thumb === src) || (upgrade && decoded.has(src))
  )
  const errors = useRef(0)
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    errors.current = 0
    if (thumb === src) {
      setUseFull(false)
      return
    }
    if (full) {
      setUseFull(true)
      return
    }
    if (!upgrade) {
      setUseFull(false)
      return
    }
    if (decoded.has(src)) {
      setUseFull(true)
      return
    }
    setUseFull(false)

    const node = imgRef.current
    if (!node) return
    const controller = new AbortController()
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        void preloadFull(src, controller.signal).then((ok) => {
          if (ok && !controller.signal.aborted) setUseFull(true)
        })
      },
      { rootMargin: '200px' }
    )
    observer.observe(node)
    return () => {
      controller.abort()
      observer.disconnect()
    }
  }, [src, thumb, full, upgrade])

  return (
    <img
      ref={imgRef}
      src={useFull ? src : thumb}
      alt={alt}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={draggable}
      className={className}
      fetchPriority={full ? 'high' : 'low'}
      onClick={onClick}
      onError={() => {
        if (errors.current >= 2) return
        errors.current += 1
        if (useFull) {
          setUseFull(false)
          return
        }
        if ((full || upgrade) && thumb !== src) setUseFull(true)
      }}
    />
  )
}
