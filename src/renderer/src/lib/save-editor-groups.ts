export type SaveEditorPathPart =
  | { type: 'id'; value: string }
  | { type: 'index'; value: number }
  | { type: 'key'; value: string }

export type SaveEditorLeafRow = {
  displayName: string
  name?: string
  type?: string
  editable?: boolean
  value?: boolean | number | string | null
  group?: string
  groupKind?: 'list' | 'object' | 'dict' | 'tuple'
  field?: string
  itemIndex?: number
  itemStart?: number
  itemEnd?: number
  insertPos?: number
  pending?: boolean
}

export type SaveEditorNode<T extends SaveEditorLeafRow = SaveEditorLeafRow> = {
  key: string
  label: string
  kind: 'list' | 'object' | 'dict' | 'tuple' | 'scalar'
  path: string
  itemIndex?: number
  itemStart?: number
  itemEnd?: number
  insertPos?: number
  leaf?: { row: T; index: number }
  children: SaveEditorNode<T>[]
}

export type PinnedSaveEditorEntry<T extends SaveEditorLeafRow = SaveEditorLeafRow> = {
  path: string
  node: SaveEditorNode<T> | null
}

export function parseSaveEditorPath(path: string): SaveEditorPathPart[] {
  let text = path.startsWith('store.') ? path.slice('store.'.length) : path
  const parts: SaveEditorPathPart[] = []
  let i = 0
  while (i < text.length) {
    if (text[i] === '.') {
      i++
      continue
    }
    if (text[i] === '[') {
      const close = findBracketClose(text, i)
      if (close < 0) {
        parts.push({ type: 'id', value: text.slice(i) })
        break
      }
      const inner = text.slice(i + 1, close)
      if (/^(?:0|[1-9]\d*)$/.test(inner)) {
        parts.push({ type: 'index', value: Number(inner) })
      } else {
        try {
          const value = JSON.parse(inner)
          parts.push({ type: 'key', value: value == null ? inner : String(value) })
        } catch {
          parts.push({ type: 'key', value: inner })
        }
      }
      i = close + 1
      continue
    }
    let j = i
    while (j < text.length && text[j] !== '.' && text[j] !== '[') j++
    const id = text.slice(i, j)
    if (id) parts.push({ type: 'id', value: id })
    i = j
  }
  return parts
}

export function pathPartsFromSegments(segments: string[]): SaveEditorPathPart[] {
  return segments.map((part) => {
    if (/^(?:0|[1-9]\d*)$/.test(part)) return { type: 'index' as const, value: Number(part) }
    if (/^[@A-Za-z_$][\w$]*$/.test(part)) return { type: 'id' as const, value: part }
    return { type: 'key' as const, value: part }
  })
}

function findBracketClose(text: string, open: number): number {
  let i = open + 1
  if (text[i] === '"' || text[i] === "'") {
    const quote = text[i]
    i++
    while (i < text.length) {
      if (text[i] === '\\') {
        i += 2
        continue
      }
      if (text[i] === quote) {
        i++
        break
      }
      i++
    }
    return text[i] === ']' ? i : -1
  }
  return text.indexOf(']', open + 1)
}

function labelOf(part: SaveEditorPathPart): string {
  if (part.type === 'index') return `[${part.value}]`
  if (part.type === 'key') return JSON.stringify(part.value)
  return part.value
}

function appendPart(base: string, part: SaveEditorPathPart): string {
  if (part.type === 'index') return `${base}[${part.value}]`
  if (part.type === 'key') return `${base}[${JSON.stringify(part.value)}]`
  return base ? `${base}.${part.value}` : part.value
}

function kindFromChild(part: SaveEditorPathPart): SaveEditorNode['kind'] {
  if (part.type === 'index') return 'list'
  if (part.type === 'key') return 'dict'
  return 'object'
}

export function isPrimitiveNode<T extends SaveEditorLeafRow>(node: SaveEditorNode<T>): boolean {
  return Boolean(node.leaf) && node.children.length === 0
}

export function collectLeaves<T extends SaveEditorLeafRow>(
  node: SaveEditorNode<T>
): Array<{ row: T; index: number }> {
  if (node.leaf && !node.children.length) return [node.leaf]
  const out: Array<{ row: T; index: number }> = []
  if (node.leaf) out.push(node.leaf)
  for (const child of node.children) out.push(...collectLeaves(child))
  return out
}

export function countLeaves<T extends SaveEditorLeafRow>(nodes: SaveEditorNode<T>[]): number {
  return nodes.reduce((sum, node) => sum + collectLeaves(node).length, 0)
}

function namedValue<T extends SaveEditorLeafRow>(node: SaveEditorNode<T>): string | null {
  for (const child of node.children) {
    if (!child.leaf || child.children.length) continue
    const field = (child.leaf.row.field || child.label || '').toLowerCase()
    if (
      (field === 'name' || field === '_name') &&
      typeof child.leaf.row.value === 'string' &&
      child.leaf.row.value
    ) {
      return child.leaf.row.value
    }
  }
  return null
}

