import { useRef, useState, type JSX } from 'react'
import type { GameLibraryFile } from '@shared/types'
import { MenuPopover, type MenuItem } from './MenuPopover'

type UncensorInstallButtonProps = {
  targets: GameLibraryFile[]
  disabled?: boolean
  installingLabel?: string | null
  onInstall: (targetFileId: string) => void
}

export default function UncensorInstallButton({
  targets,
  disabled = false,
  installingLabel = null,
  onInstall
}: UncensorInstallButtonProps): JSX.Element | null {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  if (!targets.length && !installingLabel) return null

  if (installingLabel) {
    return (
      <button className="primary-btn" type="button" disabled>
        {installingLabel}
      </button>
    )
  }

  if (targets.length === 1) {
    return (
      <button
        className="primary-btn"
        type="button"
        disabled={disabled}
        onClick={() => onInstall(targets[0].id)}
      >
        Install
      </button>
    )
  }

  const items: MenuItem[] = targets.map((target) => {
    const version =
      target.packageTags?.version?.trim() || target.version?.trim() || 'Unknown'
    return {
      id: target.id,
      label: `Version ${version}`,
      onClick: () => onInstall(target.id)
    }
  })

  return (
    <>
      <button
        ref={buttonRef}
        className="primary-btn"
        type="button"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Install ▾
      </button>
      {open && buttonRef.current ? (
        <MenuPopover
          anchor={buttonRef.current}
          items={items}
          onClose={() => setOpen(false)}
          header="Install onto"
        />
      ) : null}
    </>
  )
}
