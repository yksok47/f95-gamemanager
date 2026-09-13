import { useRef, useState, type JSX } from 'react'
import type { InstalledPatchRef } from '@shared/types'
import { MenuPopover, type MenuItem } from './MenuPopover'

type UncensorRemoveButtonProps = {
  patches: InstalledPatchRef[]
  disabled?: boolean
  onRemove: (patch: InstalledPatchRef) => void
}

export default function UncensorRemoveButton({
  patches,
  disabled = false,
  onRemove
}: UncensorRemoveButtonProps): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  if (!patches.length) return null

  if (patches.length === 1) {
    return (
      <button
        className="ghost-btn"
        type="button"
        disabled={disabled}
        onClick={() => onRemove(patches[0])}
      >
        Remove uncensor
      </button>
    )
  }

  const items: MenuItem[] = patches.map((patch, index) => ({
    id: patch.uninstallSlot || patch.hash || patch.patchId || String(index),
    label: patch.filename || patch.hash.slice(0, 12) || 'Uncensor patch',
    onClick: () => onRemove(patch)
  }))

  return (
    <>
      <button
        ref={buttonRef}
        className="ghost-btn"
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Remove uncensor ▾
      </button>
      {open && buttonRef.current ? (
        <MenuPopover
          anchor={buttonRef.current}
          items={items}
          onClose={() => setOpen(false)}
          header="Remove from this install"
        />
      ) : null}
    </>
  )
}
