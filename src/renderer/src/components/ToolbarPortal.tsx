import { useLayoutEffect, useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const SLOT_ID = 'app-toolbar-slot'

export function ToolbarSlot(): JSX.Element {
  return <div id={SLOT_ID} className="top-bar-tools" />
}

export default function ToolbarPortal({ children }: { children: ReactNode }): JSX.Element | null {
  const [slot, setSlot] = useState<HTMLElement | null>(() => document.getElementById(SLOT_ID))

  useLayoutEffect(() => {
    setSlot(document.getElementById(SLOT_ID))
  }, [])

  if (!slot) return null
  return createPortal(children, slot)
}
