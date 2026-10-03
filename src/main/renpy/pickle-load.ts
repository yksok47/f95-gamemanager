/** Reconstruct pickle protocol 2–5 values so store lists/dicts/objects can be flattened. */

import { genops } from './pickle-ops'

const MAX_LEAVES_PER_VAR = 250
const MAX_ROWS = 8_000
const MAX_DEPTH = 12

const MARK = Symbol('mark')

export type PyKind = 'prim' | 'list' | 'dict' | 'tuple' | 'set' | 'obj' | 'cls' | 'bytes'

export type ItemSpan = { start: number; end: number }

export type PyVal = {
  kind: PyKind
  pos: number
  spanStart?: number
  op?: string
  prim?: boolean | number | string | null
  bytes?: Buffer
  cls?: string
  items?: PyVal[]
  entries?: [PyVal, PyVal][]
  state?: PyVal
  itemSpans?: ItemSpan[]
  insertPos?: number
}

export type StoreLeaf = {
  name: string
  opcode: string
  arg: unknown
  pos: number
  group?: string
  groupKind?: 'list' | 'object' | 'dict' | 'tuple'
  field?: string
  itemIndex?: number
  itemStart?: number
  itemEnd?: number
  insertPos?: number
}

type FlattenMeta = {
  group: string
  groupKind: 'list' | 'object' | 'dict' | 'tuple'
  field?: string
  itemIndex?: number
  itemStart?: number
  itemEnd?: number
  insertPos?: number
}

type StackItem = PyVal | typeof MARK

function prim(op: string, pos: number, value: boolean | number | string | null): PyVal {
  return { kind: 'prim', pos, spanStart: pos, op, prim: value }
}

function cls(pos: number, name: string): PyVal {
  return { kind: 'cls', pos, spanStart: pos, cls: name }
}

function bytesVal(op: string, pos: number, data: Buffer): PyVal {
  return { kind: 'bytes', pos, spanStart: pos, op, bytes: data }
}

function slotStart(value: PyVal, fallback: number): number {
  return value.spanStart ?? value.pos ?? fallback
}

function containerKind(name: string): 'list' | 'dict' | 'set' | 'obj' {
  const n = name.replace(/\s+/g, '.')
  if (/\.RevertableList$|RevertableList$|TracedExpressionsList$|\.list$/.test(n)) return 'list'
  if (/\.RevertableDict$|RevertableDict$|\.dict$/.test(n)) return 'dict'
  if (/\.RevertableSet$|RevertableSet$|\.set$|__builtin__\.set$/.test(n)) return 'set'
  return 'obj'
}

function makeContainer(pos: number, name: string): PyVal {
  const kind = containerKind(name)
  if (kind === 'list') return { kind: 'list', pos, spanStart: pos, cls: name, items: [] }
  if (kind === 'dict') return { kind: 'dict', pos, spanStart: pos, cls: name, entries: [] }
  if (kind === 'set') return { kind: 'set', pos, spanStart: pos, cls: name, items: [] }
  return { kind: 'obj', pos, spanStart: pos, cls: name, items: [], entries: [] }
}

function className(value: PyVal | undefined): string {
  if (!value) return 'object'
  if (value.kind === 'cls' || value.kind === 'obj' || value.kind === 'list' || value.kind === 'dict' || value.kind === 'set') {
    return value.cls || 'object'
  }
  return 'object'
}

function asList(value: PyVal): PyVal {
  if (value.kind === 'list') return value
  value.kind = 'list'
  value.items ??= []
  return value
}

function asDict(value: PyVal): PyVal {
  if (value.kind === 'dict') return value
  value.kind = 'dict'
  value.entries ??= []
  return value
}

function asSet(value: PyVal): PyVal {
  if (value.kind === 'set') return value
  value.kind = 'set'
  value.items ??= []
  return value
}

function stringOf(value: PyVal | undefined): string | null {
  if (!value) return null
  if (value.kind === 'prim' && typeof value.prim === 'string') return value.prim
  return null
}

function noteStore(store: Map<string, PyVal>, key: PyVal, value: PyVal): void {
  const name = stringOf(key)
  if (name && name.startsWith('store.')) store.set(name, value)
}

function isIdent(text: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(text)
}

function appendPath(base: string, part: string, index: boolean): string {
  if (index) return `${base}[${part}]`
  if (isIdent(part)) return base ? `${base}.${part}` : part
  return `${base}[${JSON.stringify(part)}]`
}

