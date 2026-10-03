import { Fragment, type Dispatch, type JSX, type SetStateAction } from 'react'
import {
  isPrimitiveNode,
  listItemLabel,
  nodeHasChanged,
  nodeMatchesFilter,
  type PinnedSaveEditorEntry,
  type SaveEditorLeafRow,
  type SaveEditorNode
} from '../lib/save-editor-groups'

function childPipes(pipes: boolean[], index: number, count: number): boolean[] {
  return [...pipes, index < count - 1]
}

function NestGuides({ pipes }: { pipes: boolean[] }): JSX.Element | null {
  if (!pipes.length) return null
  return (
    <span className="save-editor-guides" aria-hidden>
      {pipes.map((continues, i) => {
        const last = i === pipes.length - 1
        const kind = last ? (continues ? 'tee' : 'elbow') : continues ? 'pipe' : 'blank'
        return <span key={i} className={`save-editor-guide is-${kind}`} />
      })}
    </span>
  )
}

function kindLabel<T extends SaveEditorLeafRow>(node: SaveEditorNode<T>): string {
  if (node.kind === 'list' || node.kind === 'tuple') {
    return `${node.children.length} item${node.children.length === 1 ? '' : 's'}`
  }
  if (node.kind === 'dict') return 'Dict'
  return 'Object'
}

function PinIcon({ filled }: { filled: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        opacity={filled ? 1 : 0.55}
        d="M8.7 1.4 14.6 7.3a1 1 0 0 1-1.4 1.4l-.5-.5-3.3 3.3.8 3.1a.75.75 0 0 1-1.22.78L6.4 12.7 3.3 15.8 1.2 13.7 4.3 10.6 1.7 8.02a.75.75 0 0 1 .78-1.22l3.1.8 3.3-3.3-.5-.5a1 1 0 0 1 1.4-1.4Z"
      />
    </svg>
  )
}

