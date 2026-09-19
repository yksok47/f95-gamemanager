import { useRef, useState, type JSX, type ReactNode } from 'react'
import { MenuPopover } from './MenuPopover'

type SelectOption<T extends string> = {
  value: T
  label: string
}

type SelectMenuProps<T extends string> = {
  value: T
  options: Array<SelectOption<T>>
  onChange: (value: T) => void
  disabled?: boolean
  title?: string
  ariaLabel?: string
  addon?: ReactNode
}

export default function SelectMenu<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
  title,
  ariaLabel,
  addon
}: SelectMenuProps<T>): JSX.Element {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const current = options.find((item) => item.value === value)

  const trigger = (
    <button
      ref={buttonRef}
      className={open ? 'toolbar-select-btn is-open' : 'toolbar-select-btn'}
      type="button"
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
    >
      <span>{current?.label ?? value}</span>
      <span className="toolbar-select-caret" aria-hidden="true">
        ▾
      </span>
    </button>
  )

  const menu =
    open && buttonRef.current ? (
      <MenuPopover
        anchor={buttonRef.current}
        align="left"
        items={options.map((item) => ({
          id: item.value,
          label: item.label,
          active: item.value === value,
          onClick: () => onChange(item.value)
        }))}
        onClose={() => setOpen(false)}
      />
    ) : null

  if (!addon) {
    return (
      <>
        {trigger}
        {menu}
      </>
    )
  }

  return (
    <div className={open ? 'sort-split is-open' : 'sort-split'}>
      {trigger}
      {addon}
      {menu}
    </div>
  )
}