function summaryOf(value: PyVal): string {
  if (value.kind === 'list') return `<list ${value.items?.length ?? 0} items>`
  if (value.kind === 'tuple') return `<tuple ${value.items?.length ?? 0} items>`
  if (value.kind === 'set') return `<set ${value.items?.length ?? 0} items>`
  if (value.kind === 'dict') return `<dict ${value.entries?.length ?? 0} keys>`
  if (value.kind === 'obj') return `<${value.cls || 'object'}>`
  if (value.kind === 'cls') return `<class ${value.cls || 'object'}>`
  if (value.kind === 'bytes') return `<bytes ${value.bytes?.length ?? 0}>`
  return String(value.prim)
}

function typeOf(value: PyVal): string {
  if (value.kind === 'list') return 'List'
  if (value.kind === 'tuple') return 'Tuple'
  if (value.kind === 'set') return 'Set'
  if (value.kind === 'dict') return 'Dict'
  if (value.kind === 'obj') return 'Object'
  if (value.kind === 'cls') return 'Class'
  if (value.kind === 'bytes') return 'Bytes'
  return value.op || 'Value'
}

function stateDict(value: PyVal): PyVal | null {
  const state = value.state
  if (!state) return null
  if (state.kind === 'dict') return state
  if (state.kind === 'tuple' && state.items?.[0]?.kind === 'dict') return state.items[0]
  return null
}

function childItems(value: PyVal): PyVal[] | null {
  if (value.kind === 'list' || value.kind === 'tuple' || value.kind === 'set') {
    if (value.items?.length) return value.items
  }
  return null
}

function childEntries(value: PyVal): [PyVal, PyVal][] | null {
  if (value.kind === 'dict') return value.entries || []
  const state = stateDict(value)
  if (state?.entries?.length) return state.entries
  if (value.entries?.length) return value.entries
  return null
}

function countLeaves(value: PyVal, depth: number, seen: WeakSet<object>, cap: number): number {
  if (depth > MAX_DEPTH) return cap
  if (value.kind === 'prim') return 1
  if (value.kind === 'bytes' || value.kind === 'cls') return 1
  if (seen.has(value)) return 0
  seen.add(value)
  const items = childItems(value)
  if (items) {
    if (items.every((item) => item.kind === 'prim')) return Math.min(items.length, cap)
    let n = 0
    for (const item of items) {
      n += countLeaves(item, depth + 1, seen, cap)
      if (n >= cap) return cap
    }
    return n
  }
  const entries = childEntries(value)
  if (entries) {
    let n = 0
    for (const [, item] of entries) {
      n += countLeaves(item, depth + 1, seen, cap)
      if (n >= cap) return cap
    }
    return n
  }
  return 1
}

function leafOf(path: string, opcode: string, arg: unknown, pos: number, meta?: FlattenMeta): StoreLeaf {
  return {
    name: path,
    opcode,
    arg,
    pos,
    ...(meta
      ? {
          group: meta.group,
          groupKind: meta.groupKind,
          field: meta.field,
          itemIndex: meta.itemIndex,
          itemStart: meta.itemStart,
          itemEnd: meta.itemEnd,
          insertPos: meta.insertPos
        }
      : {})
  }
}

function groupNameOf(path: string): string {
  return path.startsWith('store.') ? path.slice('store.'.length) : path
}

