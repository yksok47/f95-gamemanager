import { useEffect, useId, useMemo, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { RenpySaveEditPatch, RenpySaveEditVar, RenpySaveEditorData, RenpySaveFile } from '@shared/types'
import { confirm } from './ConfirmDialog'
import { notifyCaught } from './ErrorNotifications'

type RenpySaveEditorDialogProps = {
  fileId: string
  title: string
  save: RenpySaveFile
  onClose: () => void
  onSaved: () => Promise<void>
}

function formatValue(value: RenpySaveEditVar['value']): string {
  if (value === null) return 'None'
  if (typeof value === 'boolean') return value ? 'True' : 'False'
  return String(value)
}

function sameValue(a: RenpySaveEditVar['value'], b: RenpySaveEditVar['value']): boolean {
  return a === b
}

export default function RenpySaveEditorDialog({
  fileId,
  title,
  save,
  onClose,
  onSaved
}: RenpySaveEditorDialogProps): JSX.Element {
  const titleId = useId()
  const filterId = useId()
  const [data, setData] = useState<RenpySaveEditorData | null>(null)
  const [rows, setRows] = useState<RenpySaveEditVar[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const original = data?.variables ?? []

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    window.api.renpy
      .readSaveEditor(fileId, save.path, title)
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
  }, [fileId, save.path, title])

  const dirty = useMemo(() => {
    if (original.length !== rows.length) return rows.some((row) => row.editable)
    return rows.some((row, index) => row.editable && !sameValue(row.value, original[index]?.value))
  }, [original, rows])

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return rows.map((row, index) => ({ row, index }))
    return rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => {
        return (
          row.displayName.toLowerCase().includes(needle) ||
          row.name.toLowerCase().includes(needle) ||
          formatValue(row.value).toLowerCase() === needle
        )
      })
  }, [filter, rows])

  const editableCount = rows.filter((row) => row.editable).length

  function setRowValue(index: number, value: boolean | number | string): void {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, value } : row)))
  }

  function patches(): RenpySaveEditPatch[] {
    const orig = new Map(original.map((row) => [row.pos, row]))
    const out: RenpySaveEditPatch[] = []
    for (const row of rows) {
      if (!row.editable || !row.kind) continue
      const before = orig.get(row.pos)
      if (!before || sameValue(before.value, row.value)) continue
      if (row.kind === 'bool' && typeof row.value === 'boolean') {
        out.push({ pos: row.pos, kind: 'bool', value: row.value })
      } else if (
        (row.kind === 'BININT1' || row.kind === 'BININT2' || row.kind === 'BININT') &&
        typeof row.value === 'number' &&
        Number.isInteger(row.value)
      ) {
        out.push({ pos: row.pos, kind: row.kind, value: row.value })
      } else if (
        (row.kind === 'SHORT_BINUNICODE' || row.kind === 'BINUNICODE' || row.kind === 'BINUNICODE8') &&
        typeof row.value === 'string'
      ) {
        out.push({ pos: row.pos, kind: row.kind, value: row.value })
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
      await window.api.renpy.applySaveEditor(fileId, save.path, next, title)
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
            <p className="muted save-editor-file">{save.saveName || save.label} · {save.name}</p>
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
              {editableCount ? ` · ${editableCount} editable (booleans, integers, and strings)` : ''}
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
                  {visible.map(({ row, index }) => (
                    <tr key={`${row.pos}-${row.name}`} className={row.editable ? 'is-editable' : 'is-readonly'}>
                      <td title={row.name}>{row.displayName}</td>
                      <td>{row.type}</td>
                      <td>
                        {row.kind === 'bool' ? (
                          <label className="save-editor-bool">
                            <input
                              type="checkbox"
                              checked={row.value === true}
                              disabled={saving}
                              onChange={() => setRowValue(index, row.value !== true)}
                            />
                            {row.value === true ? 'True' : 'False'}
                          </label>
                        ) : row.editable &&
                          (row.kind === 'BININT1' || row.kind === 'BININT2' || row.kind === 'BININT') ? (
                          <input
                            className="save-editor-int"
                            type="number"
                            value={drafts[index] ?? (typeof row.value === 'number' ? String(row.value) : '')}
                            min={row.min}
                            max={row.max}
                            disabled={saving}
                            onChange={(event) => {
                              const text = event.target.value
                              setDrafts((current) => ({ ...current, [index]: text }))
                              if (text === '' || text === '-') return
                              const next = Number(text)
                              if (Number.isInteger(next)) setRowValue(index, next)
                            }}
                            onBlur={() => {
                              setDrafts((current) => {
                                const next = { ...current }
                                delete next[index]
                                return next
                              })
                            }}
                          />
                        ) : row.editable &&
                          (row.kind === 'SHORT_BINUNICODE' ||
                            row.kind === 'BINUNICODE' ||
                            row.kind === 'BINUNICODE8') ? (
                          <input
                            className="save-editor-str"
                            type="text"
                            value={drafts[index] ?? (typeof row.value === 'string' ? row.value : '')}
                            maxLength={row.max}
                            disabled={saving}
                            onChange={(event) => {
                              const text = event.target.value
                              setDrafts((current) => ({ ...current, [index]: text }))
                              setRowValue(index, text)
                            }}
                          />
                        ) : (
                          <span className="muted">{formatValue(row.value)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
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
