import { useEffect, useRef, useState, type JSX, type MouseEventHandler } from 'react'
import { f95AttachmentThumbUrl } from '../lib/f95-cdn-url'

const decodedFull = new Set<string>()
const inflight = new Map<string, Promise<boolean>>()

function preloadFull(url: string): Promise<boolean> {
  if (decodedFull.has(url)) return Promise.resolve(true)
  const pending = inflight.get(url)
  if (pending) return pending
  const task = new Promise<boolean>((resolve) => {
    const probe = new Image()
    probe.referrerPolicy = 'no-referrer'
    probe.fetchPriority = 'low'
    probe.onload = () => {
      const done = (ok: boolean): void => {
        if (ok) decodedFull.add(url)
        inflight.delete(url)
        resolve(ok)
      }
      void probe.decode().then(
        () => done(true),
        () => done(true)
      )
    }
    probe.onerror = () => {
      inflight.delete(url)
      resolve(false)
    }
    probe.src = url
  })
  inflight.set(url, task)
  return task
}

export default function ProgressiveCdnImg({
  src,
  alt = '',
  className,
  draggable,
  onClick
}: {
  src: string
  alt?: string
  className?: string
  draggable?: boolean
  onClick?: MouseEventHandler<HTMLImageElement>
}): JSX.Element {
  const thumb = f95AttachmentThumbUrl(src)
  const [useFull, setUseFull] = useState(() => decodedFull.has(src) || thumb === src)
  const errors = useRef(0)

  useEffect(() => {
    errors.current = 0
    if (decodedFull.has(src) || thumb === src) {
      setUseFull(true)
      return
    }
    setUseFull(false)
    let cancelled = false
    void preloadFull(src).then((ok) => {
      if (!cancelled && ok) setUseFull(true)
    })
    return () => {
      cancelled = true
    }
  }, [src, thumb])

  return (
    <img
      src={useFull ? src : thumb}
      alt={alt}
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={draggable}
      className={className}
      fetchPriority="high"
      onClick={onClick}
      onError={() => {
        if (errors.current >= 2) return
        errors.current += 1
        if (useFull) {
          decodedFull.delete(src)
          setUseFull(false)
          return
        }
        if (thumb !== src) setUseFull(true)
      }}
    />
  )
}
