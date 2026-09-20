import { useState, type JSX } from 'react'
import type { CloudSaveRemoteFile } from '@shared/types'
import { formatDateTime } from '@shared/updates'
import { confirm } from './ConfirmDialog'
import { notifyCaught } from './ErrorNotifications'
import { formatBytes } from '../lib/downloads'
import { isPersistentSaveName, useCloudSavesForThread } from '../lib/cloud-saves'
import { SavesActionButton } from './SavesPanelTabs'

type CloudHook = ReturnType<typeof useCloudSavesForThread>

type GameCloudSaveActionsProps = {
  threadId: number
  cloud: CloudHook
  disabled?: boolean
}

export function GameCloudSaveActions({
  threadId,
  cloud,
  disabled = false
}: GameCloudSaveActionsProps): JSX.Element | null {
  const { files, busy, syncing, signedIn, enabled, reload } = cloud
  const [acting, setActing] = useState<'sync' | 'remove' | null>(null)
  if (!threadId || !enabled || !signedIn) return null

  const visible = files.filter((file) => !isPersistentSaveName(file.name))
  const locked = disabled || busy || Boolean(acting)

  async function syncThis(): Promise<void> {
    setActing('sync')
    try {
      await window.api.cloudSaves.syncThread(threadId)
      await reload()
    } catch (err) {
      notifyCaught(err, 'Could not sync this game’s cloud saves.')
    } finally {
      setActing(null)
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
    setActing('remove')
    try {
      await window.api.cloudSaves.deleteGame(threadId)
      await reload()
    } catch (err) {
      notifyCaught(err, 'Could not remove those cloud saves.')
    } finally {
      setActing(null)
    }
  }

  return (
    <>
      <SavesActionButton
        label="Sync"
        busyLabel="Syncing"
        title={syncing ? 'Stop syncing this game' : 'Upload and download saves for this game'}
        busy={syncing || acting === 'sync'}
        disabled={locked && !syncing}
        onClick={() => void (syncing ? stopSync() : syncThis())}
      />
      {visible.length || acting === 'remove' ? (
        <SavesActionButton
          label="Remove"
          busyLabel="Removing"
          title="Delete every cloud save for this game from Google Drive. Local files stay on disk."
          danger
          busy={acting === 'remove'}
          disabled={locked || syncing}
          onClick={() => void removeCloud()}
        />
      ) : null}
    </>
  )
}

type GameCloudSavesProps = {
  threadId: number
  localNames: Set<string>
  folderKey?: string
  cloud: CloudHook
}

export default function GameCloudSaves({
  threadId,
  localNames,
  folderKey = '',
  cloud
}: GameCloudSavesProps): JSX.Element | null {
  const { files, busy, signedIn, enabled } = cloud
  if (!threadId || !enabled) return null

  if (!signedIn) {
    return (
      <p className="muted">
        Sign in with Google in Settings to store this game’s saves in Drive.
      </p>
    )
  }

  const visible = files.filter((file) => !isPersistentSaveName(file.name))
  const cloudOnly = visible.filter((file) => {
    const inThisFolder = !folderKey || !file.folderKey || file.folderKey === folderKey
    return !file.presentLocally && !(inThisFolder && localNames.has(file.name))
  })

  if (busy && !visible.length) {
    return <p className="muted">Checking Google Drive…</p>
  }
  if (!visible.length) {
    return <p className="muted">No saves for this game in Google Drive yet.</p>
  }

  return (
    <section className="cloud-game-saves">
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
