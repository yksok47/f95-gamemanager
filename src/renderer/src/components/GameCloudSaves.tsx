import { useState, type JSX } from 'react'
import type { CloudSaveRemoteFile } from '@shared/types'
import { formatDateTime } from '@shared/updates'
import { confirm } from './ConfirmDialog'
import { notifyCaught } from './ErrorNotifications'
import { formatBytes } from '../lib/downloads'
import { useCloudSavesForThread } from '../lib/cloud-saves'

type GameCloudSavesProps = {
  threadId: number
  localNames: Set<string>
  folderKey?: string
  disabled?: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  cloud: ReturnType<typeof useCloudSavesForThread>
}

export default function GameCloudSaves({
  threadId,
  localNames,
  folderKey = '',
  disabled = false,
  open,
  onOpenChange,
  cloud
}: GameCloudSavesProps): JSX.Element | null {
  const { files, busy, syncing, signedIn, reload } = cloud
  const [acting, setActing] = useState(false)
  if (!threadId || !signedIn) return null

  const visible = files.filter((file) => !file.name.toLowerCase().startsWith('persistent'))
  const cloudOnly = visible.filter((file) => {
    const inThisFolder = !folderKey || !file.folderKey || file.folderKey === folderKey
    return !file.presentLocally && !(inThisFolder && localNames.has(file.name))
  })
  const busyNow = disabled || busy || syncing || acting

  async function syncThis(): Promise<void> {
    setActing(true)
    try {
      await window.api.cloudSaves.syncThread(threadId)
      await reload()
    } catch (err) {
      notifyCaught(err, 'Could not sync this game’s cloud saves.')
    } finally {
      setActing(false)
    }
  }

  async function stopSync(): Promise<void> {
    try {
      await window.api.cloudSaves.cancel()
    } catch (err) {
      notifyCaught(err, 'Could not stop cloud sync.')
    }
  }

  async function removeCloud(): Promise<void> {
    if (
      !(await confirm({
        title: 'Remove cloud saves',
        message: 'Delete every cloud save for this game from Google Drive? Local files stay on disk.',
        confirmLabel: 'Remove from cloud',
        danger: true
      }))
    ) {
      return
    }
    setActing(true)
    try {
      await window.api.cloudSaves.deleteGame(threadId)
      await reload()
    } catch (err) {
      notifyCaught(err, 'Could not remove those cloud saves.')
    } finally {
      setActing(false)
    }
  }

  return (
    <section className="renpy-section cloud-game-saves">
      <div className="renpy-section-head">
        <h2>Cloud</h2>
        <div className="renpy-actions">
          {open && visible.length ? (
            <button
              className="stop-btn saves-toolbar-btn"
              type="button"
              disabled={busyNow}
              onClick={() => void removeCloud()}
            >
              Remove from cloud
            </button>
          ) : null}
          {syncing ? (
            <button
              className="stop-btn saves-toolbar-btn"
              type="button"
              disabled={acting}
              onClick={() => void stopSync()}
            >
              Stop
            </button>
          ) : (
            <button
              className="ghost-btn saves-toolbar-btn"
              type="button"
              disabled={busyNow}
              onClick={() => void syncThis()}
            >
              Sync this game
            </button>
          )}
          <button
            className="ghost-btn saves-toolbar-btn"
            type="button"
            aria-expanded={open}
            onClick={() => onOpenChange(!open)}
          >
            {open ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
      {open ? (
        busy && !visible.length ? (
          <p className="muted">Checking Google Drive…</p>
        ) : visible.length ? (
          <>
            <p className="muted download-meta">
              {visible.length} {visible.length === 1 ? 'save' : 'saves'} in Drive
              {cloudOnly.length ? ` · ${cloudOnly.length} not on this PC` : ''}
            </p>
            <ul className="cloud-save-file-list">
              {visible.map((file) => (
                <CloudSaveRow
                  key={`${file.folderKey}:${file.name}`}
                  file={file}
                  local={
                    file.presentLocally ||
                    ((!file.folderKey || !folderKey || file.folderKey === folderKey) &&
                      localNames.has(file.name))
                  }
                />
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">No saves for this game in Google Drive yet.</p>
        )
      ) : visible.length ? (
        <p className="muted download-meta">
          {visible.length} {visible.length === 1 ? 'save' : 'saves'} in Drive
          {cloudOnly.length ? ` · ${cloudOnly.length} not on this PC` : ''}
        </p>
      ) : null}
    </section>
  )
}

function CloudSaveRow({ file, local }: { file: CloudSaveRemoteFile; local: boolean }): JSX.Element {
  const when = formatDateTime(file.modifiedAt)
  return (
    <li className="cloud-save-file-row">
      <span className="cloud-save-file-main">
        <strong>{file.name}</strong>
        <span className="muted">
          {formatBytes(file.size)}
          {when ? ` · ${when}` : ''}
          {file.folderKey ? ` · ${file.folderKey}` : ''}
        </span>
      </span>
      <span className={local ? 'save-cloud-badge' : 'save-cloud-badge is-only'}>
        {local ? 'In cloud' : 'Cloud only'}
      </span>
    </li>
  )
}
