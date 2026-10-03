import { useEffect, useId, useMemo, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { RenpySaveEditPatch, RenpySaveEditVar, RenpySaveEditorData, RenpySaveFile } from '@shared/types'
import { confirm } from './ConfirmDialog'
import { notifyCaught } from './ErrorNotifications'
import { InlineLoading } from './Spinner'
import { SaveEditorTreeRows } from './SaveEditorTree'
import {
  buildSaveEditorTree,
  collectLeaves,
  countLeaves,
  filterPinnedSaveEditorEntries,
  filterSaveEditorTree,
  pathUnder,
  rewriteIndexedPath,
  sortSaveEditorTree,
  splitPinnedSaveEditorTree,
  type SaveEditorNode
} from '../lib/save-editor-groups'
import { saveEditorPinGameKey, useSaveEditorPins } from '../lib/save-editor-pins'

type LocalVar = RenpySaveEditVar & { pending?: boolean }

type RenpySaveEditorDialogProps = {
  fileId: string
  threadId?: number
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
  threadId = 0,
  title,
  save,
  onClose,
  onSaved
}: RenpySaveEditorDialogProps): JSX.Element {
  const titleId = useId()
  const filterId = useId()
  const [data, setData] = useState<RenpySaveEditorData | null>(null)
  const [rows, setRows] = useState<LocalVar[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [listOps, setListOps] = useState<RenpySaveEditPatch[]>([])
  const original = data?.variables ?? []
  const { pins, pinnedPaths, togglePin } = useSaveEditorPins(saveEditorPinGameKey('renpy', threadId, fileId))

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
        setListOps([])
        setExpanded(new Set(pins))
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
    if (listOps.length) return true
    const orig = new Map(original.map((row) => [row.pos, row]))
    const live = rows.filter((row) => !row.pending)
    if (live.length !== original.length) return true
    return live.some((row) => {
      if (!row.editable) return false
      const before = orig.get(row.pos)
      if (!before) return true
      return !sameValue(row.value, before.value)
    })
  }, [original, rows, listOps])

  const originalByPos = useMemo(() => new Map(original.map((row) => [row.pos, row])), [original])

  function isRowChanged(row: LocalVar, _index: number): boolean {
    if (row.pending) return true
    if (!row.editable) return false
    const before = originalByPos.get(row.pos)
    if (!before) return true
    return !sameValue(row.value, before.value)
  }

  const indexedRows = useMemo(() => rows.map((row, index) => ({ row, index })), [rows])
  const needle = filter.trim().toLowerCase()
  const tree = useMemo(() => sortSaveEditorTree(buildSaveEditorTree(indexedRows)), [indexedRows])
  const { pinned, rest } = useMemo(() => splitPinnedSaveEditorTree(tree, pins), [tree, pins])
  const visiblePinned = useMemo(() => filterPinnedSaveEditorEntries(pinned, needle), [pinned, needle])
  const visibleRest = useMemo(
    () => (needle ? filterSaveEditorTree(rest, needle) : rest),
    [rest, needle]
  )
  const pinnedNodes = useMemo(
    () => visiblePinned.flatMap((entry) => (entry.node ? [entry.node] : [])),
    [visiblePinned]
  )

  const editableCount = rows.filter((row) => row.editable && !row.pending).length
  const visibleCount = countLeaves(pinnedNodes) + countLeaves(visibleRest)

  function setRowValue(index: number, value: boolean | number | string): void {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, value } : row)))
  }

  function rewriteRow(row: LocalVar, listPath: string, from: number, to: number): LocalVar {
    return {
      ...row,
      name: rewriteIndexedPath(row.name, listPath, from, to),
      displayName: rewriteIndexedPath(row.displayName, listPath, from, to),
      group: row.group ? rewriteIndexedPath(row.group, listPath, from, to) : row.group,
      itemIndex: row.group === listPath && row.itemIndex === from ? to : row.itemIndex
    }
  }

  function removeListItem(list: SaveEditorNode<LocalVar>, item: SaveEditorNode<LocalVar>): void {
    if (item.itemIndex == null) return
    const pending = collectLeaves(item).some(({ row }) => row.pending)
    const itemPrefix = `${list.path}[${item.itemIndex}]`
    if (pending) {
      const names = new Set(collectLeaves(item).map(({ row }) => row.name))
      setRows((current) => current.filter((row) => !names.has(row.name)))
      setListOps((current) => {
        const next = [...current]
        const idx = next.findIndex((op) => op.op === 'listInsert' && op.start === item.itemStart && op.end === item.itemEnd)
        if (idx >= 0) next.splice(idx, 1)
        return next
      })
      return
    }
    if (item.itemStart == null || item.itemEnd == null || item.itemEnd <= item.itemStart) return
    const removedIndex = item.itemIndex
    setListOps((current) => [...current, { op: 'listRemove', start: item.itemStart!, end: item.itemEnd! }])
    setRows((current) =>
      current
        .filter((row) => !pathUnder(row.displayName, itemPrefix))
        .map((row) => {
          const display = row.displayName.startsWith('store.') ? row.displayName.slice('store.'.length) : row.displayName
          const token = `${list.path}[`
          if (!display.startsWith(token)) return row
          const close = display.indexOf(']', token.length)
          const idx = Number(display.slice(token.length, close))
          if (!Number.isInteger(idx) || idx <= removedIndex) return row
          return rewriteRow(row, list.path, idx, idx - 1)
        })
    )
  }

  function addListItem(list: SaveEditorNode<LocalVar>): void {
    const source = [...list.children].reverse().find((entry) => entry.itemStart != null && entry.itemEnd != null)
    if (!source || source.itemStart == null || source.itemEnd == null || list.insertPos == null) return
    const nextIndex = Math.max(-1, ...list.children.map((entry) => entry.itemIndex ?? -1)) + 1
    const copies: LocalVar[] = collectLeaves(source).map(({ row }) => ({
      ...rewriteRow(row, list.path, source.itemIndex ?? 0, nextIndex),
      pending: true,
      itemStart: source.itemStart,
      itemEnd: source.itemEnd,
      insertPos: list.insertPos
    }))
    setRows((current) => {
      const last = [...current].reverse().find((row) => pathUnder(row.displayName, list.path))
      if (!last) return [...current, ...copies]
      const at = current.lastIndexOf(last) + 1
      return [...current.slice(0, at), ...copies, ...current.slice(at)]
    })
    setListOps((current) => [
      ...current,
      { op: 'listInsert', at: list.insertPos!, start: source.itemStart!, end: source.itemEnd! }
    ])
    setExpanded((current) => new Set(current).add(list.key))
  }

  function handleTogglePin(path: string): void {
    if (!pinnedPaths.has(path)) setExpanded((current) => new Set(current).add(path))
    togglePin(path)
  }

  function patches(): RenpySaveEditPatch[] {
    const orig = new Map(original.map((row) => [row.pos, row]))
    const out: RenpySaveEditPatch[] = [...listOps]
    for (const row of rows) {
      if (row.pending || !row.editable || !row.kind) continue
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

  function renderEditor(row: LocalVar, index: number): JSX.Element {
    const draftKey = `${row.name}:${index}`
    const readOnly = saving || row.pending
    if (row.kind === 'bool') {
      return (
        <label className="save-editor-bool">
          <input
            type="checkbox"
            checked={row.value === true}
            disabled={readOnly}
            onChange={() => setRowValue(index, row.value !== true)}
          />
          {row.value === true ? 'True' : 'False'}
        </label>
      )
    }
    if (row.editable && (row.kind === 'BININT1' || row.kind === 'BININT2' || row.kind === 'BININT')) {
      return (
        <input
          className="save-editor-int"
          type="number"
          value={drafts[draftKey] ?? (typeof row.value === 'number' ? String(row.value) : '')}
          min={row.min}
          max={row.max}
          disabled={readOnly}
          onChange={(event) => {
            const text = event.target.value
            setDrafts((current) => ({ ...current, [draftKey]: text }))
            if (text === '' || text === '-') return
            const next = Number(text)
            if (Number.isInteger(next)) setRowValue(index, next)
          }}
          onBlur={() => {
            setDrafts((current) => {
              const next = { ...current }
              delete next[draftKey]
              return next
            })
          }}
        />
      )
    }
    if (row.editable && (row.kind === 'SHORT_BINUNICODE' || row.kind === 'BINUNICODE' || row.kind === 'BINUNICODE8')) {
      return (
        <input
          className="save-editor-str"
          type="text"
          value={drafts[draftKey] ?? (typeof row.value === 'string' ? row.value : '')}
          maxLength={row.max}
          disabled={readOnly}
          onChange={(event) => {
            const text = event.target.value
            setDrafts((current) => ({ ...current, [draftKey]: text }))
            setRowValue(index, text)
          }}
        />
      )
    }
    return <span className="muted">{formatValue(row.value)}</span>
  }

  const treeProps = {
    expanded,
    setExpanded,
    needle,
    pinnedPaths,
    onTogglePin: handleTogglePin,
    isRowChanged,
    renderValue: renderEditor,
    saving,
    canAddList: (node: SaveEditorNode<LocalVar>) =>
      node.kind === 'list' &&
      node.insertPos != null &&
      node.children.some((child) => child.itemStart != null && child.itemEnd != null),
    onAddList: addListItem,
    canRemoveItem: (_list: SaveEditorNode<LocalVar>, item: SaveEditorNode<LocalVar>) =>
      item.itemStart != null && item.itemEnd != null,
    onRemoveItem: removeListItem
  }

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
          <InlineLoading label="Reading save variables" />
        ) : error && !rows.length ? (
          <p className="save-editor-error">{error}</p>
        ) : (
          <>
            <p className="muted save-editor-count">
              {visibleCount === rows.length
                ? `${rows.length} variable${rows.length === 1 ? '' : 's'}`
                : `${visibleCount} of ${rows.length} variables`}
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
                  {visiblePinned.length ? (
                    <>
                      <tr className="save-editor-section">
                        <td colSpan={3}>Pinned</td>
                      </tr>
                      <SaveEditorTreeRows entries={visiblePinned} usePathLabels {...treeProps} />
                    </>
                  ) : null}
                  {visibleRest.length && visiblePinned.length ? (
                    <tr className="save-editor-section">
                      <td colSpan={3}>All variables</td>
                    </tr>
                  ) : null}
                  <SaveEditorTreeRows nodes={visibleRest} {...treeProps} />
                </tbody>
              </table>
              {!visiblePinned.length && !visibleRest.length ? (
                <p className="muted save-editor-empty">No variables match that filter.</p>
              ) : null}
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
