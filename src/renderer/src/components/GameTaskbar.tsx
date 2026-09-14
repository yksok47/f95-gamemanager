import { useEffect, useState, type JSX, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'

export type GameTaskbarItem = {
  threadId: number
  title: string
  coverUrl: string | null
}

type GameTaskbarProps = {
  items: GameTaskbarItem[]
  activeThreadId: number | null
  onToggle: (threadId: number) => void
  onClose: (threadId: number) => void
}

type TaskbarPreview = {
  item: GameTaskbarItem
  left: number
  bottom: number
}

function isMiddleButton(event: { button: number }): boolean {
  return event.button === 1
}

function suppressMiddleAutoscroll(event: {
  button: number
  preventDefault: () => void
  stopPropagation: () => void
}): void {
  if (!isMiddleButton(event)) return
  event.preventDefault()
  event.stopPropagation()
}

function coverInitial(title: string): string {
  return title.trim().charAt(0).toUpperCase() || '?'
}

function previewFromTarget(item: GameTaskbarItem, target: HTMLElement): TaskbarPreview {
  const rect = target.getBoundingClientRect()
  return {
    item,
    left: rect.left + rect.width / 2,
    bottom: window.innerHeight - rect.top + 8
  }
}

function GameTaskbarCover({
  item,
  className
}: {
  item: GameTaskbarItem
  className: string
}): JSX.Element {
  const [broken, setBroken] = useState(!item.coverUrl)

  useEffect(() => {
    setBroken(!item.coverUrl)
  }, [item.coverUrl])

  if (broken || !item.coverUrl) {
    return (
      <span className={`${className} game-taskbar-fallback`} aria-hidden="true">
        {coverInitial(item.title)}
      </span>
    )
  }

  return (
    <img
      className={`${className} game-taskbar-cover`}
      src={item.coverUrl}
      alt=""
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setBroken(true)}
    />
  )
}

function GameTaskbarButton({
  item,
  active,
  onToggle,
  onClose,
  onPreview
}: {
  item: GameTaskbarItem
  active: boolean
  onToggle: () => void
  onClose: () => void
  onPreview: (preview: TaskbarPreview | null) => void
}): JSX.Element {
  function onAuxClick(event: MouseEvent<HTMLButtonElement>): void {
    if (!isMiddleButton(event)) return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  return (
    <button
      className={active ? 'game-taskbar-btn is-active' : 'game-taskbar-btn'}
      type="button"
      aria-label={active ? `Minimize ${item.title}` : `Restore ${item.title}`}
      aria-pressed={active}
      onClick={onToggle}
      onPointerDown={suppressMiddleAutoscroll}
      onMouseDown={suppressMiddleAutoscroll}
      onAuxClick={onAuxClick}
      onMouseEnter={(event) => onPreview(previewFromTarget(item, event.currentTarget))}
      onMouseLeave={() => onPreview(null)}
      onFocus={(event) => onPreview(previewFromTarget(item, event.currentTarget))}
      onBlur={() => onPreview(null)}
    >
      <GameTaskbarCover item={item} className="game-taskbar-icon" />
    </button>
  )
}

export default function GameTaskbar({
  items,
  activeThreadId,
  onToggle,
  onClose
}: GameTaskbarProps): JSX.Element | null {
  const [preview, setPreview] = useState<TaskbarPreview | null>(null)

  useEffect(() => {
    setPreview((current) => {
      if (!current) return null
      const item = items.find((entry) => entry.threadId === current.item.threadId)
      return item ? { ...current, item } : null
    })
  }, [items])

  if (!items.length) return null

  return (
    <div className="game-taskbar" role="toolbar" aria-label="Open games" onScroll={() => setPreview(null)}>
      {items.map((item) => (
        <GameTaskbarButton
          key={item.threadId}
          item={item}
          active={item.threadId === activeThreadId}
          onToggle={() => onToggle(item.threadId)}
          onClose={() => onClose(item.threadId)}
          onPreview={setPreview}
        />
      ))}
      {preview
        ? createPortal(
            <div
              className="game-taskbar-preview"
              role="tooltip"
              style={{ left: preview.left, bottom: preview.bottom }}
            >
              <GameTaskbarCover item={preview.item} className="game-taskbar-preview-cover" />
              <span className="game-taskbar-preview-name">{preview.item.title}</span>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}
