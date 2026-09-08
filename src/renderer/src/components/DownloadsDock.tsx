import type { JSX } from 'react'
import type { DownloadRecord } from '@shared/types'
import { isActiveDownload } from '../lib/downloads'
import DownloadRow from './DownloadRow'

type DownloadsDockProps = {
  items: DownloadRecord[]
  onOpenPage: () => void
  onCancel: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRemove: (id: string) => void
  onShowInFolder: (id: string) => void
  onOpenFile: (id: string) => void
}

export default function DownloadsDock({
  items,
  onOpenPage,
  onCancel,
  onPause,
  onResume,
  onRemove,
  onShowInFolder,
  onOpenFile
}: DownloadsDockProps): JSX.Element | null {
  const active = items.filter(isActiveDownload).slice(0, 3)
  if (!active.length) return null

  return (
    <aside className="downloads-dock" aria-label="Active downloads">
      <div className="downloads-dock-header">
        <strong>Downloads</strong>
        <button className="ghost-btn" type="button" onClick={onOpenPage}>
          View all
        </button>
      </div>
      <div className="downloads-dock-list">
        {active.map((item) => (
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
