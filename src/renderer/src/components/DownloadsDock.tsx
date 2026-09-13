import type { JSX } from 'react'
import type { DownloadRecord } from '@shared/types'
import type { P2pTransferProgress } from '@shared/p2p'
import { isActiveDownload, isActiveP2pDownload } from '../lib/downloads'
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
  const activeRegular = items.filter(isActiveDownload)
  const activeP2p = p2pTransfers.filter((t) => isActiveP2pDownload(t, p2pSharedHashes))
  const slots = 3
  const p2pShown = activeP2p.slice(0, slots)
  const regularShown = activeRegular.slice(0, Math.max(0, slots - p2pShown.length))
  if (!p2pShown.length && !regularShown.length) return null

  return (
    <aside className="downloads-dock" aria-label="Active downloads">
      <div className="downloads-dock-header">
        <strong>Downloads</strong>
        <button className="ghost-btn" type="button" onClick={onOpenPage}>
          View all
        </button>
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
