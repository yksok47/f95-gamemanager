import type { JSX } from 'react'
import type { DownloadRecord } from '@shared/types'
import {
  downloadLibraryLabel,
  downloadPercent,
  downloadStatusLabel,
  formatBytes,
  formatEta,
  formatSpeed
} from '../lib/downloads'

type DownloadRowProps = {
  item: DownloadRecord
  compact?: boolean
  onCancel: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRemove: (id: string) => void
  onShowInFolder: (id: string) => void
  onOpenFile: (id: string) => void
}

export default function DownloadRow({
  item,
  compact = false,
  onCancel,
  onPause,
  onResume,
  onRemove,
  onShowInFolder,
  onOpenFile
}: DownloadRowProps): JSX.Element {
  const percent = downloadPercent(item)
  const speed = item.status === 'progressing' ? formatSpeed(item.bytesPerSecond) : ''
  const eta = formatEta(item)
  const size =
    item.totalBytes > 0
      ? `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`
      : formatBytes(item.receivedBytes)
  const active = item.status === 'progressing' || item.status === 'paused'
  const canResume = item.canResume && (item.status === 'paused' || item.status === 'interrupted')

  return (
    <article className={compact ? 'download-row download-row-compact' : 'download-row'}>
      <div className="download-row-main">
        <div className="download-row-title">
          <strong title={item.savePath || item.filename}>{item.filename}</strong>
          <span className={`download-status download-status-${item.status}`}>
            {downloadLibraryLabel(item) || downloadStatusLabel(item.status)}
          </span>
        </div>
        {compact ? null : <p className="muted download-url" title={item.url}>{item.url}</p>}
        <div
          className={percent == null && active ? 'download-progress download-progress-unknown' : 'download-progress'}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <span style={percent == null ? undefined : { width: `${percent}%` }} />
        </div>
        <p className="muted download-meta">
          {[size, percent != null ? `${percent}%` : '', speed, eta].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="download-row-actions">
        {item.status === 'progressing' ? (
          <button className="ghost-btn" type="button" onClick={() => onPause(item.id)}>
            Pause
          </button>
        ) : null}
        {canResume ? (
          <button className="ghost-btn" type="button" onClick={() => onResume(item.id)}>
            Resume
          </button>
        ) : null}
        {active ? (
          <button className="ghost-btn" type="button" onClick={() => onCancel(item.id)}>
            Cancel
          </button>
        ) : null}
        {item.status === 'completed' && !compact ? (
          <>
            <button className="ghost-btn" type="button" onClick={() => onOpenFile(item.id)}>
              Open
            </button>
            <button className="ghost-btn" type="button" onClick={() => onShowInFolder(item.id)}>
              Show in folder
            </button>
          </>
        ) : null}
        {item.status === 'completed' || item.status === 'cancelled' || item.status === 'interrupted' ? (
          <button className="ghost-btn" type="button" onClick={() => onRemove(item.id)}>
            Dismiss
          </button>
        ) : null}
      </div>
    </article>
  )
}