export function listItemLabel<T extends SaveEditorLeafRow>(node: SaveEditorNode<T>): string {
  const index = node.itemIndex ?? 0
  const named = namedValue(node)
  if (named) return `[${index}] ${named}`
  if (isPrimitiveNode(node) && node.leaf) {
    const value = node.leaf.row.value
    if (value === null) return `[${index}] None`
    return `[${index}] ${String(value)}`
  }
  return `[${index}]`
}

export function nodeMatchesFilter<T extends SaveEditorLeafRow>(node: SaveEditorNode<T>, needle: string): boolean {
  if (!needle) return true
  if (node.label.toLowerCase().includes(needle) || node.path.toLowerCase().includes(needle)) return true
  if (node.leaf) {
    const { row } = node.leaf
    if (
      row.displayName.toLowerCase().includes(needle) ||
      (row.name && row.name.toLowerCase().includes(needle)) ||
      String(row.value ?? '').toLowerCase() === needle
    ) {
      return true
    }
  }
  return node.children.some((child) => nodeMatchesFilter(child, needle))
}

export function filterSaveEditorTree<T extends SaveEditorLeafRow>(
  nodes: SaveEditorNode<T>[],
  needle: string
): SaveEditorNode<T>[] {
  if (!needle) return nodes
  const out: SaveEditorNode<T>[] = []
  for (const node of nodes) {
    const self =
      node.label.toLowerCase().includes(needle) ||
      node.path.toLowerCase().includes(needle) ||
      (node.leaf
        ? node.leaf.row.displayName.toLowerCase().includes(needle) ||
          Boolean(node.leaf.row.name?.toLowerCase().includes(needle)) ||
          String(node.leaf.row.value ?? '').toLowerCase() === needle
        : false)
    if (self) {
      out.push(node)
      continue
    }
    const children = filterSaveEditorTree(node.children, needle)
    if (children.length) out.push({ ...node, children })
  }
  return out
}

function rowBelongsTo<T extends SaveEditorLeafRow>(node: SaveEditorNode<T>, row: T): boolean {
  const display = row.displayName
  return (
    row.group === node.path ||
    display === node.path ||
    display.startsWith(`${node.path}.`) ||
    display.startsWith(`${node.path}[`)
  )
}

function attachListMeta<T extends SaveEditorLeafRow>(node: SaveEditorNode<T>): void {
  for (const child of node.children) attachListMeta(child)
  if (node.kind !== 'list' && node.kind !== 'tuple') return
  const leaves = collectLeaves(node)
  const owned = leaves.filter(({ row }) => row.group === node.path)
  node.insertPos =
    owned.find(({ row }) => row.insertPos != null)?.row.insertPos ??
    leaves.find(({ row }) => row.insertPos != null)?.row.insertPos
  for (const child of node.children) {
    if (child.itemIndex == null) continue
    const itemLeaves = collectLeaves(child)
    const exact = itemLeaves.filter(({ row }) => row.group === node.path && row.itemIndex === child.itemIndex)
    const src = exact.length ? exact : itemLeaves.filter(({ row }) => row.itemStart != null && rowBelongsTo(child, row))
    for (const { row } of src) {
      if (row.itemStart != null) {
        child.itemStart = child.itemStart == null ? row.itemStart : Math.min(child.itemStart, row.itemStart)
      }
      if (row.itemEnd != null) {
        child.itemEnd = child.itemEnd == null ? row.itemEnd : Math.max(child.itemEnd, row.itemEnd)
      }
    }
  }
}

function refineKind<T extends SaveEditorLeafRow>(node: SaveEditorNode<T>): void {
  if (node.children.length) {
    for (const child of node.children) refineKind(child)
    const leaves = collectLeaves(node)
    const own = leaves.find(({ row }) => row.group === node.path && row.groupKind)
    if (own?.row.groupKind === 'tuple') node.kind = 'tuple'
    else if (own?.row.groupKind === 'dict' && node.kind !== 'list') node.kind = 'dict'
    else if (own?.row.groupKind === 'list' && node.children.every((child) => child.itemIndex != null)) {
      node.kind = 'list'
    }
  }
}

