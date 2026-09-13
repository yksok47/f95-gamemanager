import { useState, type JSX } from 'react'
import type { PackageConsensus, PackageInstallTags } from '@shared/p2p'
import type { DownloadRecord, PackageTagHint } from '@shared/types'
import { formatRelativeTime } from '@shared/updates'
import {
  downloadLibraryLabel,
  downloadPercent,
  downloadStatusLabel,
  formatBytes,
  formatEta,
  formatSpeed
} from '../lib/downloads'
import P2pApproveTagsForm from './P2pApproveTagsForm'

type DownloadRowProps = {
  item: DownloadRecord
  compact?: boolean
  onCancel: (id: string) => void
  onPause: (id: string) => void
  onResume: (id: string) => void
  onRemove: (id: string) => void
  onShowInFolder: (id: string) => void
  onOpenFile: (id: string) => void
  onOpenGame?: (threadId: number, title: string) => void
  onApprove?: (id: string, tags: PackageInstallTags) => void
  onReject?: (id: string) => void
}

function hintToConsensus(hint: PackageTagHint | undefined): PackageConsensus | null {
  if (!hint) return null
  if (!Number.isFinite(hint.contentKind)) return null
  const version = hint.version.trim()
  // Allow OS/kind-only hints; empty version still seeds the form fields we know.
  if (!hint.os.length && !version) return null
  return {
    os: [...hint.os].sort((a, b) => a - b),
    contentKind: hint.contentKind,
    version,
    versionId: 0
  }
}

export default function DownloadRow({
  item,
  compact = false,
  onCancel,
  onPause,
  onResume,
  onRemove,
  onShowInFolder,
  onOpenFile,
  onOpenGame,
  onApprove,
  onReject
}: DownloadRowProps): JSX.Element {
  const [approveReady, setApproveReady] = useState(false)
  const percent = downloadPercent(item)
  const speed = item.status === 'progressing' ? formatSpeed(item.bytesPerSecond) : ''
  const eta = formatEta(item)
  const size =
    item.totalBytes > 0
      ? `${formatBytes(item.receivedBytes)} / ${formatBytes(item.totalBytes)}`
      : formatBytes(item.receivedBytes)
  const active = item.status === 'progressing' || item.status === 'paused'
  const canResume = item.canResume && (item.status === 'paused' || item.status === 'interrupted')
  const gameTitle = item.gameTitle?.trim() || (item.gameThreadId != null ? `Thread ${item.gameThreadId}` : '')
  const canOpenGame = Boolean(onOpenGame && item.gameThreadId)
  const needsReview = item.status === 'completed' && item.libraryStatus === 'pendingReview'
  const approveFormId = `dl-approve-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const fallbackConsensus = hintToConsensus(item.packageHint)
  const finishedAt = item.finishedAt ?? item.updatedAt
  const finishedLabel =
    !active && finishedAt
      ? item.status === 'completed'
        ? `Finished ${formatRelativeTime(finishedAt)}`
        : item.status === 'cancelled'
          ? `Cancelled ${formatRelativeTime(finishedAt)}`
          : formatRelativeTime(finishedAt)
      : ''

  return (
    <article
      className={
        compact
          ? `download-row download-row-compact${needsReview ? ' download-row-quarantine' : ''}`
          : `download-row${needsReview ? ' download-row-quarantine' : ''}`
      }
    >
      <div className="download-row-main">
        <div className="download-row-title">
          {canOpenGame ? (
            <button
              className="download-game-link"
              type="button"
              title={`Open ${gameTitle}`}
              onClick={() => onOpenGame?.(item.gameThreadId!, gameTitle)}
            >
              {gameTitle}
            </button>
          ) : (
            <strong title={item.savePath || item.filename}>{item.filename}</strong>
          )}
          <span className={`download-status download-status-${needsReview ? 'paused' : item.status}`}>
            {downloadLibraryLabel(item) || downloadStatusLabel(item.status)}
          </span>
        </div>
        {compact ? null : (
          <p className="muted download-url" title={canOpenGame ? item.filename : item.url}>
            {canOpenGame ? item.filename : item.url}
          </p>
        )}
        {needsReview ? (
          <p className="muted download-meta">
            Review tags before adding this file to your library.
          </p>
        ) : active ? (
          <div
            className={percent == null ? 'download-progress download-progress-unknown' : 'download-progress'}
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
          >
            <span style={percent == null ? undefined : { width: `${percent}%` }} />
          </div>
        ) : null}
        <p className="muted download-meta">
          {active
            ? [size, percent != null ? `${percent}%` : '', speed, eta].filter(Boolean).join(' · ')
            : [formatBytes(item.totalBytes || item.receivedBytes), finishedLabel]
                .filter(Boolean)
                .join(' · ')}
        </p>
      </div>
      <div className="download-row-actions">
        {needsReview ? (
          <>
            {!compact ? (
              <button className="ghost-btn" type="button" onClick={() => onShowInFolder(item.id)}>
                Show in folder
              </button>
            ) : null}
            <button
              className="primary-btn"
              type="submit"
              form={approveFormId}
              disabled={!approveReady || !onApprove}
              title={approveReady ? undefined : 'Set content type, OS, and version first'}
            >
              Approve
            </button>
            <button
              className="ghost-btn"
              type="button"
              onClick={() => onReject?.(item.id)}
              disabled={!onReject}
            >
              Reject
            </button>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>
      {needsReview && onApprove ? (
        <P2pApproveTagsForm
          formId={approveFormId}
          contentHash={item.hash}
          fallbackConsensus={fallbackConsensus}
          onReadyChange={setApproveReady}
          onSubmit={(tags) => onApprove(item.id, tags)}
        />
      ) : null}
    </article>
  )
}
