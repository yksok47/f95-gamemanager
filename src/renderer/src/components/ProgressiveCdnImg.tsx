import { useEffect, useRef, useState, type JSX, type MouseEventHandler } from 'react'
import { f95AttachmentThumbUrl } from '../lib/f95-cdn-url'

type ProgressiveCdnImgProps = {
  src: string
  alt?: string
  className?: string
  draggable?: boolean
  /** Load the original file. Grid/thumbs stay on the `/thumb/` preview. */
  full?: boolean
  onClick?: MouseEventHandler<HTMLImageElement>
}

export default function ProgressiveCdnImg({
  src,
  alt = '',
  className,
  draggable,
  full = false,
  onClick
}: ProgressiveCdnImgProps): JSX.Element {
  const thumb = f95AttachmentThumbUrl(src)
  const [useFull, setUseFull] = useState(() => full && thumb === src)
  const errors = useRef(0)

  useEffect(() => {
    errors.current = 0
    if (!full || thumb === src) {
      setUseFull(false)
      return
    }
    setUseFull(true)
  }, [src, thumb, full])

  return (
    <img
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
        if (full && thumb !== src) setUseFull(true)
      }}
    />
  )
}
