import { useEffect, useId, useMemo, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { SaveFolderPeekShot } from '@shared/types'
import { notifyCaught } from './ErrorNotifications'

const peekCache = new Map<string, SaveFolderPeekShot[]>()

type PeekGroup = {
  key: string
  label: string
  shots: Array<SaveFolderPeekShot & { index: number }>
}

function groupOrder(page: string): number {
  if (page === 'auto') return 0
  if (page === 'quick') return 1
  if (/^\d+$/.test(page)) return 100 + Number(page)
  return 1000
}

function groupLabel(page: string): string {
  if (page === 'auto') return 'Auto'
  if (page === 'quick') return 'Quick'
  if (/^\d+$/.test(page)) return `Page ${page}`
  return 'Other'
}

function groupPeekShots(shots: SaveFolderPeekShot[]): PeekGroup[] {
  const groups = new Map<string, PeekGroup>()
  shots.forEach((shot, index) => {
    const page = shot.page || 'other'
    const existing = groups.get(page)
    const item = { ...shot, index }
    if (existing) {
      existing.shots.push(item)
      return
    }
    groups.set(page, { key: page, label: groupLabel(page), shots: [item] })
  })
  return [...groups.values()].sort((a, b) => groupOrder(a.key) - groupOrder(b.key))
}

function newestShot(shots: SaveFolderPeekShot[]): SaveFolderPeekShot | null {
  if (!shots.length) return null
  return shots.reduce((best, shot) => (shot.modifiedAt > best.modifiedAt ? shot : best))
}

export function useSaveFolderPeek(savePath: string | null | undefined): {
  shots: SaveFolderPeekShot[]
  loading: boolean
} {
  const path = savePath || ''
  const cached = path ? peekCache.get(path) : undefined
  const [shots, setShots] = useState<SaveFolderPeekShot[]>(cached || [])
  const [loading, setLoading] = useState(Boolean(path && !cached))

  useEffect(() => {
    if (!path) {
      setShots([])
      setLoading(false)
      return
    }
    const hit = peekCache.get(path)
    if (hit) {
      setShots(hit)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    window.api.library
      .peekSaveFolder(path)
      .then((next) => {
        peekCache.set(path, next)
        if (!cancelled) setShots(next)
      })
      .catch((err) => {
        if (!cancelled) {
          setShots([])
          notifyCaught(err, 'Could not load save screenshots.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  return { shots, loading }
}

function ShotImage({ url, className }: { url: string; className: string }): JSX.Element {
  const [broken, setBroken] = useState(false)
  if (broken) return <span className={`${className} storage-save-peek-empty`} aria-hidden="true" />
  return <img className={className} src={url} alt="" draggable={false} onError={() => setBroken(true)} />
}

function Cover({ url, title }: { url: string | null; title: string }): JSX.Element {
  const [broken, setBroken] = useState(!url)
  useEffect(() => {
    setBroken(!url)
  }, [url])
  if (broken || !url) {
    return (
      <span className="storage-cover storage-cover-fallback" aria-hidden="true">
        {(title.trim()[0] || '?').toUpperCase()}
      </span>
    )
  }
  return <img className="storage-cover" src={url} alt="" draggable={false} onError={() => setBroken(true)} />
}

function PeekShotGrid({
  groups,
  active,
  onPick,
  compact
}: {
  groups: PeekGroup[]
  active?: number
  onPick: (index: number) => void
  compact?: boolean
}): JSX.Element {
  return (
    <div className={compact ? 'storage-save-peek-groups is-compact' : 'storage-save-peek-groups'}>
      {groups.map((group) => (
        <section key={group.key} className="storage-save-peek-group">
          <h3 className="storage-save-peek-group-title">{group.label}</h3>
          <div className="storage-save-peek-grid">
            {group.shots.map((shot) => (
              <button
                key={`${shot.thumbnailUrl}:${shot.index}`}
                className={
                  shot.index === active ? 'storage-save-peek-thumb is-active' : 'storage-save-peek-thumb'
                }
                type="button"
                title={[shot.label, shot.saveName].filter(Boolean).join(' · ')}
                onClick={() => onPick(shot.index)}
              >
                <ShotImage url={shot.thumbnailUrl} className="storage-save-peek-img" />
                <span className="storage-save-peek-caption">{shot.label}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function SavePeekLightbox({
  shots,
  index,
  onClose,
  onChange
}: {
  shots: SaveFolderPeekShot[]
  index: number
  onClose: () => void
  onChange: (next: number) => void
}): JSX.Element {
  const titleId = useId()
  const shot = shots[index]
  const caption = [shot?.label, shot?.saveName].filter(Boolean).join(' · ')
  const groups = useMemo(() => groupPeekShots(shots), [shots])
  const activeRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        onChange((index - 1 + shots.length) % shots.length)
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        onChange((index + 1) % shots.length)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [index, onChange, onClose, shots.length])

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [index])

  return createPortal(
    <div className="storage-save-lightbox" role="presentation" onMouseDown={onClose}>
      <div
        className={
          shots.length > 1 ? 'storage-save-lightbox-card has-pages' : 'storage-save-lightbox-card'
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="storage-save-lightbox-head">
          <h2 id={titleId} className="app-confirm-title">
            Save screenshots
          </h2>
          <p className="muted">
            {caption || 'All save slots'}
            {shots.length > 1 ? ` · ${index + 1} of ${shots.length}` : ''}
          </p>
          <button className="ghost-btn" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="storage-save-lightbox-stage">
          {shots.length > 1 ? (
            <button
              className="storage-save-lightbox-nav"
              type="button"
              aria-label="Previous screenshot"
              onClick={() => onChange((index - 1 + shots.length) % shots.length)}
            >
              ‹
            </button>
          ) : null}
          {shot ? <ShotImage url={shot.thumbnailUrl} className="storage-save-lightbox-img" /> : null}
          {shots.length > 1 ? (
            <button
              className="storage-save-lightbox-nav"
              type="button"
              aria-label="Next screenshot"
              onClick={() => onChange((index + 1) % shots.length)}
            >
              ›
            </button>
          ) : null}
        </div>
        {shots.length > 1 ? (
          <div className="storage-save-lightbox-pages">
            {groups.map((group) => (
              <section key={group.key} className="storage-save-peek-group">
                <h3 className="storage-save-peek-group-title">{group.label}</h3>
                <div className="storage-save-peek-grid">
                  {group.shots.map((item) => (
                    <button
                      key={`${item.thumbnailUrl}:${item.index}`}
                      ref={item.index === index ? activeRef : undefined}
                      className={
                        item.index === index ? 'storage-save-peek-thumb is-active' : 'storage-save-peek-thumb'
                      }
                      type="button"
                      title={[item.label, item.saveName].filter(Boolean).join(' · ')}
                      onClick={() => onChange(item.index)}
                    >
                      <ShotImage url={item.thumbnailUrl} className="storage-save-peek-img" />
                      <span className="storage-save-peek-caption">{item.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}

export function SavePeekStrip({
  savePath,
  emptyLabel = 'No screenshots in these saves.'
}: {
  savePath: string
  emptyLabel?: string
}): JSX.Element | null {
  const { shots, loading } = useSaveFolderPeek(savePath)
  const [open, setOpen] = useState<number | null>(null)
  const groups = useMemo(() => groupPeekShots(shots), [shots])

  if (loading && !shots.length) {
    return <p className="muted storage-save-peek-status">Loading save screenshots…</p>
  }
  if (!shots.length) {
    return <p className="muted storage-save-peek-status">{emptyLabel}</p>
  }

  return (
    <div className="storage-save-peek">
      <p className="muted storage-save-peek-label">
        Screenshots from all saves · {shots.length} slot{shots.length === 1 ? '' : 's'}
      </p>
      <PeekShotGrid groups={groups} active={open ?? undefined} onPick={setOpen} compact />
      {open != null ? (
        <SavePeekLightbox shots={shots} index={open} onClose={() => setOpen(null)} onChange={setOpen} />
      ) : null}
    </div>
  )
}

export function SavePeekCover({
  url,
  title,
  savePath,
  identified
}: {
  url: string | null
  title: string
  savePath?: string | null
  identified?: boolean
}): JSX.Element {
  const { shots } = useSaveFolderPeek(identified && url ? null : savePath)
  const cover = url || newestShot(shots)?.thumbnailUrl || null
  const [hover, setHover] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const wrapRef = useRef<HTMLSpanElement>(null)
  const [flyout, setFlyout] = useState<{ top: number; left: number } | null>(null)
  const hideTimer = useRef(0)
  const groups = useMemo(() => groupPeekShots(shots), [shots])

  function showFlyout(): void {
    window.clearTimeout(hideTimer.current)
    setHover(true)
  }

  function hideFlyout(): void {
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setHover(false), 180)
  }

  useEffect(() => {
    return () => window.clearTimeout(hideTimer.current)
  }, [])

  useEffect(() => {
    if (!hover || !shots.length) {
      setFlyout(null)
      return
    }
    const box = wrapRef.current?.getBoundingClientRect()
    if (!box) return
    const width = 420
    const height = 320
    const left = Math.min(window.innerWidth - width - 12, Math.max(12, box.right + 10))
    const top = Math.min(window.innerHeight - height - 12, Math.max(12, box.top))
    setFlyout({ top, left })
  }, [hover, shots.length])

  return (
    <span
      ref={wrapRef}
      className="storage-cover-peek-wrap"
      onMouseEnter={showFlyout}
      onMouseLeave={hideFlyout}
    >
      <Cover url={cover} title={title} />
      {hover && flyout && shots.length
        ? createPortal(
            <div
              className="storage-save-peek-flyout"
              style={{ top: flyout.top, left: flyout.left }}
              onMouseEnter={showFlyout}
              onMouseLeave={hideFlyout}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <PeekShotGrid
                groups={groups}
                onPick={(index) => {
                  setHover(false)
                  setOpen(index)
                }}
                compact
              />
              <span className="muted">
                {shots.length} screenshot{shots.length === 1 ? '' : 's'} · click to enlarge
              </span>
            </div>,
            document.body
          )
        : null}
      {open != null ? (
        <SavePeekLightbox shots={shots} index={open} onClose={() => setOpen(null)} onChange={setOpen} />
      ) : null}
    </span>
  )
}

export function SavePeekButton({
  savePath,
  disabled
}: {
  savePath: string
  disabled?: boolean
}): JSX.Element {
  const [want, setWant] = useState(false)
  const { shots, loading } = useSaveFolderPeek(want ? savePath : null)
  const [open, setOpen] = useState<number | null>(null)
  const opened = useRef(false)

  useEffect(() => {
    if (!want || loading || opened.current) return
    if (shots.length) {
      opened.current = true
      setOpen(0)
    }
  }, [want, loading, shots.length])

  return (
    <>
      <button
        className="ghost-btn"
        type="button"
        disabled={disabled || (want && loading) || (want && !loading && !shots.length)}
        title={
          want && !loading && !shots.length
            ? 'No screenshots in these saves'
            : 'View screenshots from all saves'
        }
        onClick={() => {
          if (shots.length) {
            setOpen(0)
            return
          }
          setWant(true)
        }}
      >
        {want && loading ? 'Peek…' : 'Peek'}
      </button>
      {open != null ? (
        <SavePeekLightbox shots={shots} index={open} onClose={() => setOpen(null)} onChange={setOpen} />
      ) : null}
    </>
  )
}
