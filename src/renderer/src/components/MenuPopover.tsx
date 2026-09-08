import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'

export type MenuItem = {
  id: string
  label: string
  disabled?: boolean
  onClick: () => void
}

type MenuPopoverProps = {
  anchor: HTMLElement
  items: MenuItem[]
  onClose: () => void
  align?: 'left' | 'right'
}

export function MenuPopover({
  anchor,
  items,
  onClose,
  align = 'right'
}: MenuPopoverProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect()
    const menu = ref.current
    const width = menu?.offsetWidth || 180
    const height = menu?.offsetHeight || 0
    let left = align === 'right' ? rect.right - width : rect.left
    let top = rect.bottom + 6
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
    if (top + height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - height - 6)
    }
    setPos({ top, left })
  }, [anchor, align, items.length])

  useEffect(() => {
    function onPointer(event: PointerEvent): void {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onClose, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onClose, true)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      className="card-menu"
      style={{ top: pos.top, left: pos.left }}
      role="menu"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            item.onClick()
            onClose()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>,
    document.body
  )
}

type SplitButtonProps = {
  label: string
  onClick: () => void
  items?: MenuItem[]
  variant?: 'primary' | 'ghost'
  disabled?: boolean
}

export function SplitButton({
  label,
  onClick,
  items = [],
  variant = 'ghost',
  disabled = false
}: SplitButtonProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const caretRef = useRef<HTMLButtonElement>(null)
  const hasMenu = items.length > 0

  return (
    <div className={`split-btn split-btn-${variant}`}>
      <button className="split-btn-main" type="button" disabled={disabled} onClick={onClick}>
        {label}
      </button>
      {hasMenu ? (
        <>
          <button
            ref={caretRef}
            className="split-btn-caret"
            type="button"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={`${label} more actions`}
            disabled={disabled}
            onClick={() => setOpen((value) => !value)}
          >
            <span aria-hidden="true">▾</span>
          </button>
          {open && caretRef.current ? (
            <MenuPopover
              anchor={caretRef.current}
              items={items}
              onClose={() => setOpen(false)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}

export function MoreMenu({
  items,
  disabled = false,
  label = 'More actions'
}: {
  items: MenuItem[]
  disabled?: boolean
  label?: string
}): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  if (!items.length) return null

  return (
    <>
      <button
        ref={buttonRef}
        className="ghost-btn more-menu-btn"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && buttonRef.current ? (
        <MenuPopover anchor={buttonRef.current} items={items} onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}