export function buildSaveEditorTree<T extends SaveEditorLeafRow>(
  rows: Array<{ row: T; index: number }>,
  options?: { partsFor?: (row: T) => SaveEditorPathPart[] }
): SaveEditorNode<T>[] {
  const root: SaveEditorNode<T>[] = []

  for (const item of rows) {
    const parts = options?.partsFor?.(item.row) ?? parseSaveEditorPath(item.row.displayName || item.row.name || '')
    if (!parts.length) continue
    let level = root
    let parentPath = ''
    let node: SaveEditorNode<T> | undefined
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const path = appendPart(parentPath, part)
      node = level.find((candidate) => candidate.path === path)
      if (!node) {
        node = {
          key: path,
          label: labelOf(part),
          kind: i === parts.length - 1 ? 'scalar' : kindFromChild(parts[i + 1]),
          path,
          itemIndex: part.type === 'index' ? part.value : undefined,
          children: []
        }
        level.push(node)
      } else if (i < parts.length - 1 && node.kind === 'scalar') {
        node.kind = kindFromChild(parts[i + 1])
      }
      parentPath = path
      if (i < parts.length - 1) level = node.children
    }
    if (!node) continue
    node.leaf = item
    if (!node.children.length) node.kind = 'scalar'
  }

  for (const node of root) refineKind(node)
  for (const node of root) attachListMeta(node)
  return root
}

function compareSaveEditorNodes<T extends SaveEditorLeafRow>(a: SaveEditorNode<T>, b: SaveEditorNode<T>): number {
  if (a.itemIndex != null && b.itemIndex != null) return a.itemIndex - b.itemIndex
  if (a.itemIndex != null) return -1
  if (b.itemIndex != null) return 1
  return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' })
}

export function sortSaveEditorTree<T extends SaveEditorLeafRow>(nodes: SaveEditorNode<T>[]): SaveEditorNode<T>[] {
  return [...nodes]
    .sort(compareSaveEditorNodes)
    .map((node) => (node.children.length ? { ...node, children: sortSaveEditorTree(node.children) } : node))
}

export function findSaveEditorNode<T extends SaveEditorLeafRow>(
  nodes: SaveEditorNode<T>[],
  path: string
): SaveEditorNode<T> | undefined {
  for (const node of nodes) {
    if (node.path === path) return node
    const nested = findSaveEditorNode(node.children, path)
    if (nested) return nested
  }
  return undefined
}

export function removeSaveEditorNode<T extends SaveEditorLeafRow>(
  nodes: SaveEditorNode<T>[],
  path: string
): SaveEditorNode<T>[] {
  let changed = false
  const out: SaveEditorNode<T>[] = []
  for (const node of nodes) {
    if (node.path === path) {
      changed = true
      continue
    }
    if (node.children.length) {
      const children = removeSaveEditorNode(node.children, path)
      if (children !== node.children) {
        changed = true
        if (!children.length && !node.leaf) continue
        out.push({ ...node, children })
        continue
      }
    }
    out.push(node)
  }
  return changed ? out : nodes
}

export function splitPinnedSaveEditorTree<T extends SaveEditorLeafRow>(
  nodes: SaveEditorNode<T>[],
  pinPaths: string[]
): { pinned: PinnedSaveEditorEntry<T>[]; rest: SaveEditorNode<T>[] } {
  let rest = nodes
  const pinned: PinnedSaveEditorEntry<T>[] = []
  const extracted: SaveEditorNode<T>[] = []
  for (const path of pinPaths) {
    if (!path) continue
    if (findSaveEditorNode(extracted, path)) continue
    const node = findSaveEditorNode(rest, path)
    if (!node) {
      pinned.push({ path, node: null })
      continue
    }
    extracted.push(node)
    rest = removeSaveEditorNode(rest, path)
    pinned.push({ path, node })
  }
  return { pinned, rest }
}

export function filterPinnedSaveEditorEntries<T extends SaveEditorLeafRow>(
  entries: PinnedSaveEditorEntry<T>[],
  needle: string
): PinnedSaveEditorEntry<T>[] {
  if (!needle) return entries
  const out: PinnedSaveEditorEntry<T>[] = []
  for (const entry of entries) {
    if (!entry.node) {
      if (entry.path.toLowerCase().includes(needle)) out.push(entry)
      continue
    }
    const filtered = filterSaveEditorTree([entry.node], needle)
    if (filtered.length) out.push({ ...entry, node: filtered[0] })
  }
  return out
}

export function nodeHasChanged<T extends SaveEditorLeafRow>(
  node: SaveEditorNode<T>,
  isRowChanged: (row: T, index: number) => boolean
): boolean {
  return collectLeaves(node).some(({ row, index }) => isRowChanged(row, index))
}

export function pathUnder(displayName: string, prefix: string): boolean {
  const text = displayName.startsWith('store.') ? displayName.slice('store.'.length) : displayName
  return text === prefix || text.startsWith(`${prefix}.`) || text.startsWith(`${prefix}[`)
}

export function rewriteIndexedPath(text: string, listPath: string, from: number, to: number): string {
  const bases = listPath.startsWith('store.') ? [listPath] : [listPath, `store.${listPath}`]
  for (const base of bases) {
    const token = `${base}[${from}]`
    const next = `${base}[${to}]`
    if (text === token) return next
    if (text.startsWith(`${token}.`) || text.startsWith(`${token}[`)) return next + text.slice(token.length)
  }
  return text
}
