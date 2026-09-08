import type { JSX } from 'react'
import type { DownloadRecord } from '@shared/types'
import DownloadRow from '../components/DownloadRow'

type DownloadsPageProps = {
  items: DownloadRecord[]
  onCancel: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRemove: (id: string) => void
  onShowInFolder: (id: string) => void
  onOpenFile: (id: string) => void
  onClearFinished: () => void
  onOpenFolder: () => void
}

export default function DownloadsPage({
  items,
  onCancel,
  onPause,
  onResume,
  onRemove,
  onShowInFolder,
  onOpenFile,
  onClearFinished,
  onOpenFolder
}: DownloadsPageProps): JSX.Element {
  const finished = items.some((item) => item.status === 'completed' || item.status === 'cancelled')

  return (
    <div className="settings-page">
      <section className="settings-card">
        <div className="downloads-page-header">
          <div>
            <h1>Downloads</h1>
            <p className="muted settings-lead">
              Files save to your downloads folder. Pause, resume, or cancel them here.
            </p>
          </div>
          <div className="downloads-page-actions">
            <button className="ghost-btn" type="button" onClick={onOpenFolder}>
              Open folder
            </button>
            <button className="ghost-btn" type="button" disabled={!finished} onClick={onClearFinished}>
              Clear finished
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <p className="muted">No downloads yet. Use a download link from a game page.</p>
        ) : (
          <div className="downloads-page-list">
            {items.map((item) => (
              <DownloadRow
                key={item.id}
                item={item}
                onCancel={onCancel}
                onPause={onPause}
                onResume={onResume}
                onRemove={onRemove}
                onShowInFolder={onShowInFolder}
                onOpenFile={onOpenFile}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
