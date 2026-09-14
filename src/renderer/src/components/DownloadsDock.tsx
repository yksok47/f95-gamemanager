import { useEffect, useRef, useState, type JSX } from 'react'
import type { DownloadRecord } from '@shared/types'
import type { P2pTransferProgress } from '@shared/p2p'
import { downloadPercent, isActiveDownload, isActiveP2pDownload } from '../lib/downloads'
import DownloadRow from './DownloadRow'
import P2pTransferRow from './P2pTransferRow'

type DownloadsDockProps = {
  items: DownloadRecord[]
  p2pTransfers?: P2pTransferProgress[]
  p2pSharedHashes?: ReadonlySet<string>
  onOpenPage: () => void
  onCancel: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRemove: (id: string) => void
  onShowInFolder: (id: string) => void
  onOpenFile: (id: string) => void
  onPauseP2p?: (id: string) => void
  onResumeP2p?: (id: string) => void
  onStopP2p?: (id: string) => void
}

function activeKeys(regular: DownloadRecord[], p2p: P2pTransferProgress[]): string[] {
  return [
    ...regular.map((item) => `dl:${item.id}`),
    ...p2p.map((item) => `p2p:${item.id}`)
  ].sort()
}

function overallPercent(regular: DownloadRecord[], p2p: P2pTransferProgress[]): number | null {
  const percents: number[] = []
  for (const item of regular) {
    const percent = downloadPercent(item)
    if (percent != null) percents.push(percent)
  }
  for (const item of p2p) {
    percents.push(Math.max(0, Math.min(100, Math.round((item.progress || 0) * 100))))
  }
  if (!percents.length) return null
  return Math.round(percents.reduce((sum, value) => sum + value, 0) / percents.length)
}

function DownloadIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.5a.75.75 0 0 1 .75.75v6.19l1.97-1.97a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.53a.75.75 0 0 1 1.06-1.06l1.97 1.97V2.25A.75.75 0 0 1 8 1.5ZM3.5 12.25a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75Z"
      />
    </svg>
  )
}

export default function DownloadsDock({
  items,
  p2pTransfers = [],
  p2pSharedHashes,
  onOpenPage,
  onCancel,
  onPause,
  onResume,
  onRemove,
  onShowInFolder,
  onOpenFile,
  onPauseP2p,
  onResumeP2p,
  onStopP2p
}: DownloadsDockProps): JSX.Element | null {
  const [collapsed, setCollapsed] = useState(false)
  const prevKeysRef = useRef<string[] | null>(null)
  const dockRef = useRef<HTMLElement | null>(null)

  const activeRegular = items.filter(isActiveDownload)
  const activeP2p = p2pTransfers.filter((t) => isActiveP2pDownload(t, p2pSharedHashes))
  const slots = 3
  const p2pShown = activeP2p.slice(0, slots)
  const regularShown = activeRegular.slice(0, Math.max(0, slots - p2pShown.length))
  const activeCount = activeRegular.length + activeP2p.length
  const percent = overallPercent(activeRegular, activeP2p)
  const keys = activeKeys(activeRegular, activeP2p)
  const keysSignature = keys.join('|')
  const hasActive = p2pShown.length > 0 || regularShown.length > 0

  useEffect(() => {
    const next = keysSignature.length ? keysSignature.split('|') : []
    const prev = prevKeysRef.current
    prevKeysRef.current = next
    if (!prev) return

    const prevSet = new Set(prev)
    const nextSet = new Set(next)
    const started = next.some((key) => !prevSet.has(key))
    const finished = prev.some((key) => !nextSet.has(key))
    if (started || finished) setCollapsed(false)
  }, [keysSignature])

  useEffect(() => {
    if (!hasActive || collapsed) return

    function onPointer(event: PointerEvent): void {
      const target = event.target as Node
      if (dockRef.current?.contains(target)) return
      setCollapsed(true)
    }

    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [hasActive, collapsed])

  if (!hasActive) return null

  if (collapsed) {
    const ringStyle =
      percent == null
        ? undefined
        : {
            background: `conic-gradient(var(--accent) ${percent}%, var(--border) 0)`
          }

    return (
      <aside
        ref={dockRef}
        className="downloads-dock downloads-dock-collapsed"
        aria-label="Active downloads"
      >
        <button
          className="downloads-dock-tile"
          type="button"
          title="Show downloads"
          aria-expanded={false}
          aria-label={`${activeCount} download${activeCount === 1 ? '' : 's'} in progress${
            percent == null ? '' : `, ${percent}%`
          }`}
          onClick={() => setCollapsed(false)}
        >
          <span className="downloads-dock-ring" style={ringStyle}>
            <span className="downloads-dock-ring-inner">
              <DownloadIcon />
            </span>
          </span>
          <span className="downloads-dock-count">{activeCount}</span>
          {percent != null ? <span className="downloads-dock-pct">{percent}%</span> : null}
        </button>
      </aside>
    )
  }

  return (
    <aside ref={dockRef} className="downloads-dock" aria-label="Active downloads">
      <div className="downloads-dock-header">
        <strong>Downloads</strong>
        <div className="downloads-dock-header-actions">
          <button className="ghost-btn" type="button" onClick={onOpenPage}>
            View all
          </button>
          <button
            className="ghost-btn icon-btn downloads-dock-collapse-btn"
            type="button"
            title="Collapse"
            aria-label="Collapse downloads"
            aria-expanded={true}
            onClick={() => setCollapsed(true)}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path
                fill="currentColor"
                d="M3.2 5.8 8 10.6l4.8-4.8 1.1 1.1L8 12.8 2.1 6.9z"
              />
            </svg>
          </button>
        </div>
      </div>
      <div className="downloads-dock-list">
        {p2pShown.map((item) => (
          <P2pTransferRow
            key={`p2p-${item.id}`}
            item={item}
            compact
            onPause={(id) => onPauseP2p?.(id)}
            onResume={(id) => onResumeP2p?.(id)}
            onStop={(id) => onStopP2p?.(id)}
            onOpenDownloads={onOpenPage}
          />
        ))}
        {regularShown.map((item) => (
          <DownloadRow
            key={item.id}
            item={item}
            compact
            onCancel={onCancel}
            onPause={onPause}
            onResume={onResume}
            onRemove={onRemove}
            onShowInFolder={onShowInFolder}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>
    </aside>
  )
}
