import { useState, type JSX } from 'react'
import type { PackageInstallTags, PackageVersionWeight, P2pTransferProgress } from '@shared/p2p'
import { formatBytes, formatSpeed } from '../lib/downloads'
import P2pApproveTagsForm from './P2pApproveTagsForm'
import PackageMetaTags from './PackageMetaTags'

type P2pTransferRowProps = {
  item: P2pTransferProgress
  compact?: boolean
  versions?: PackageVersionWeight[]
  onPause: (id: string) => void
  onResume: (id: string) => void
  onStop: (id: string) => void
  onRevealQuarantine?: (id: string) => void
  onApproveQuarantine?: (id: string, tags: PackageInstallTags) => void
  onRejectQuarantine?: (id: string) => void
  onFlagQuarantine?: (id: string) => void
  /** When set with compact, quarantine rows link here instead of showing Approve/Reject. */
  onOpenDownloads?: () => void
  onOpenGame?: (threadId: number, title: string) => void
}

function shortHash(value: string | null | undefined): string {
  if (!value) return ''
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}

function statusLabel(state: P2pTransferProgress['state']): string {
  if (state === 'connecting') return 'Connecting'
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
  compact = false,
  versions,
  onPause,
  onResume,
  onStop,
  onRevealQuarantine,
  onApproveQuarantine,
  onRejectQuarantine,
  onFlagQuarantine,
  onOpenDownloads,
  onOpenGame
}: P2pTransferRowProps): JSX.Element {
  const [approveReady, setApproveReady] = useState(false)
  const percent = Math.max(0, Math.min(100, Math.round((item.progress || 0) * 100)))
  const isQuarantined = item.state === 'quarantined'
  const isChecking = item.state === 'checking'
  const deferReviewToDownloads = Boolean(compact && onOpenDownloads)
  const approveFormId = `p2p-approve-${item.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`
  const canPause =
    item.state === 'connecting' || item.state === 'downloading' || item.state === 'checking'
  const canResume = item.state === 'paused' || item.state === 'error'
  const canStop =
    !isQuarantined &&
    (item.state === 'connecting' ||
      item.state === 'downloading' ||
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
  const titleLabel = compact ? packageLabel : gameLabel
  const canOpenGame = !compact && Boolean(onOpenGame && item.f95ThreadId != null)
  const showApproveForm = isQuarantined && !deferReviewToDownloads
  const transferMeta = isQuarantined
    ? [formatBytes(item.length || item.downloaded), shortHash(item.contentHash)]
        .filter(Boolean)
        .join(' · ')
    : isChecking
      ? [item.length > 0 ? formatBytes(item.length) : formatBytes(item.downloaded), 'preparing to share']
          .filter(Boolean)
          .join(' · ')
      : [
          size,
          down,
          up,
          item.state === 'connecting'
            ? 'finding peers'
            : `${item.numActivePeers ?? 0} active / ${item.numPeers} connected`,
          `${percent}%`
        ].join(' · ')

  return (
    <article
      className={
        compact
          ? `download-row download-row-compact${isQuarantined ? ' download-row-quarantine' : ''}`
          : `download-row${isQuarantined ? ' download-row-quarantine' : ''}`
      }
    >
      <div className="download-row-main">
        <div className="download-row-title">
          {canOpenGame ? (
            <button
              className="download-game-link"
              type="button"
              title={`Open ${gameLabel}`}
              onClick={() => onOpenGame!(item.f95ThreadId!, gameLabel)}
            >
              {gameLabel}
            </button>
          ) : (
            <strong title={titleLabel}>{titleLabel}</strong>
          )}
          <span className={`download-status download-status-${statusClass(item.state)}`}>
            {statusLabel(item.state)}
          </span>
        </div>
        {compact ? null : (
          <p className="muted download-url" title={item.path || packageLabel}>
            {packageLabel}
          </p>
        )}
        {isQuarantined || isChecking ? null : (
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
        {showApproveForm ? null : (
          <p className="muted download-meta">{transferMeta}</p>
        )}
        {isQuarantined || compact ? null : (
          <PackageMetaTags consensus={item.consensus} versionFallback={item.gameVersion} />
        )}
      </div>
      {isQuarantined ? (
        <p className="muted download-quarantine-note">
          Saved to untrusted quarantine — review before opening or installing.
        </p>
      ) : null}
      <div className="download-row-actions">
        {isQuarantined ? (
          deferReviewToDownloads ? (
            <button className="primary-btn" type="button" onClick={onOpenDownloads}>
              Review on Downloads
            </button>
          ) : (
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
                type="submit"
                form={approveFormId}
                disabled={!approveReady}
                title={approveReady ? undefined : 'Set content type, OS, and version first'}
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
          )
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
      {showApproveForm ? (
        <P2pApproveTagsForm
          formId={approveFormId}
          contentHash={item.contentHash}
          consensus={item.consensus}
          versions={versions}
          statsPrefix={transferMeta}
          onReadyChange={setApproveReady}
          onSubmit={(tags) => onApproveQuarantine?.(item.id, tags)}
        />
      ) : null}
    </article>
  )
}