function flattenValue(
  value: PyVal,
  path: string,
  rows: StoreLeaf[],
  depth: number,
  seen: WeakSet<object>,
  meta?: FlattenMeta
): void {
  if (rows.length >= MAX_ROWS || depth > MAX_DEPTH) return
  if (value.kind === 'prim') {
    rows.push(leafOf(path, value.op || 'INT', value.prim ?? null, value.pos, meta))
    return
  }
  if (value.kind === 'bytes' || value.kind === 'cls') {
    rows.push(leafOf(path, typeOf(value), summaryOf(value), value.pos, meta))
    return
  }
  if (seen.has(value)) {
    rows.push(leafOf(path, typeOf(value), '<cycle>', value.pos, meta))
    return
  }
  seen.add(value)

  const items = childItems(value)
  if (items) {
    const group = groupNameOf(path)
    const spans = value.itemSpans || []
    const groupKind = value.kind === 'tuple' ? 'tuple' : 'list'
    for (let i = 0; i < items.length && rows.length < MAX_ROWS; i++) {
      const span = spans[i]
      flattenValue(items[i], appendPath(path, String(i), true), rows, depth + 1, seen, {
        group,
        groupKind,
        itemIndex: i,
        itemStart: span?.start,
        itemEnd: span?.end,
        insertPos: value.insertPos
      })
    }
    return
  }

  const entries = childEntries(value)
  if (entries) {
    const nestedGroup = groupNameOf(path)
    const nestedKind = value.kind === 'dict' ? 'dict' : 'object'
    const insideList = meta?.groupKind === 'list' || meta?.groupKind === 'tuple'
    for (const [key, item] of entries) {
      if (rows.length >= MAX_ROWS) return
      const text = stringOf(key)
      const next = text == null ? appendPath(path, '?', true) : appendPath(path, text, false)
      flattenValue(item, next, rows, depth + 1, seen, {
        group: insideList ? meta!.group : nestedGroup,
        groupKind: insideList ? meta!.groupKind! : nestedKind,
        field: text || '?',
        itemIndex: meta?.itemIndex,
        itemStart: meta?.itemStart,
        itemEnd: meta?.itemEnd,
        insertPos: meta?.insertPos
      })
    }
    return
  }

  rows.push(leafOf(path, typeOf(value), summaryOf(value), value.pos, meta))
}

export function flattenStoreMap(store: Map<string, PyVal>): StoreLeaf[] {
  const rows: StoreLeaf[] = []
  for (const [name, value] of store) {
    if (rows.length >= MAX_ROWS) break
    const leaves = countLeaves(value, 0, new WeakSet(), MAX_LEAVES_PER_VAR + 1)
    const primList = childItems(value)?.every((item) => item.kind === 'prim')
    if (!primList && (leaves === 0 || leaves > MAX_LEAVES_PER_VAR)) {
      const group = groupNameOf(name)
      const groupKind = value.kind === 'list' || value.kind === 'tuple' ? 'list' : value.kind === 'dict' ? 'dict' : value.kind === 'obj' ? 'object' : undefined
      rows.push(
        leafOf(name, typeOf(value), summaryOf(value), value.pos, groupKind ? { group, groupKind, insertPos: value.insertPos } : undefined)
      )
      continue
    }
    const group = groupNameOf(name)
    const rootMeta: FlattenMeta | undefined =
      value.kind === 'list' || value.kind === 'tuple'
        ? { group, groupKind: value.kind === 'tuple' ? 'tuple' : 'list', insertPos: value.insertPos }
        : value.kind === 'dict'
          ? { group, groupKind: 'dict' }
          : value.kind === 'obj'
            ? { group, groupKind: 'object' }
            : undefined
    flattenValue(value, name, rows, 0, new WeakSet(), rootMeta)
  }
  return rows
}

function pop(stack: StackItem[]): PyVal {
  const value = stack.pop()
  if (!value || value === MARK) throw new Error('Pickle stack underflow.')
  return value
}

function tos(stack: StackItem[]): PyVal {
  const value = stack[stack.length - 1]
  if (!value || value === MARK) throw new Error('Pickle stack underflow.')
  return value
}

function popMark(stack: StackItem[]): PyVal[] {
  const items: PyVal[] = []
  while (stack.length) {
    const value = stack.pop()
    if (value === MARK) break
    if (value) items.push(value)
  }
  items.reverse()
  return items
}

function tupleOf(items: PyVal[], pos: number): PyVal {
  const start = items.reduce((min, item) => Math.min(min, slotStart(item, pos)), pos)
  return { kind: 'tuple', pos, spanStart: start, items }
}

function recordItemSpans(list: PyVal, items: PyVal[], endPos: number): void {
  const spans: ItemSpan[] = []
  for (let i = 0; i < items.length; i++) {
    const start = slotStart(items[i], endPos)
    const end = i + 1 < items.length ? slotStart(items[i + 1], endPos) : endPos
    if (end > start) spans.push({ start, end })
    else spans.push({ start, end: start })
  }
  list.itemSpans = [...(list.itemSpans || []), ...spans]
  list.insertPos = endPos
}

