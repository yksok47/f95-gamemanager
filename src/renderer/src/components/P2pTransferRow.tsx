import type { JSX } from 'react'
import type { P2pTransferProgress } from '@shared/p2p'
import { formatBytes, formatSpeed } from '../lib/downloads'

type P2pTransferRowProps = {
  item: P2pTransferProgress
  onPause: (id: string) => void
  onResume: (id: string) => void
  onStop: (id: string) => void
  onRevealQuarantine?: (id: string) => void
  onApproveQuarantine?: (id: string) => void
  onRejectQuarantine?: (id: string) => void
  onFlagQuarantine?: (id: string) => void
}

function shortHash(value: string | null | undefined): string {
  if (!value) return ''
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}

function statusLabel(state: P2pTransferProgress['state']): string {
  if (state === 'downloading') return 'Downloading'
  if (state === 'seeding') return 'Sharing'
  if (state === 'checking') return 'Checking'
  if (state === 'paused') return 'Paused'
  if (state === 'quarantined') return 'Needs review'
  if (state === 'error') return 'Error'
  return 'Idle'
}

function statusClass(state: P2pTransferProgress['state']): string {
  if (state === 'error') return 'interrupted'
  if (state === 'seeding') return 'completed'
  if (state === 'paused') return 'paused'
  if (state === 'quarantined') return 'paused'
  return 'progressing'
}

export default function P2pTransferRow({
  item,
  onPause,
  onResume,
  onStop,
  onRevealQuarantine,
  onApproveQuarantine,
  onRejectQuarantine,
  onFlagQuarantine
}: P2pTransferRowProps): JSX.Element {
  const percent = Math.max(0, Math.min(100, Math.round((item.progress || 0) * 100)))
  const isQuarantined = item.state === 'quarantined'
  const canPause = item.state === 'downloading' || item.state === 'checking'
  const canResume = item.state === 'paused' || item.state === 'error'
  const canStop =
    !isQuarantined &&
    (item.state === 'downloading' ||
      item.state === 'seeding' ||
      item.state === 'checking' ||
      item.state === 'paused' ||
      item.state === 'error')
  const down = item.downloadSpeed > 0 ? `↓ ${formatSpeed(item.downloadSpeed)}` : '↓ 0 B/s'
  const up = item.uploadSpeed > 0 ? `↑ ${formatSpeed(item.uploadSpeed)}` : '↑ 0 B/s'
  const size =
    item.length > 0
      ? `${formatBytes(item.downloaded)} / ${formatBytes(item.length)}`
      : formatBytes(item.downloaded)
  const gameLabel =
    item.gameName?.trim() ||
    (item.f95ThreadId != null ? `Thread ${item.f95ThreadId}` : 'Unknown game')
  const packageLabel =
    item.normalizedName || shortHash(item.contentHash) || shortHash(item.infoHash) || item.id

  return (
    <article className="download-row">
      <div className="download-row-main">
        <div className="download-row-title">
          <strong title={gameLabel}>{gameLabel}</strong>
          <span className={`download-status download-status-${statusClass(item.state)}`}>
            {statusLabel(item.state)}
          </span>
        </div>
        <p className="muted download-url" title={item.path || packageLabel}>
          {packageLabel}
        </p>
        {isQuarantined ? (
          <p className="muted download-meta">
            Saved to untrusted quarantine — review before opening or installing.
          </p>
        ) : (
          <div
            className="download-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <span style={{ width: `${percent}%` }} />
          </div>
        )}
        <p className="muted download-meta">
          {isQuarantined
            ? [formatBytes(item.length || item.downloaded), shortHash(item.contentHash)]
                .filter(Boolean)
                .join(' · ')
            : [size, down, up, `peers ${item.numPeers}`, `${percent}%`].join(' · ')}
        </p>
      </div>
      <div className="download-row-actions">
        {isQuarantined ? (
          <>
            <button
              className="ghost-btn"
              type="button"
              onClick={() => onRevealQuarantine?.(item.id)}
            >
              View in folder
            </button>
            <button
              className="primary-btn"
              type="button"
              onClick={() => onApproveQuarantine?.(item.id)}
            >
              Approve
            </button>
            <button
              className="ghost-btn"
              type="button"
              onClick={() => onRejectQuarantine?.(item.id)}
            >
              Reject
            </button>
            <button
              className="ghost-btn"
              type="button"
              onClick={() => onFlagQuarantine?.(item.id)}
            >
              Flag malicious
            </button>
          </>
        ) : (
          <>
            {canPause ? (
              <button className="ghost-btn" type="button" onClick={() => onPause(item.id)}>
                Pause
              </button>
            ) : null}
            {canResume ? (
              <button className="ghost-btn" type="button" onClick={() => onResume(item.id)}>
                Resume
              </button>
            ) : null}
            {canStop ? (
              <button className="ghost-btn" type="button" onClick={() => onStop(item.id)}>
                Stop
              </button>
            ) : null}
          </>
        )}
      </div>
    </article>
  )
}
