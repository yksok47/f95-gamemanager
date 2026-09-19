import { type JSX } from 'react'
import type { AppUpdateStatus } from '@shared/app-update'
import { confirm } from './ConfirmDialog'
import { notifyCaught } from './ErrorNotifications'
import { formatBytes } from '../lib/downloads'

type AppUpdatePanelProps = {
  status: AppUpdateStatus
}

function phaseLabel(status: AppUpdateStatus): string {
  if (status.phase === 'checking') return 'Checking GitHub…'
  if (status.phase === 'downloading') return 'Downloading update…'
  if (status.phase === 'preparing') return 'Preparing files…'
  if (status.phase === 'restarting') return 'Restarting…'
  if (status.phase === 'upToDate') return 'You are on the latest version.'
  if (status.phase === 'available') {
    return status.packaged
      ? 'An update is ready to install.'
      : 'A newer packaged build is on GitHub. Dev mode cannot replace itself.'
  }
  if (status.phase === 'error') return status.error || 'Update check failed.'
  return status.packaged ? '' : 'Running from source — install a packaged build to apply updates.'
}

export default function AppUpdatePanel({ status }: AppUpdatePanelProps): JSX.Element {
  const busy =
    status.phase === 'checking' ||
    status.phase === 'downloading' ||
    status.phase === 'preparing' ||
    status.phase === 'restarting'
  const showProgress =
    status.phase === 'downloading' || status.phase === 'preparing' || status.phase === 'restarting'

  async function check(): Promise<void> {
    try {
      await window.api.appUpdate.check()
    } catch (err) {
      notifyCaught(err, 'Could not check for updates.')
    }
  }

  async function install(): Promise<void> {
    if (
      !(await confirm({
        title: 'Install update',
        message: `Download version ${status.latestVersion} and restart F95 Game Manager? The app will close, replace its files, then reopen.`,
        confirmLabel: 'Update and restart'
      }))
    ) {
      return
    }
    try {
      await window.api.appUpdate.downloadAndInstall()
    } catch (err) {
      notifyCaught(err, 'Could not install the update.')
    }
  }

  return (
    <div className="folder-field app-update-panel">
      <span className="filter-label">App version</span>
      <p className="muted download-meta">
        Updates come from GitHub releases. Both the installed app and the portable build replace
        themselves after the current process exits, then delete leftover files from the previous
        version.
      </p>
      <dl className="app-update-versions">
        <div>
          <dt>Current</dt>
          <dd>{status.currentVersion || '—'}</dd>
        </div>
        <div>
          <dt>Available</dt>
          <dd>{status.latestVersion || (status.phase === 'checking' ? 'Checking…' : '—')}</dd>
        </div>
        <div>
          <dt>Install</dt>
          <dd>{status.installLabel}</dd>
        </div>
      </dl>
      {phaseLabel(status) ? <p className="muted download-meta">{phaseLabel(status)}</p> : null}
      {status.error && status.phase === 'error' ? (
        <p className="app-update-error">{status.error}</p>
      ) : null}
      {showProgress ? (
        <div
          className={
            status.bytesTotal > 0 ? 'download-progress' : 'download-progress download-progress-unknown'
          }
        >
          <span style={status.bytesTotal > 0 ? { width: `${Math.max(4, status.percent)}%` } : undefined} />
        </div>
      ) : null}
      {showProgress && status.bytesReceived > 0 ? (
        <p className="muted download-meta">
          {formatBytes(status.bytesReceived)}
          {status.bytesTotal > 0 ? ` / ${formatBytes(status.bytesTotal)}` : ''}
        </p>
      ) : null}
      <div className="folder-path-row">
        <button className="ghost-btn" type="button" disabled={busy} onClick={() => void check()}>
          Check for updates
        </button>
        <button
          className="update-btn"
          type="button"
          disabled={busy || !status.canInstall}
          onClick={() => void install()}
        >
          Update and restart
        </button>
        {status.releaseUrl ? (
          <button
            className="ghost-btn"
            type="button"
            onClick={() => void window.api.shell.open(status.releaseUrl as string)}
          >
            Release notes
          </button>
        ) : null}
      </div>
    </div>
  )
}
