import { useEffect, useId, useMemo, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type {
  RpgMakerSaveEditPatch,
  RpgMakerSaveEditVar,
  RpgMakerSaveEditorData,
  RpgMakerSaveFile
} from '@shared/types'
import { confirm } from './ConfirmDialog'
import { notifyCaught } from './ErrorNotifications'

type RpgMakerSaveEditorDialogProps = {
  fileId: string
  threadId: number
  title: string
  save: RpgMakerSaveFile
  onClose: () => void
  onSaved: () => Promise<void>
}

function formatValue(value: RpgMakerSaveEditVar['value']): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

function pathKey(path: string[]): string {
  return path.join('\0')
}

export default function RpgMakerSaveEditorDialog({
  fileId,
  threadId,
  title,
  save,
  onClose,
  onSaved
}: RpgMakerSaveEditorDialogProps): JSX.Element {
  const titleId = useId()
  const filterId = useId()
  const [data, setData] = useState<RpgMakerSaveEditorData | null>(null)
  const [rows, setRows] = useState<RpgMakerSaveEditVar[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const original = data?.variables ?? []

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    window.api.rpgmaker
      .readSaveEditor(fileId, threadId, save.path, title)
      .then((next) => {
        if (cancelled) return
        setData(next)
        setRows(next.variables)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Could not read that save.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [fileId, threadId, save.path, title])

  const dirty = useMemo(() => {
    if (original.length !== rows.length) return rows.some((row) => row.editable)
    return rows.some((row, index) => row.editable && row.value !== original[index]?.value)
  }, [original, rows])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return rows.map((row, index) => ({ row, index }))
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        return (
          row.displayName.toLowerCase().includes(needle) ||
          formatValue(row.value).toLowerCase() === needle
        )
      })
  }, [filter, rows])

  const editableCount = rows.filter((row) => row.editable).length

  function setRowValue(index: number, value: boolean | number | string): void {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, value } : row)))
  }

  function patches(): RpgMakerSaveEditPatch[] {
    const orig = new Map(original.map((row) => [pathKey(row.path), row]))
    const out: RpgMakerSaveEditPatch[] = []
    for (const row of rows) {
      if (!row.editable) continue
      const before = orig.get(pathKey(row.path))
      if (!before || before.value === row.value) continue
      if (typeof row.value === 'boolean' || typeof row.value === 'number' || typeof row.value === 'string') {
        out.push({ path: row.path, value: row.value })
      }
    }
    return out
  }

  async function requestClose(): Promise<void> {
    if (saving) return
    if (dirty) {
      const ok = await confirm({
        title: 'Discard changes?',
        message: 'Unsaved variable edits will be lost.',
        confirmLabel: 'Discard'
      })
      if (!ok) return
    }
    onClose()
  }

  async function apply(): Promise<void> {
    const next = patches()
    if (!next.length) {
      onClose()
      return
    }
    setSaving(true)
    setError('')
    try {
      await window.api.rpgmaker.applySaveEditor(fileId, threadId, save.path, next, title)
      await onSaved()
      onClose()
    } catch (err) {
      notifyCaught(err, 'Could not write that save.')
      setError(err instanceof Error ? err.message : 'Could not write that save.')
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        void requestClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return createPortal(
    <div
      className="app-confirm-overlay save-editor-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) void requestClose()
      }}
    >
      <div
        className="app-confirm-dialog save-editor-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="save-editor-head">
          <div>
            <h2 id={titleId} className="app-confirm-title">
              Edit save
            </h2>
            <p className="muted save-editor-file">{save.label} · {save.name}</p>
          </div>
          <label className="save-editor-filter" htmlFor={filterId}>
            <span className="filter-label">Filter</span>
            <input
              id={filterId}
              className="save-editor-filter-input"
              type="search"
              value={filter}
              autoFocus
              placeholder="Variable name or value"
              onChange={(event) => setFilter(event.target.value)}
            />
          </label>
        </div>

        {loading ? (
          <p className="muted">Reading save variables…</p>
        ) : error && !rows.length ? (
          <p className="save-editor-error">{error}</p>
        ) : (
          <>
            <p className="muted save-editor-count">
              {visible.length === rows.length
                ? `${rows.length} variable${rows.length === 1 ? '' : 's'}`
                : `${visible.length} of ${rows.length} variables`}
              {editableCount ? ` · ${editableCount} editable (booleans, numbers, and short strings)` : ''}
            </p>
            {error ? <p className="save-editor-error">{error}</p> : null}
            <div className="save-editor-table-wrap">
              <table className="save-editor-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(({ row, index }) => {
                    const key = pathKey(row.path)
                    return (
                      <tr key={key} className={row.editable ? 'is-editable' : 'is-readonly'}>
                        <td title={row.displayName}>{row.displayName}</td>
                        <td>{row.type}</td>
                        <td>
                          {row.type === 'Boolean' && row.editable ? (
                            <label className="save-editor-bool">
                              <input
                                type="checkbox"
                                checked={row.value === true}
                                disabled={saving}
                                onChange={() => setRowValue(index, row.value !== true)}
                              />
                              {row.value === true ? 'true' : 'false'}
                            </label>
                          ) : row.editable && (row.type === 'Integer' || row.type === 'Number') ? (
                            <input
                              className="save-editor-int"
                              type="number"
                              step={row.type === 'Integer' ? 1 : 'any'}
                              value={drafts[key] ?? (typeof row.value === 'number' ? String(row.value) : '')}
                              disabled={saving}
                              onChange={(event) => {
                                const text = event.target.value
                                setDrafts((current) => ({ ...current, [key]: text }))
                                if (text === '' || text === '-' || text === '.' || text === '-.') return
                                const next = Number(text)
                                if (!Number.isFinite(next)) return
                                if (row.type === 'Integer' && !Number.isInteger(next)) return
                                setRowValue(index, next)
                              }}
                              onBlur={() => {
                                setDrafts((current) => {
                                  const next = { ...current }
                                  delete next[key]
                                  return next
                                })
                              }}
                            />
                          ) : row.editable && row.type === 'String' ? (
                            <input
                              className="save-editor-str"
                              type="text"
                              value={drafts[key] ?? (typeof row.value === 'string' ? row.value : '')}
                              disabled={saving}
                              onChange={(event) => {
                                const text = event.target.value
                                setDrafts((current) => ({ ...current, [key]: text }))
                                setRowValue(index, text)
                              }}
                            />
                          ) : (
                            <span className="muted">{formatValue(row.value)}</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!visible.length ? <p className="muted save-editor-empty">No variables match that filter.</p> : null}
            </div>
          </>
        )}

        <div className="app-confirm-actions">
          <button className="ghost-btn" type="button" disabled={saving} onClick={() => void requestClose()}>
            Cancel
          </button>
          <button
            className="primary-btn"
            type="button"
            disabled={saving || loading || !dirty}
            onClick={() => void apply()}
          >
            {saving ? 'Saving…' : 'Apply changes'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
