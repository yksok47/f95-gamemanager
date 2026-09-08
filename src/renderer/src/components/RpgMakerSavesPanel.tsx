import { useEffect, useMemo, useState, type JSX } from 'react'
import type { GameLibraryFile, RpgMakerInfo, RpgMakerSaveFile } from '@shared/types'
import { formatDateTime } from '@shared/updates'
import { formatBytes } from '../lib/downloads'
import { usePlaySessions } from '../lib/library'

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
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const sessions = usePlaySessions()
  const selectedFile = installed.find((file) => file.id === fileId) || installed[0] || files[0] || null
  const activeId = selectedFile?.id || ''
  const playing = sessions.some((session) => session.fileId === activeId || session.threadId === threadId)

  useEffect(() => {
    if (selectedFile?.id && selectedFile.id !== fileId) setFileId(selectedFile.id)
  }, [selectedFile?.id, fileId])

  async function load(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const next = await window.api.rpgmaker.info(activeId, threadId, title)
      setInfo(next)
      setSelected((current) => {
        const valid = new Set(next.saves.map((save) => save.path))
        const kept = [...current].filter((path) => valid.has(path))
        return kept.length === current.size ? current : new Set(kept)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read RPG Maker saves.')
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError(null)
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
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not read RPG Maker saves.')
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
    if (!window.confirm(`Delete ${paths.length} ${noun} from the game folder and AppData backup?`)) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.api.rpgmaker.deleteSaves(activeId, threadId, paths, title)
      setInfo(next)
      setSelected(new Set())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete those saves.')
    } finally {
      setBusy(false)
    }
  }

  function openFolder(which?: 'game' | 'backup'): void {
    void window.api.rpgmaker.openSaves(activeId, threadId, title, which).catch((err) => {
      setError(err instanceof Error ? err.message : 'Could not open the save folder.')
    })
  }

  const saves = info?.saves ?? []

  return (
    <div className="renpy-panel">
      {error ? <p className="error-text">{error}</p> : null}
      {info?.message ? <p className="muted">{info.message}</p> : null}
      {playing ? (
        <p className="muted">Game is running. New saves are copied to AppData while you play, then synced when it exits.</p>
      ) : null}

      <section className="renpy-section">
        <div className="renpy-section-head">
          <h2>Saves</h2>
          <div className="renpy-actions">
            <button
              className="stop-btn"
              type="button"
              disabled={busy || selected.size === 0}
              onClick={() => void deleteSelected()}
            >
              {selected.size ? `Delete selected (${selected.size})` : 'Delete selected'}
            </button>
            <button
              className="ghost-btn"
              type="button"
              disabled={busy || !info?.gameSavePathExists}
              onClick={() => openFolder('game')}
            >
              Open game folder
            </button>
            <button
              className="ghost-btn"
              type="button"
              disabled={busy || !info?.backupPath}
              onClick={() => openFolder('backup')}
            >
              Open AppData backup
            </button>
            <button className="ghost-btn" type="button" disabled={busy} onClick={() => void load()}>
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

        {info?.gameSavePath ? (
          <p className="muted library-file-meta" title={info.gameSavePath}>
            Game: {info.gameSavePath}
            {info.gameSavePathExists ? '' : ' (not created yet)'}
          </p>
        ) : (
          <p className="muted library-file-meta">Game: not installed · saves still live in AppData</p>
        )}
        {info?.backupPath ? (
          <p className="muted library-file-meta" title={info.backupPath}>
            AppData: {info.backupPath}
            {info.backupPathExists || saves.length ? ` · ${formatBytes(info.saveFolderBytes)}` : ''}
          </p>
        ) : null}

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
                  <button
                    className="ghost-btn"
                    type="button"
                    disabled={busy}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void window.api.rpgmaker.showSave(activeId, threadId, save.path, title).catch((err) => {
                        setError(err instanceof Error ? err.message : 'Could not show that save.')
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
    </div>
  )
}
