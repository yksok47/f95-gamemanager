import { useLayoutEffect, useState, type JSX, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const SLOT_ID = 'app-footer-slot'
export const FOOTER_DOCK_ID = 'app-footer-dock'

export function FooterSlot(): JSX.Element {
  return <div id={SLOT_ID} className="app-footer-tools" />
}

export function FooterDockSlot(): JSX.Element {
  return <div id={FOOTER_DOCK_ID} className="app-footer-dock" />
}

export default function FooterPortal({ children }: { children: ReactNode }): JSX.Element | null {
  const [slot, setSlot] = useState<HTMLElement | null>(() => document.getElementById(SLOT_ID))

  useLayoutEffect(() => {
    setSlot(document.getElementById(SLOT_ID))
  }, [])

  if (!slot) return null
  return createPortal(children, slot)
}