function PinButton({
  pinned,
  path,
  onToggle
}: {
  pinned: boolean
  path: string
  onToggle: (path: string) => void
}): JSX.Element {
  return (
    <button
      className={`save-editor-pin${pinned ? ' is-pinned' : ''}`}
      type="button"
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${path}` : `Pin ${path}`}
      title={pinned ? 'Unpin' : 'Pin'}
      onClick={() => onToggle(path)}
    >
      <PinIcon filled={pinned} />
    </button>
  )
}

function rowClass(row: SaveEditorLeafRow): string {
  return row.editable && !row.pending ? 'is-editable' : 'is-readonly'
}

export type SaveEditorTreeRowsProps<T extends SaveEditorLeafRow> = {
  nodes?: SaveEditorNode<T>[]
  entries?: PinnedSaveEditorEntry<T>[]
  expanded: Set<string>
  setExpanded: Dispatch<SetStateAction<Set<string>>>
  needle: string
  pinnedPaths: ReadonlySet<string>
  onTogglePin: (path: string) => void
  isRowChanged: (row: T, index: number) => boolean
  renderValue: (row: T, index: number) => JSX.Element
  canAddList?: (node: SaveEditorNode<T>) => boolean
  onAddList?: (node: SaveEditorNode<T>) => void
  canRemoveItem?: (list: SaveEditorNode<T>, item: SaveEditorNode<T>) => boolean
  onRemoveItem?: (list: SaveEditorNode<T>, item: SaveEditorNode<T>) => void
  saving?: boolean
  usePathLabels?: boolean
}

export function SaveEditorTreeRows<T extends SaveEditorLeafRow>({
  nodes = [],
  entries,
  expanded,
  setExpanded,
  needle,
  pinnedPaths,
  onTogglePin,
  isRowChanged,
  renderValue,
  canAddList,
  onAddList,
  canRemoveItem,
  onRemoveItem,
  saving = false,
  usePathLabels = false
}: SaveEditorTreeRowsProps<T>): JSX.Element {
  function isOpen(node: SaveEditorNode<T>): boolean {
    if (needle && node.children.some((child) => nodeMatchesFilter(child, needle))) return true
    if (needle && nodeMatchesFilter(node, needle) && node.children.length) return true
    return expanded.has(node.key)
  }

  function leafRow(node: SaveEditorNode<T>, pipes: boolean[], label: string): JSX.Element | null {
    if (!node.leaf) return null
    const { row, index } = node.leaf
    const changed = isRowChanged(row, index)
    return (
      <tr
        key={`${row.displayName}-${index}`}
        className={`${rowClass(row)}${pipes.length ? ' is-nested' : ''}${changed ? ' is-changed' : ''}${
          pinnedPaths.has(node.path) ? ' is-pinned-row' : ''
        }`}
      >
        <td className="save-editor-name" title={row.name || row.displayName}>
          <div className="save-editor-cell">
            <NestGuides pipes={pipes} />
            <span className="save-editor-label">{label}</span>
            <PinButton pinned={pinnedPaths.has(node.path)} path={node.path} onToggle={onTogglePin} />
          </div>
        </td>
        <td>{row.type}</td>
        <td>{renderValue(row, index)}</td>
      </tr>
    )
  }

  function renderNode(
    node: SaveEditorNode<T>,
    pipes: boolean[],
    listParent?: SaveEditorNode<T>,
    pathLabel = false
  ): JSX.Element[] {
    const primitive = isPrimitiveNode(node)
    const label = listParent ? listItemLabel(node) : pathLabel ? node.path : node.label
    if (primitive && !listParent) {
      const row = leafRow(node, pipes, label)
      return row ? [row] : []
    }
    if (primitive && listParent) {
      const row = node.leaf
      if (!row) return []
      const canRemove = Boolean(canRemoveItem?.(listParent, node))
      const changed = isRowChanged(row.row, row.index)
      return [
        <tr
          key={node.key}
          className={`save-editor-item ${rowClass(row.row)}${changed ? ' is-changed' : ''}${
            pinnedPaths.has(node.path) ? ' is-pinned-row' : ''
          }`}
        >
          <td className="save-editor-name">
            <div className="save-editor-cell">
              <NestGuides pipes={pipes} />
              <div className="save-editor-group-row is-item">
                <span className="save-editor-item-label">{label}</span>
                <PinButton pinned={pinnedPaths.has(node.path)} path={node.path} onToggle={onTogglePin} />
                {canRemove ? (
                  <button
                    className="ghost-btn save-editor-item-btn"
                    type="button"
                    disabled={saving}
                    onClick={() => onRemoveItem?.(listParent, node)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          </td>
          <td>{row.row.type}</td>
          <td>{renderValue(row.row, row.index)}</td>
        </tr>
      ]
    }

    const open = isOpen(node)
    const canAdd = Boolean(canAddList?.(node))
    const canRemove = Boolean(listParent && canRemoveItem?.(listParent, node))
    const childListParent = node.kind === 'list' || node.kind === 'tuple' ? node : undefined
    const changed = nodeHasChanged(node, isRowChanged)
    return [
      <Fragment key={node.key}>
        <tr
          className={`${listParent ? 'save-editor-item' : 'save-editor-group'}${changed ? ' is-changed' : ''}${
            pinnedPaths.has(node.path) ? ' is-pinned-row' : ''
          }`}
        >
          <td colSpan={3} className="save-editor-name">
            <div className="save-editor-cell">
              <NestGuides pipes={pipes} />
              <div className={`save-editor-group-row${listParent ? ' is-item' : ''}`}>
                <button
                  className="save-editor-toggle"
                  type="button"
                  aria-expanded={open}
                  onClick={() =>
                    setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(node.key)) next.delete(node.key)
                      else next.add(node.key)
                      return next
                    })
                  }
                >
                  <span className="save-editor-chevron" aria-hidden>
                    {open ? '▾' : '▸'}
                  </span>
                  <span className={listParent ? 'save-editor-item-label' : 'save-editor-group-name'}>{label}</span>
                  <span className="muted">{kindLabel(node)}</span>
                </button>
                <PinButton pinned={pinnedPaths.has(node.path)} path={node.path} onToggle={onTogglePin} />
                {canAdd ? (
                  <button
                    className="ghost-btn save-editor-item-btn"
                    type="button"
                    disabled={saving}
                    onClick={() => onAddList?.(node)}
                  >
                    Add
                  </button>
                ) : null}
                {canRemove && listParent ? (
                  <button
                    className="ghost-btn save-editor-item-btn"
                    type="button"
                    disabled={saving}
                    onClick={() => onRemoveItem?.(listParent, node)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
        {open
          ? node.children.flatMap((child, i) =>
              renderNode(child, childPipes(pipes, i, node.children.length), childListParent)
            )
          : null}
      </Fragment>
    ]
  }

  function missingRow(path: string): JSX.Element {
    return (
      <tr key={`missing:${path}`} className="save-editor-missing">
        <td className="save-editor-name" title={path}>
          <div className="save-editor-cell">
            <span className="save-editor-label">{path}</span>
            <PinButton pinned path={path} onToggle={onTogglePin} />
          </div>
        </td>
        <td>—</td>
        <td>
          <span className="save-editor-missing-note">Not found in this save</span>
        </td>
      </tr>
    )
  }

  const rows = entries
    ? entries.flatMap((entry) =>
        entry.node ? renderNode(entry.node, [], undefined, usePathLabels) : [missingRow(entry.path)]
      )
    : nodes.flatMap((node) => renderNode(node, [], undefined, usePathLabels))

  return <>{rows}</>
}
