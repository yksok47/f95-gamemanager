import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import ProgressiveCdnImg from './ProgressiveCdnImg'
import { ClearIcon } from './ToolbarIcons'

type ThreadGalleryProps = {
  images: string[]
}

export default function ThreadGallery({ images }: ThreadGalleryProps): JSX.Element {
  const [lightbox, setLightbox] = useState<number | null>(null)
  const lightboxThumbRefs = useRef<Array<HTMLButtonElement | null>>([])
  const lightboxThumbsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (lightbox == null) return

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setLightbox(null)
        return
      }
      if (event.key === 'ArrowRight') {
        setLightbox((index) => (index == null ? index : (index + 1) % images.length))
      }
      if (event.key === 'ArrowLeft') {
        setLightbox((index) => (index == null ? index : (index - 1 + images.length) % images.length))
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [lightbox, images.length])

  useEffect(() => {
    if (lightbox == null) return
    lightboxThumbRefs.current[lightbox]?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest'
    })
  }, [lightbox])

  return (
    <>
      <div className="gallery-grid">
        {images.map((url, index) => (
          <button
            key={`${url}-${index}`}
            className="gallery-item"
            type="button"
            onClick={() => setLightbox(index)}
          >
            <ProgressiveCdnImg src={url} />
          </button>
        ))}
      </div>
      {lightbox != null && images[lightbox]
        ? createPortal(
            <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
              <button
                className="lightbox-close"
                type="button"
                aria-label="Close gallery"
                onClick={(event) => {
                  event.stopPropagation()
                  setLightbox(null)
                }}
              >
                <ClearIcon />
              </button>
              <div className="lightbox-stage">
                <ProgressiveCdnImg
                  src={images[lightbox]}
                  full
                  draggable={false}
                  onClick={(event) => event.stopPropagation()}
                />
                {images.length > 1 ? (
                  <>
                    <button
                      className="lightbox-nav lightbox-prev"
                      type="button"
                      aria-label="Previous photo"
                      onClick={(event) => {
                        event.stopPropagation()
                        setLightbox((index) =>
                          index == null ? 0 : (index - 1 + images.length) % images.length
                        )
                      }}
                    >
                      ‹
                    </button>
                    <button
                      className="lightbox-nav lightbox-next"
                      type="button"
                      aria-label="Next photo"
                      onClick={(event) => {
                        event.stopPropagation()
                        setLightbox((index) => (index == null ? 0 : (index + 1) % images.length))
                      }}
                    >
                      ›
                    </button>
                  </>
                ) : null}
              </div>
              {images.length > 1 ? (
                <div
                  ref={lightboxThumbsRef}
                  className="lightbox-thumbs"
                  role="listbox"
                  aria-label="Gallery thumbnails"
                  onClick={(event) => event.stopPropagation()}
                >
                  {images.map((url, index) => (
                    <button
                      key={`${url}-${index}`}
                      ref={(node) => {
                        lightboxThumbRefs.current[index] = node
                      }}
                      className={index === lightbox ? 'lightbox-thumb is-active' : 'lightbox-thumb'}
                      type="button"
                      role="option"
                      aria-selected={index === lightbox}
                      title={`Photo ${index + 1} of ${images.length}`}
                      onClick={() => setLightbox(index)}
                    >
                      <ProgressiveCdnImg src={url} draggable={false} />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
