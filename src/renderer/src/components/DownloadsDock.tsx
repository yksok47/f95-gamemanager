import { useEffect, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { DownloadRecord } from '@shared/types'
import type { P2pTransferProgress } from '@shared/p2p'
import {
  downloadPercent,
  isActiveDownload,
  isActiveP2pDownload,
  isDockDownload,
  isDockP2pDownload,
  needsReviewDownload
} from '../lib/downloads'
import { FOOTER_DOCK_ID } from './FooterPortal'
import DownloadRow from './DownloadRow'
import P2pTransferRow from './P2pTransferRow'
import { DownloadIcon } from './ToolbarIcons'

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
  ]
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
  const [footerDock, setFooterDock] = useState<HTMLElement | null>(() =>
    document.getElementById(FOOTER_DOCK_ID)
  )
  const prevKeysRef = useRef<string[] | null>(null)
  const dockOrderRef = useRef<string[]>([])
  const tileRef = useRef<HTMLElement | null>(null)
  const popupRef = useRef<HTMLElement | null>(null)

  const activeRegular = items.filter(isActiveDownload)
  const reviewRegular = items.filter(needsReviewDownload)
  const dockRegular = items.filter(isDockDownload)
  const activeP2p = p2pTransfers.filter(
    (t) => isActiveP2pDownload(t, p2pSharedHashes) && t.state !== 'quarantined'
  )
  const dockP2p = p2pTransfers.filter((t) => isDockP2pDownload(t, p2pSharedHashes))
  const slots = 3
  const dockRows = (() => {
    const incoming: Array<
      | { key: string; kind: 'p2p'; item: P2pTransferProgress }
      | { key: string; kind: 'http'; item: DownloadRecord }
    > = [
      ...dockP2p.map((item) => ({ key: `p2p:${item.id}`, kind: 'p2p' as const, item })),
      ...dockRegular.map((item) => ({ key: `dl:${item.id}`, kind: 'http' as const, item }))
    ]
    const byKey = new Map(incoming.map((row) => [row.key, row]))
    const kept = dockOrderRef.current.filter((key) => byKey.has(key))
    const added = incoming.map((row) => row.key).filter((key) => !kept.includes(key))
    const keys = [...kept, ...added]
    dockOrderRef.current = keys
    return keys
      .slice(0, slots)
      .map((key) => byKey.get(key))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
  })()
  const activeCount = activeRegular.length + activeP2p.length
  const reviewCount =
    reviewRegular.length + dockP2p.filter((t) => t.state === 'quarantined').length
  const badgeCount = dockRegular.length + dockP2p.length
  const percent = overallPercent(activeRegular, activeP2p)
  const keys = activeKeys(dockRegular, dockP2p)
  const keysSignature = keys.join('|')
  const hasVisible = dockRows.length > 0

  useEffect(() => {
    setFooterDock(document.getElementById(FOOTER_DOCK_ID))
  }, [])

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
    if (!hasVisible || collapsed) return

    function onPointer(event: PointerEvent): void {
      const target = event.target as Node
      if (popupRef.current?.contains(target)) return
      if (tileRef.current?.contains(target)) return
      setCollapsed(true)
    }

    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [hasVisible, collapsed])

  if (!hasVisible) return null

  const ringStyle =
    percent == null
      ? undefined
      : {
          background: `conic-gradient(var(--accent) ${percent}%, var(--border) 0)`
        }

  const reviewOnly = activeCount === 0 && reviewCount > 0
  const ariaLabel = collapsed
    ? reviewOnly
      ? `${reviewCount} download${reviewCount === 1 ? '' : 's'} need review`
      : `${activeCount} download${activeCount === 1 ? '' : 's'} in progress${
          percent == null ? '' : `, ${percent}%`
        }${reviewCount > 0 ? `, ${reviewCount} need review` : ''}`
    : 'Hide downloads'

  const tile = (
    <aside
      ref={tileRef}
      className="downloads-dock downloads-dock-collapsed"
      aria-label="Downloads"
    >
      <button
        className={
          collapsed ? 'downloads-dock-tile' : 'downloads-dock-tile downloads-dock-tile-open'
        }
        type="button"
        title={collapsed ? 'Show downloads' : 'Hide downloads'}
        aria-expanded={!collapsed}
        aria-label={ariaLabel}
        onClick={() => setCollapsed((value) => !value)}
      >
        <span className="downloads-dock-ring" style={ringStyle}>
          <span className="downloads-dock-ring-inner">
            <DownloadIcon />
          </span>
        </span>
        <span className="downloads-dock-count">{badgeCount}</span>
        {percent != null ? <span className="downloads-dock-pct">{percent}%</span> : null}
        {percent == null && reviewCount > 0 ? (
          <span className="downloads-dock-pct">Review</span>
        ) : null}
      </button>
    </aside>
  )

  const popup = collapsed ? null : (
    <aside ref={popupRef} className="downloads-dock" aria-label="Downloads">
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
        {dockRows.map((row) =>
          row.kind === 'p2p' ? (
            <P2pTransferRow
              key={`p2p-${row.item.id}`}
              item={row.item}
              compact
              onPause={(id) => onPauseP2p?.(id)}
              onResume={(id) => onResumeP2p?.(id)}
              onStop={(id) => onStopP2p?.(id)}
              onOpenDownloads={onOpenPage}
            />
          ) : (
            <DownloadRow
              key={row.item.id}
              item={row.item}
              compact
              onCancel={onCancel}
              onPause={onPause}
              onResume={onResume}
              onRemove={onRemove}
              onShowInFolder={onShowInFolder}
              onOpenFile={onOpenFile}
              onOpenDownloads={onOpenPage}
            />
          )
        )}
      </div>
    </aside>
  )

  return (
    <>
      {footerDock ? createPortal(tile, footerDock) : tile}
      {popup}
    </>
  )
}
