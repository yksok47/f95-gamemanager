import { useEffect, useState, type JSX, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { MenuPopover } from './MenuPopover'

export type GameTaskbarItem = {
  threadId: number
  title: string
  coverUrl: string | null
  pinned?: boolean
}

type GameTaskbarProps = {
  items: GameTaskbarItem[]
  activeThreadId: number | null
  openThreadIds: readonly number[]
  onToggle: (threadId: number) => void
  onClose: (threadId: number) => void
  onPinToggle: (threadId: number) => void
}

type TaskbarPreview = {
  item: GameTaskbarItem
  left: number
  bottom: number
}

type TaskbarMenu = {
  threadId: number
  anchor: HTMLElement
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
  open,
  menuOpen,
  onToggle,
  onClose,
  onPreview,
  onMenu
}: {
  item: GameTaskbarItem
  active: boolean
  open: boolean
  menuOpen: boolean
  onToggle: () => void
  onClose: () => void
  onPreview: (preview: TaskbarPreview | null) => void
  onMenu: (anchor: HTMLElement | null) => void
}): JSX.Element {
  function onAuxClick(event: MouseEvent<HTMLButtonElement>): void {
    if (!isMiddleButton(event)) return
    event.preventDefault()
    event.stopPropagation()
    onMenu(null)
    onClose()
  }

  function onContextMenu(event: MouseEvent<HTMLButtonElement>): void {
    event.preventDefault()
    event.stopPropagation()
    onPreview(null)
    onMenu(event.currentTarget)
  }

  const className = [
    'game-taskbar-btn',
    active ? 'is-active' : '',
    open ? 'is-open' : '',
    item.pinned ? 'is-pinned' : '',
    menuOpen ? 'is-menu-open' : ''
  ]
    .filter(Boolean)
    .join(' ')

  const pinnedSuffix = item.pinned ? ' (pinned)' : ''
  const action = active ? 'Minimize' : open ? 'Switch to' : 'Restore'

  return (
    <button
      className={className}
      type="button"
      aria-label={`${action} ${item.title}${pinnedSuffix}`}
      aria-pressed={open}
      onClick={() => {
        onMenu(null)
        onToggle()
      }}
      onPointerDown={suppressMiddleAutoscroll}
      onMouseDown={suppressMiddleAutoscroll}
      onAuxClick={onAuxClick}
      onContextMenu={onContextMenu}
      onMouseEnter={(event) => {
        if (menuOpen) return
        onPreview(previewFromTarget(item, event.currentTarget))
      }}
      onMouseLeave={() => onPreview(null)}
      onFocus={(event) => {
        if (menuOpen) return
        onPreview(previewFromTarget(item, event.currentTarget))
      }}
      onBlur={() => onPreview(null)}
    >
      <GameTaskbarCover item={item} className="game-taskbar-icon" />
    </button>
  )
}

export default function GameTaskbar({
  items,
  activeThreadId,
  openThreadIds,
  onToggle,
  onClose,
  onPinToggle
}: GameTaskbarProps): JSX.Element | null {
  const [preview, setPreview] = useState<TaskbarPreview | null>(null)
  const [menu, setMenu] = useState<TaskbarMenu | null>(null)

  useEffect(() => {
    setPreview((current) => {
      if (!current) return null
      const item = items.find((entry) => entry.threadId === current.item.threadId)
      return item ? { ...current, item } : null
    })
    setMenu((current) => {
      if (!current) return null
      return items.some((entry) => entry.threadId === current.threadId) ? current : null
    })
  }, [items])

  if (!items.length) return null

  const menuItem = menu ? items.find((entry) => entry.threadId === menu.threadId) : undefined

  return (
    <div className="game-taskbar" role="toolbar" aria-label="Open games" onScroll={() => setPreview(null)}>
      {items.map((item) => (
        <GameTaskbarButton
          key={item.threadId}
          item={item}
          active={item.threadId === activeThreadId}
          open={openThreadIds.includes(item.threadId)}
          menuOpen={menu?.threadId === item.threadId}
          onToggle={() => onToggle(item.threadId)}
          onClose={() => onClose(item.threadId)}
          onPreview={setPreview}
          onMenu={(anchor) => setMenu(anchor ? { threadId: item.threadId, anchor } : null)}
        />
      ))}
      {menu && menuItem
        ? (
            <MenuPopover
              className="game-taskbar-menu"
              anchor={menu.anchor}
              align="left"
              items={[
                {
                  id: menuItem.pinned ? 'unpin' : 'pin',
                  label: menuItem.pinned ? 'Unpin from taskbar' : 'Pin to taskbar',
                  onClick: () => onPinToggle(menuItem.threadId)
                }
              ]}
              onClose={() => setMenu(null)}
            />
          )
        : null}
      {preview && !menu
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