function reduce(fn: PyVal, args: PyVal, pos: number): PyVal {
  const name = className(fn)
  const argItems = args.kind === 'tuple' ? args.items || [] : [args]
  if (name.includes('_reconstructor') && argItems[0]) return makeContainer(pos, className(argItems[0]))
  const result = makeContainer(pos, name)
  if (result.kind === 'set' || result.kind === 'list') {
    const src = argItems[0]
    if (src?.items) result.items = [...src.items]
    else if (src?.kind === 'prim') result.items = [src]
  } else if (result.kind === 'dict') {
    const src = argItems[0]
    if (src?.entries) result.entries = [...src.entries]
  } else {
    result.items = argItems
  }
  return result
}

export function collectStoreValues(buf: Buffer): Map<string, PyVal> {
  const ops = genops(buf)
  const stack: StackItem[] = []
  const memo = new Map<number, PyVal>()
  const store = new Map<string, PyVal>()

  const push = (value: PyVal): void => {
    stack.push(value)
  }

  const memoGet = (id: number, pos: number): PyVal => {
    const value = memo.get(id)
    if (!value) return prim('BINGET', pos, id)
    return { ...value, spanStart: pos }
  }

  const memoPut = (id: number): void => {
    const tos = stack[stack.length - 1]
    if (tos && tos !== MARK) memo.set(id, tos)
  }

  for (const op of ops) {
    switch (op.name) {
      case 'PROTO':
      case 'FRAME':
      case 'STOP':
      case 'NEXT_BUFFER':
      case 'READONLY_BUFFER':
        break
      case 'MARK':
        stack.push(MARK)
        break
      case 'POP':
        stack.pop()
        break
      case 'POP_MARK':
        popMark(stack)
        break
      case 'DUP': {
        const tos = stack[stack.length - 1]
        if (tos && tos !== MARK) stack.push(tos)
        break
      }
      case 'NONE':
        push(prim('NONE', op.pos, null))
        break
      case 'NEWTRUE':
        push(prim('NEWTRUE', op.pos, true))
        break
      case 'NEWFALSE':
        push(prim('NEWFALSE', op.pos, false))
        break
      case 'BININT1':
      case 'BININT2':
      case 'BININT':
      case 'BINFLOAT':
      case 'FLOAT':
      case 'LONG1':
      case 'LONG4':
      case 'LONG':
      case 'INT':
        if (typeof op.arg === 'boolean') push(prim(op.name, op.pos, op.arg))
        else if (typeof op.arg === 'number') push(prim(op.name, op.pos, op.arg))
        else push(prim(op.name, op.pos, Number(op.arg)))
        break
      case 'SHORT_BINUNICODE':
      case 'BINUNICODE':
      case 'BINUNICODE8':
      case 'UNICODE':
      case 'SHORT_BINSTRING':
      case 'BINSTRING':
      case 'STRING':
        push(prim(op.name, op.pos, typeof op.arg === 'string' ? op.arg : String(op.arg ?? '')))
        break
      case 'BINBYTES':
      case 'SHORT_BINBYTES':
      case 'BINBYTES8':
      case 'BYTEARRAY8':
        push(bytesVal(op.name, op.pos, Buffer.isBuffer(op.arg) ? op.arg : Buffer.alloc(0)))
        break
      case 'EMPTY_LIST':
        push({ kind: 'list', pos: op.pos, spanStart: op.pos, items: [] })
        break
      case 'EMPTY_DICT':
        push({ kind: 'dict', pos: op.pos, spanStart: op.pos, entries: [] })
        break
      case 'EMPTY_TUPLE':
        push(tupleOf([], op.pos))
        break
      case 'EMPTY_SET':
        push({ kind: 'set', pos: op.pos, spanStart: op.pos, items: [] })
        break
      case 'TUPLE1':
        push(tupleOf([pop(stack)], op.pos))
        break
      case 'TUPLE2': {
        const b = pop(stack)
        const a = pop(stack)
        push(tupleOf([a, b], op.pos))
        break
      }
      case 'TUPLE3': {
        const c = pop(stack)
        const b = pop(stack)
        const a = pop(stack)
        push(tupleOf([a, b, c], op.pos))
        break
      }
      case 'TUPLE':
        push(tupleOf(popMark(stack), op.pos))
        break
      case 'LIST':
        push({ kind: 'list', pos: op.pos, spanStart: op.pos, items: popMark(stack) })
        break
      case 'DICT': {
        const items = popMark(stack)
        const entries: [PyVal, PyVal][] = []
        for (let i = 0; i + 1 < items.length; i += 2) {
          entries.push([items[i], items[i + 1]])
          noteStore(store, items[i], items[i + 1])
        }
        push({ kind: 'dict', pos: op.pos, spanStart: op.pos, entries })
        break
      }
      case 'FROZENSET':
        push({ kind: 'set', pos: op.pos, spanStart: op.pos, items: popMark(stack) })
        break
      case 'APPEND': {
        const item = pop(stack)
        const list = asList(tos(stack))
        const start = slotStart(item, op.pos)
        list.itemSpans ??= []
        list.itemSpans.push({ start, end: op.pos + 1 })
        list.items!.push(item)
        break
      }
      case 'APPENDS': {
        const items = popMark(stack)
        const list = asList(tos(stack))
        recordItemSpans(list, items, op.pos)
        list.items!.push(...items)
        break
      }
      case 'ADDITEMS': {
        const items = popMark(stack)
        asSet(tos(stack)).items!.push(...items)
        break
      }
      case 'SETITEM': {
        const value = pop(stack)
        const key = pop(stack)
        asDict(tos(stack)).entries!.push([key, value])
        noteStore(store, key, value)
        break
      }
      case 'SETITEMS': {
        const items = popMark(stack)
        const dict = asDict(tos(stack))
        for (let i = 0; i + 1 < items.length; i += 2) {
          dict.entries!.push([items[i], items[i + 1]])
          noteStore(store, items[i], items[i + 1])
        }
        break
      }
      case 'GLOBAL':
      case 'INST':
        push(cls(op.pos, typeof op.arg === 'string' ? op.arg : String(op.arg ?? 'object')))
        break
      case 'STACK_GLOBAL': {
        const name = stringOf(pop(stack)) || 'object'
        const mod = stringOf(pop(stack)) || ''
        push(cls(op.pos, mod ? `${mod} ${name}` : name))
        break
      }
      case 'NEWOBJ':
      case 'OBJ': {
        const args = op.name === 'NEWOBJ' ? pop(stack) : tupleOf(popMark(stack), op.pos)
        const ctor = pop(stack)
        const obj = makeContainer(op.pos, className(ctor))
        obj.spanStart = Math.min(slotStart(ctor, op.pos), slotStart(args, op.pos), op.pos)
        push(obj)
        break
      }
      case 'NEWOBJ_EX': {
        const kwargs = pop(stack)
        const args = pop(stack)
        const ctor = pop(stack)
        const obj = makeContainer(op.pos, className(ctor))
        obj.spanStart = Math.min(slotStart(ctor, op.pos), slotStart(args, op.pos), slotStart(kwargs, op.pos), op.pos)
        push(obj)
        break
      }
      case 'REDUCE': {
        const args = pop(stack)
        const fn = pop(stack)
        const obj = reduce(fn, args, op.pos)
        obj.spanStart = Math.min(slotStart(fn, op.pos), slotStart(args, op.pos), op.pos)
        push(obj)
        break
      }
      case 'BUILD': {
        const state = pop(stack)
        const obj = tos(stack)
        obj.state = state
        if (obj.kind === 'dict' && state.kind === 'dict' && state.entries && !obj.entries?.length) {
          obj.entries = state.entries
        }
        break
      }
      case 'BINPUT':
      case 'LONG_BINPUT':
        memoPut(Number(op.arg))
        break
      case 'PUT':
        memoPut(Number(op.arg))
        break
      case 'MEMOIZE':
        memoPut(memo.size)
        break
      case 'BINGET':
      case 'LONG_BINGET':
        push(memoGet(Number(op.arg), op.pos))
        break
      case 'GET':
        push(memoGet(Number(op.arg), op.pos))
        break
      case 'PERSID':
        push(prim('PERSID', op.pos, typeof op.arg === 'string' ? op.arg : ''))
        break
      case 'BINPERSID':
        pop(stack)
        push(prim('BINPERSID', op.pos, null))
        break
      case 'EXT1':
      case 'EXT2':
      case 'EXT4':
        push(prim(op.name, op.pos, Number(op.arg)))
        break
      default:
        break
    }
    if (op.name === 'STOP') break
  }
  return store
}

export function parseStoreLeaves(buf: Buffer): StoreLeaf[] | null {
  try {
    const store = collectStoreValues(buf)
    if (!store.size) return null
    return flattenStoreMap(store)
  } catch {
    return null
  }
}
