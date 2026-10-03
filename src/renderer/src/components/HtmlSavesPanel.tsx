import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX } from 'react'
import { confirm } from './ConfirmDialog'
import { notifyCaught } from './ErrorNotifications'
import type { GameLibraryFile, HtmlGameInfo } from '@shared/types'
import { compareLibraryFilesByVersion } from '@shared/updates'
import { formatBytes } from '../lib/downloads'
import { HTML_CLOUD_FOLDER, filesForSaveFolder, useCloudSavesForThread } from '../lib/cloud-saves'
import { usePlaySessions } from '../lib/library'
import GameCloudSaves, { GameCloudSaveActions } from './GameCloudSaves'
import SavesDeleteSelectedFab from './SavesDeleteSelectedFab'
import SavesPanelTabs, { SavesActionButton, type SavesPanelView } from './SavesPanelTabs'
import { InlineLoading } from './Spinner'

type HtmlSavesPanelProps = {
  files: GameLibraryFile[]
  threadId: number
  title?: string
}

export default function HtmlSavesPanel({
  files,
  threadId,
  title = ''
}: HtmlSavesPanelProps): JSX.Element {
  const installed = useMemo(
    () =>
      [...files.filter((file) => file.isInstalled)].sort(
        (a, b) => -compareLibraryFilesByVersion(a, b)
      ),
    [files]
  )
  const [fileId, setFileId] = useState(installed[0]?.id || files[0]?.id || '')
  const [info, setInfo] = useState<HtmlGameInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [view, setView] = useState<SavesPanelView>('saves')
  const [localBusy, setLocalBusy] = useState<'refresh' | 'delete' | null>(null)
  const [fabHost, setFabHost] = useState<Element | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const sessions = usePlaySessions()
  const selectedFile = installed.find((file) => file.id === fileId) || installed[0] || files[0] || null
  const activeId = selectedFile?.id || ''
  const playing = sessions.some((session) => session.fileId === activeId || session.threadId === threadId)

  useLayoutEffect(() => {
    setFabHost(panelRef.current?.closest('.details-modal-card') ?? null)
  }, [])

  useEffect(() => {
    if (selectedFile?.id && selectedFile.id !== fileId) setFileId(selectedFile.id)
  }, [selectedFile?.id, fileId])

  async function load(whichAction: 'refresh' | 'delete' | null = 'refresh'): Promise<void> {
    if (whichAction) setLocalBusy(whichAction)
    setBusy(true)
    try {
      const next = await window.api.htmlgame.info(activeId, threadId, title)
      setInfo(next)
      setSelected((current) => {
        const valid = new Set(next.keys.map((item) => item.key))
        const kept = [...current].filter((key) => valid.has(key))
        return kept.length === current.size ? current : new Set(kept)
      })
    } catch (err) {
      notifyCaught(err, 'Could not read HTML game saves.')
    } finally {
      setBusy(false)
      setLocalBusy(null)
    }
  }

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    void window.api.htmlgame
      .info(activeId, threadId, title)
      .then((next) => {
        if (cancelled) return
        setInfo(next)
        setSelected((current) => {
          const valid = new Set(next.keys.map((item) => item.key))
          const kept = [...current].filter((key) => valid.has(key))
          return kept.length === current.size ? current : new Set(kept)
        })
      })
      .catch((err) => {
        if (!cancelled) notifyCaught(err, 'Could not read HTML game saves.')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeId, threadId, title, playing])

  function toggleKey(key: string): void {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  async function deleteSelected(): Promise<void> {
    const keys = [...selected]
    if (!keys.length) return
    const noun = keys.length === 1 ? 'save key' : 'save keys'
    if (
      !(await confirm({
        title: 'Delete saves',
        message: `Delete ${keys.length} ${noun} from the browser backup?`,
        confirmLabel: 'Delete',
        danger: true
      }))
    ) {
      return
    }
    setBusy(true)
    try {
      const next = await window.api.htmlgame.deleteKeys(activeId, threadId, keys, title)
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
        message: `Delete all browser localStorage backups for ${title || 'this game'}? This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true
      }))
    ) {
      return
    }
    setLocalBusy('delete')
    setBusy(true)
    try {
      await window.api.library.clearSaves(threadId)
      const next = await window.api.htmlgame.info(activeId, threadId, title)
      setInfo(next)
      setSelected(new Set())
    } catch (err) {
      notifyCaught(err, 'Could not delete those saves.')
    } finally {
      setBusy(false)
      setLocalBusy(null)
    }
  }

  function openFolder(): void {
    void window.api.htmlgame.openSaves(threadId, title).catch((err) => {
      notifyCaught(err, 'Could not open the save folder.')
    })
  }

  const keys = info?.keys ?? []
  const localNames = useMemo(() => new Set(['localStorage.json']), [])
  const cloud = useCloudSavesForThread(threadId)
  const cloudEnabled = cloud.enabled
  const locationCloudNames = useMemo(
    () => new Set(filesForSaveFolder(cloud.files, HTML_CLOUD_FOLDER, threadId).map((file) => file.name)),
    [cloud.files, threadId]
  )
  const synced = cloudEnabled && (cloud.syncedNames.has('localStorage.json') || locationCloudNames.has('localStorage.json'))

  useEffect(() => {
    if (!cloudEnabled && view === 'cloud') setView('saves')
  }, [cloudEnabled, view])

  const canDeleteAll = Boolean(keys.length || info?.backupPathExists)

  return (
    <div className="renpy-panel" ref={panelRef}>
      {info?.message && view === 'saves' ? <p className="muted">{info.message}</p> : null}

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

      <SavesPanelTabs
        view={view}
        onViewChange={setView}
        cloudEnabled={cloudEnabled}
        localActions={
          <>
            <SavesActionButton
              label="Refresh"
              busyLabel="Refreshing"
              title="Reload browser save backup"
              busy={localBusy === 'refresh'}
              disabled={busy}
              onClick={() => void load('refresh')}
            />
            {canDeleteAll || localBusy === 'delete' ? (
              <SavesActionButton
                label="Delete"
                busyLabel="Deleting"
                title="Delete all localStorage backups for this game"
                danger
                busy={localBusy === 'delete'}
                disabled={busy}
                onClick={() => void deleteAllSaves()}
              />
            ) : null}
          </>
        }
        cloudActions={
          cloudEnabled && cloud.signedIn ? (
            <GameCloudSaveActions threadId={threadId} cloud={cloud} disabled={busy} />
          ) : null
        }
      />

      {view === 'saves' ? (
        <section className="renpy-section">
          {busy && !info ? (
            <InlineLoading label="Reading browser saves" />
          ) : keys.length ? (
            <div className="rpg-save-list">
              {keys.map((item) => {
                const checked = selected.has(item.key)
                return (
                  <label key={item.key} className={checked ? 'rpg-save-row is-selected' : 'rpg-save-row'}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={busy}
                      onChange={() => toggleKey(item.key)}
                    />
                    <span className="rpg-save-main">
                      <strong>{item.key}</strong>
                      <span className="muted">
                        {formatBytes(item.size)}
                        {item.preview ? ` · ${item.preview}` : ''}
                      </span>
                    </span>
                    {synced ? (
                      <span className="save-cloud-badge" title="Also in Google Drive">
                        Cloud
                      </span>
                    ) : null}
                  </label>
                )
              })}
            </div>
          ) : (
            <p className="muted">No localStorage keys found.</p>
          )}
        </section>
      ) : null}

      {view === 'cloud' ? (
        <GameCloudSaves
          threadId={threadId}
          localNames={localNames}
          folderKey={HTML_CLOUD_FOLDER}
          cloud={cloud}
        />
      ) : null}

      {view === 'settings' ? (
        <section className="renpy-section">
          <div className="saves-controls">
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
                {info?.backupPathExists ? (
                  <span className="muted saves-location-meta">{formatBytes(info.saveFolderBytes)}</span>
                ) : null}
                <button
                  className="ghost-btn saves-toolbar-btn"
                  type="button"
                  disabled={busy || !info?.backupPath}
                  onClick={openFolder}
                >
                  Open
                </button>
              </div>
            </div>
            {info?.entryPath ? (
              <div className="folder-field saves-location-field">
                <span className="filter-label">HTML file</span>
                <div className="folder-path-row">
                  <input className="folder-path" readOnly value={info.entryPath} title={info.entryPath} />
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <SavesDeleteSelectedFab
        count={selected.size}
        disabled={busy}
        host={fabHost}
        onDelete={() => void deleteSelected()}
      />
    </div>
  )
}
