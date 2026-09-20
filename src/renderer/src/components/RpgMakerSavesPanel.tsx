import { useEffect, useMemo, useState, type JSX } from 'react'
import { confirm } from './ConfirmDialog'
import { notifyCaught } from './ErrorNotifications'
import type { GameLibraryFile, RpgMakerInfo, RpgMakerSaveFile } from '@shared/types'
import { formatDateTime } from '@shared/updates'
import { formatBytes } from '../lib/downloads'
import { RPG_CLOUD_FOLDER, filesForSaveFolder, useCloudSavesForThread } from '../lib/cloud-saves'
import { usePlaySessions } from '../lib/library'
import GameCloudSaves from './GameCloudSaves'

type RpgMakerSavesPanelProps = {
  files: GameLibraryFile[]
  threadId: number
  title?: string
}

function saveTitle(save: RpgMakerSaveFile): string {
  return save.label === save.name ? save.name : `${save.label} · ${save.name}`
}

export default function RpgMakerSavesPanel({
  files,
  threadId,
  title = ''
}: RpgMakerSavesPanelProps): JSX.Element {
  const installed = useMemo(() => files.filter((file) => file.isInstalled), [files])
  const [fileId, setFileId] = useState(installed[0]?.id || files[0]?.id || '')
  const [info, setInfo] = useState<RpgMakerInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cloudOpen, setCloudOpen] = useState(false)
  const sessions = usePlaySessions()
  const selectedFile = installed.find((file) => file.id === fileId) || installed[0] || files[0] || null
  const activeId = selectedFile?.id || ''
  const playing = sessions.some((session) => session.fileId === activeId || session.threadId === threadId)

  useEffect(() => {
    if (selectedFile?.id && selectedFile.id !== fileId) setFileId(selectedFile.id)
  }, [selectedFile?.id, fileId])

  async function load(): Promise<void> {
    setBusy(true)
    try {
      const next = await window.api.rpgmaker.info(activeId, threadId, title)
      setInfo(next)
      setSelected((current) => {
        const valid = new Set(next.saves.map((save) => save.path))
        const kept = [...current].filter((path) => valid.has(path))
        return kept.length === current.size ? current : new Set(kept)
      })
    } catch (err) {
      notifyCaught(err, 'Could not read RPG Maker saves.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    void window.api.rpgmaker
      .info(activeId, threadId, title)
      .then((next) => {
        if (cancelled) return
        setInfo(next)
        setSelected((current) => {
          const valid = new Set(next.saves.map((save) => save.path))
          const kept = [...current].filter((path) => valid.has(path))
          return kept.length === current.size ? current : new Set(kept)
        })
      })
      .catch((err) => {
        if (!cancelled) notifyCaught(err, 'Could not read RPG Maker saves.')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeId, threadId, title, playing])

  function togglePath(path: string): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function deleteSelected(): Promise<void> {
    const paths = [...selected]
    if (!paths.length) return
    const noun = paths.length === 1 ? 'save' : 'saves'
    if (!(await confirm({ title: 'Delete saves', message: `Delete ${paths.length} ${noun} from the game folder and the backup folder?`, confirmLabel: 'Delete', danger: true }))) return
    setBusy(true)
    try {
      const next = await window.api.rpgmaker.deleteSaves(activeId, threadId, paths, title)
      setInfo(next)
      setSelected(new Set())
    } catch (err) {
      notifyCaught(err, 'Could not delete those saves.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteAllSaves(): Promise<void> {
    if (
      !(await confirm({
        title: 'Delete saves',
        message: `Delete all saves and save folders for ${title || 'this game'}? Empty folders are removed too. This cannot be undone.`,
        confirmLabel: 'Delete saves',
        danger: true
      }))
    ) {
      return
    }
    setBusy(true)
    try {
      await window.api.library.clearSaves(threadId)
      const next = await window.api.rpgmaker.info(activeId, threadId, title)
      setInfo(next)
      setSelected(new Set())
    } catch (err) {
      notifyCaught(err, 'Could not delete those saves.')
    } finally {
      setBusy(false)
    }
  }

  function openFolder(which?: 'game' | 'backup'): void {
    void window.api.rpgmaker.openSaves(activeId, threadId, title, which).catch((err) => {
      notifyCaught(err, 'Could not open the save folder.')
    })
  }

  const saves = info?.saves ?? []
  const localNames = useMemo(() => new Set(saves.map((save) => save.name)), [saves])
  const cloud = useCloudSavesForThread(threadId)
  const locationCloudNames = useMemo(
    () => new Set(filesForSaveFolder(cloud.files, RPG_CLOUD_FOLDER, threadId).map((file) => file.name)),
    [cloud.files, threadId]
  )
  const syncedCloudNames = useMemo(() => {
    const names = new Set<string>()
    for (const name of cloud.syncedNames) names.add(name)
    for (const name of locationCloudNames) names.add(name)
    return names
  }, [cloud.syncedNames, locationCloudNames])

  return (
    <div className="renpy-panel">
      {info?.message ? <p className="muted">{info.message}</p> : null}
      {playing ? (
        <p className="muted">Game is running. New saves are copied to the backup folder while you play, then synced when it exits.</p>
      ) : null}

      <section className="renpy-section">
        <div className="renpy-section-head">
          <h2>Saves</h2>
          <div className="renpy-actions">
            {selected.size > 0 ? (
              <button
                className="stop-btn saves-toolbar-btn"
                type="button"
                disabled={busy}
                onClick={() => void deleteSelected()}
              >
                Delete {selected.size}
              </button>
            ) : saves.length || info?.backupPathExists || info?.gameSavePathExists ? (
              <button
                className="stop-btn saves-toolbar-btn"
                type="button"
                disabled={busy}
                title="Delete all saves and save folders, even if they have no save files"
                onClick={() => void deleteAllSaves()}
              >
                Delete saves
              </button>
            ) : null}
            <button className="ghost-btn saves-toolbar-btn" type="button" disabled={busy} onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>

        {installed.length > 1 ? (
          <label className="renpy-version">
            <span className="muted">Version</span>
            <select className="toolbar-select" value={activeId} onChange={(event) => setFileId(event.target.value)}>
              {installed.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.version || 'Unknown'} · {file.filename}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="saves-controls">
          <div className="folder-field saves-location-field">
            <span className="filter-label">Game folder</span>
            <div className="folder-path-row">
              <input
                className="folder-path"
                readOnly
                value={info?.gameSavePath ?? ''}
                placeholder={
                  busy && !info
                    ? 'Reading…'
                    : 'Not installed — saves still live in the backup folder'
                }
                title={info?.gameSavePath || undefined}
              />
              {info?.gameSavePath && !info.gameSavePathExists ? (
                <span className="muted saves-location-meta">Not created yet</span>
              ) : null}
              <button
                className="ghost-btn saves-toolbar-btn"
                type="button"
                disabled={busy || !info?.gameSavePathExists}
                onClick={() => openFolder('game')}
              >
                Open
              </button>
            </div>
          </div>

          <div className="folder-field saves-location-field">
            <span className="filter-label">Backup folder</span>
            <div className="folder-path-row">
              <input
                className="folder-path"
                readOnly
                value={info?.backupPath ?? ''}
                placeholder={busy && !info ? 'Reading…' : 'No backup folder yet'}
                title={info?.backupPath || undefined}
              />
              {info?.backupPath && info.backupPathExists ? (
                <span className="muted saves-location-meta">{formatBytes(info.saveFolderBytes)}</span>
              ) : null}
              <button
                className="ghost-btn saves-toolbar-btn"
                type="button"
                disabled={busy || !info?.backupPathExists}
                onClick={() => openFolder('backup')}
              >
                Open
              </button>
            </div>
          </div>
        </div>

        {busy && !info ? (
          <p className="muted">Syncing save folders…</p>
        ) : saves.length ? (
          <div className="rpg-save-list">
            {saves.map((save) => {
              const checked = selected.has(save.path)
              const when = formatDateTime(save.modifiedAt)
              return (
                <label key={save.path} className={checked ? 'rpg-save-row is-selected' : 'rpg-save-row'}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={() => togglePath(save.path)}
                  />
                  <span className="rpg-save-main">
                    <strong>{saveTitle(save)}</strong>
                    <span className="muted">
                      {formatBytes(save.size)}
                      {when ? ` · ${when}` : ''}
                    </span>
                  </span>
                  {syncedCloudNames.has(save.name) ? (
                    <span className="save-cloud-badge" title="Also in Google Drive">
                      Cloud
                    </span>
                  ) : null}
                  <button
                    className="ghost-btn"
                    type="button"
                    disabled={busy}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void window.api.rpgmaker.showSave(activeId, threadId, save.path, title).catch((err) => {
                        notifyCaught(err, 'Could not show that save.')
                      })
                    }}
                  >
                    Show
                  </button>
                </label>
              )
            })}
          </div>
        ) : (
          <p className="muted">{busy ? 'Syncing save folders…' : 'No save files found.'}</p>
        )}
      </section>
      <GameCloudSaves
        threadId={threadId}
        localNames={localNames}
        folderKey={RPG_CLOUD_FOLDER}
        disabled={busy}
        open={cloudOpen}
        onOpenChange={setCloudOpen}
        cloud={cloud}
      />
    </div>
  )
}
