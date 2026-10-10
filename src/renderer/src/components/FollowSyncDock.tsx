import { useLayoutEffect, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { FollowSyncStatus } from '@shared/types'
import { followSyncLabel, followSyncProgress } from '@shared/follow-sync'
import { FOOTER_DOCK_ID } from './FooterPortal'
import { RefreshIcon } from './ToolbarIcons'

type FollowSyncDockProps = {
  sync: FollowSyncStatus | null
  onOpenUpdates: () => void
}

export default function FollowSyncDock({
  sync,
  onOpenUpdates
}: FollowSyncDockProps): JSX.Element | null {
  const [footerDock, setFooterDock] = useState<HTMLElement | null>(() =>
    document.getElementById(FOOTER_DOCK_ID)
  )

  useLayoutEffect(() => {
    setFooterDock(document.getElementById(FOOTER_DOCK_ID))
  }, [])

  if (!sync?.running) return null

  const progress = followSyncProgress(sync)
  const label = followSyncLabel(sync)
  const percent = Math.round(progress * 100)
  const ringStyle = {
    background: `conic-gradient(var(--accent) ${percent}%, rgba(255, 255, 255, 0.16) 0)`
  }

  const tile = (
    <button
      className="follow-sync-dock"
      type="button"
      title={label}
      aria-label={label}
      onClick={onOpenUpdates}
    >
      <span
        className="follow-sync-dock-ring"
        style={ringStyle}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="follow-sync-dock-ring-inner">
          <RefreshIcon spinning />
        </span>
      </span>
      <span className="follow-sync-dock-label">{label}</span>
    </button>
  )

  return footerDock ? createPortal(tile, footerDock) : tile
}
