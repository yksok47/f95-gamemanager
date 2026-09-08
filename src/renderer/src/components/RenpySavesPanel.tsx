import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react'
import type { GameLibraryFile, RenpySaveFile } from '@shared/types'
import { formatDateTime } from '@shared/updates'
import { formatBytes } from '../lib/downloads'
import { useRenpySession } from '../lib/renpy'

type RenpySavesPanelProps = {
  files: GameLibraryFile[]
  title?: string
}

type DragSave = { kind: 'save'; path: string; page: string; slot: number }
type DragPage = { kind: 'page'; page: string }
type DragItem = DragSave | DragPage

type PageBoard = {
  page: string
  label: string
  slots: Array<{ slot: number; save: RenpySaveFile | null }>
}

type DragSession =
  | { phase: 'pending'; pointerId: number; x: number; y: number; item: DragItem; label: string }
  | { phase: 'live'; pointerId: number; item: DragItem; label: string; x: number; y: number }

const DRAG_THRESHOLD = 8
const AUTO_SLOT_COUNT = 10
const DEFAULT_SLOT_COUNT = 6

function blurActive(): void {
  const active = document.activeElement
  if (active instanceof HTMLElement) active.blur()
}

function keepScrollOnMouse(event: { preventDefault: () => void }): void {
  event.preventDefault()
}

function saveTitle(save: RenpySaveFile): string {
  return save.saveName || save.label
}

function canPlace(save: RenpySaveFile): boolean {
  return (save.kind === 'slot' || save.kind === 'auto' || save.kind === 'quick') && save.slot != null
}

function detectedSlotCount(saves: RenpySaveFile[]): number {
  let max = 0
  for (const save of saves) {
    if (save.kind === 'auto' || save.page === 'auto') continue
    if (canPlace(save) && save.slot != null) max = Math.max(max, save.slot)
  }
  return max || DEFAULT_SLOT_COUNT
}

function lastNumberedPage(saves: RenpySaveFile[]): number {
  let last = 0
  for (const save of saves) {
    if (save.kind === 'slot' && /^\d+$/.test(save.page)) last = Math.max(last, Number(save.page))
  }
  return last
}

function savesByPlace(saves: RenpySaveFile[]): Map<string, RenpySaveFile> {
  const map = new Map<string, RenpySaveFile>()
  for (const save of saves) {
    if (!canPlace(save) || save.slot == null) continue
    map.set(`${save.page}:${save.slot}`, save)
  }
  return map
}

function makeSlots(
  page: string,
  slotCount: number,
  placed: Map<string, RenpySaveFile>
): PageBoard['slots'] {
  const slots: PageBoard['slots'] = []
  for (let slot = 1; slot <= slotCount; slot++) {
    slots.push({ slot, save: placed.get(`${page}:${slot}`) ?? null })
  }
  return slots
}

function buildBoards(saves: RenpySaveFile[], slotCount: number): PageBoard[] {
  const placed = savesByPlace(saves)
  const last = lastNumberedPage(saves)
  const boards: PageBoard[] = [
    { page: 'auto', label: 'Auto', slots: makeSlots('auto', AUTO_SLOT_COUNT, placed) },
    { page: 'quick', label: 'Quick', slots: makeSlots('quick', slotCount, placed) }
  ]
  for (let page = 1; page <= last + 1; page++) {
    boards.push({
      page: String(page),
      label: `Page ${page}`,
      slots: makeSlots(String(page), slotCount, placed)
    })
  }
  return boards
}

function boardFilled(board: PageBoard): RenpySaveFile[] {
  return board.slots.flatMap((item) => (item.save ? [item.save] : []))
}

function boardEmpty(board: PageBoard): boolean {
  return board.slots.every((item) => !item.save)
}

function hitTarget(
  x: number,
  y: number,
  item: DragItem
): { kind: 'slot'; page: string; slot: number } | { kind: 'page'; page: string } | null {
  const node = document.elementFromPoint(x, y)
  if (!(node instanceof Element)) return null
  if (item.kind === 'save') {
    const slot = node.closest('[data-save-drop="slot"]')
    if (!(slot instanceof HTMLElement)) return null
    const page = slot.dataset.page
    const nextSlot = Number(slot.dataset.slot)
    if (!page || !Number.isInteger(nextSlot)) return null
    return { kind: 'slot', page, slot: nextSlot }
  }
  const pageEl = node.closest('[data-save-drop="page"]')
  if (!(pageEl instanceof HTMLElement) || !pageEl.dataset.page) return null
  return { kind: 'page', page: pageEl.dataset.page }
}

function SaveThumb({ url }: { url?: string }): JSX.Element {
  const [broken, setBroken] = useState(false)
  if (!url || broken) return <div className="save-tile-shot save-tile-empty" aria-hidden="true" />
  return (
    <img
      className="save-tile-shot"
      src={url}
      alt=""
      draggable={false}
      onError={() => setBroken(true)}
    />
  )
}

function PageCheck({
  label,
  count,
  checked,
  indeterminate,
  disabled,
  onToggle
}: {
  label: string
  count: number
  checked: boolean
  indeterminate: boolean
  disabled?: boolean
  onToggle: () => void
}): JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked
  }, [checked, indeterminate])
  return (
    <label className="save-page-check" onMouseDown={keepScrollOnMouse}>
      <input
        ref={ref}
        type="checkbox"
        tabIndex={-1}
        checked={checked}
        disabled={disabled}
        onChange={onToggle}
      />
      <span>{label}</span>
      <span className="muted">{count}</span>
    </label>
  )
}

export default function RenpySavesPanel({ files, title = '' }: RenpySavesPanelProps): JSX.Element {
  const { installed, activeId, lookupTitle, setFileId, info, error, setError, busy, running, withInfo } =
    useRenpySession(files, { title })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [slotsInput, setSlotsInput] = useState<number | null>(null)
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [ghost, setGhost] = useState<string | null>(null)
  const skipClick = useRef(false)
  const sessionRef = useRef<DragSession | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const ghostPos = useRef({ x: 0, y: 0 })
  const panelRef = useRef<HTMLDivElement>(null)
  const lockScroll = useRef<number | null>(null)
  const logicRef = useRef({
    boards: [] as PageBoard[],
    busy: false,
    running: false,
    occupied: new Map<string, RenpySaveFile>(),
    moveSave: async (_page: string, _slot: number, _item: DragSave): Promise<void> => {},
    movePage: async (_page: string, _item: DragPage): Promise<void> => {}
  })
  const saves = info?.saves ?? []
  const detectedSlots = useMemo(() => detectedSlotCount(saves), [saves])
  const slotsPerPage = Math.max(detectedSlots, slotsInput ?? detectedSlots)
  const boards = useMemo(() => buildBoards(saves, slotsPerPage), [saves, slotsPerPage])
  const leftovers = useMemo(
    () => saves.filter((save) => save.kind === 'persistent' || save.kind === 'other'),
    [saves]
  )

  function allowSaveDrop(page: string, slot: number, item: DragItem | null): boolean {
    if (!item || item.kind !== 'save' || busy || running) return false
    if (item.page === page && item.slot === slot) return false
    return !savesByPlace(saves).has(`${page}:${slot}`)
  }

  function allowPageDrop(page: string, board: PageBoard, item: DragItem | null): boolean {
    if (!item || item.kind !== 'page' || busy || running) return false
    if (item.page === page) return false
    return boardEmpty(board)
  }

  function freezeModalScroll(): void {
    blurActive()
    const modal = panelRef.current?.closest('.details-modal')
    if (modal instanceof HTMLElement) lockScroll.current = modal.scrollTop
  }

  useLayoutEffect(() => {
    const top = lockScroll.current
    if (top == null) return
    const modal = panelRef.current?.closest('.details-modal')
    if (modal instanceof HTMLElement) modal.scrollTop = top
    lockScroll.current = null
  })

  logicRef.current = {
    boards,
    busy,
    running,
    occupied: savesByPlace(saves),
    moveSave: async (page, slot, item) => {
      if (!allowSaveDrop(page, slot, item)) return
      await withInfo(() => window.api.renpy.moveSave(activeId, item.path, page, slot, lookupTitle))
    },
    movePage: async (page, item) => {
      const board = boards.find((entry) => entry.page === page)
      if (!board || !allowPageDrop(page, board, item)) return
      await withInfo(() => window.api.renpy.renumberPage(activeId, item.page, page, lookupTitle))
      setSelected(new Set())
    }
  }

  useEffect(() => {
    setSelected(new Set())
    setSlotsInput(null)
    setDrag(null)
    setOver(null)
    setGhost(null)
    sessionRef.current = null
    document.body.classList.remove('is-save-dragging')
  }, [activeId])

  useEffect(() => {
    const valid = new Set(saves.map((save) => save.path))
    setSelected((current) => {
      let changed = false
      const next = new Set<string>()
      for (const path of current) {
        if (valid.has(path)) next.add(path)
        else changed = true
      }
      return changed ? next : current
    })
  }, [saves])

  useEffect(() => {
    function placeGhost(x: number, y: number): void {
      ghostPos.current = { x, y }
      const node = ghostRef.current
      if (node) node.style.transform = `translate(${x + 12}px, ${y + 12}px)`
    }

    function overKey(x: number, y: number, item: DragItem): string | null {
      const hit = hitTarget(x, y, item)
      if (!hit) return null
      if (hit.kind === 'slot') {
        if (item.kind !== 'save' || (item.page === hit.page && item.slot === hit.slot)) return null
        if (logicRef.current.occupied.has(`${hit.page}:${hit.slot}`)) return null
        return `${hit.page}:${hit.slot}`
      }
      if (item.kind !== 'page' || item.page === hit.page) return null
      const board = logicRef.current.boards.find((entry) => entry.page === hit.page)
      if (!board || !boardEmpty(board)) return null
      return `page:${hit.page}`
    }

    function stopLive(): void {
      sessionRef.current = null
      document.body.classList.remove('is-save-dragging')
      setDrag(null)
      setOver(null)
      setGhost(null)
    }

    function onMove(event: PointerEvent): void {
      const session = sessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      if (session.phase === 'pending') {
        const dx = event.clientX - session.x
        const dy = event.clientY - session.y
        if (dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return
        skipClick.current = true
        sessionRef.current = {
          phase: 'live',
          pointerId: session.pointerId,
          item: session.item,
          label: session.label,
          x: event.clientX,
          y: event.clientY
        }
        freezeModalScroll()
        document.body.classList.add('is-save-dragging')
        placeGhost(event.clientX, event.clientY)
        setDrag(session.item)
        setGhost(session.label)
        setOver(overKey(event.clientX, event.clientY, session.item))
        return
      }
      if (event.cancelable) event.preventDefault()
      session.x = event.clientX
      session.y = event.clientY
      placeGhost(event.clientX, event.clientY)
      const next = overKey(event.clientX, event.clientY, session.item)
      setOver((current) => (current === next ? current : next))
    }

    function onUp(event: PointerEvent): void {
      const session = sessionRef.current
      if (!session || session.pointerId !== event.pointerId) return
      if (session.phase !== 'live') {
        sessionRef.current = null
        return
      }
      const hit = hitTarget(event.clientX, event.clientY, session.item)
      const item = session.item
      stopLive()
      if (!hit) return
      if (item.kind === 'save' && hit.kind === 'slot') {
        void logicRef.current.moveSave(hit.page, hit.slot, item)
        return
      }
      if (item.kind === 'page' && hit.kind === 'page') {
        void logicRef.current.movePage(hit.page, item)
      }
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && sessionRef.current) stopLive()
    }

    function onWheel(): void {
      const session = sessionRef.current
      if (!session || session.phase !== 'live') return
      const next = overKey(session.x, session.y, session.item)
      setOver((current) => (current === next ? current : next))
    }

    window.addEventListener('pointermove', onMove, { passive: false })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    window.addEventListener('keydown', onKey)
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
      document.body.classList.remove('is-save-dragging')
    }
  }, [])

  function togglePath(path: string): void {
    freezeModalScroll()
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function setPaths(paths: string[], on: boolean): void {
    freezeModalScroll()
    setSelected((current) => {
      const next = new Set(current)
      for (const path of paths) {
        if (on) next.add(path)
        else next.delete(path)
      }
      return next
    })
  }

  async function deleteSelected(): Promise<void> {
    const paths = [...selected]
    if (!paths.length) return
    const noun = paths.length === 1 ? 'save' : 'saves'
    if (!window.confirm(`Delete ${paths.length} ${noun}?`)) return
    await withInfo(() => window.api.renpy.deleteSaves(activeId, paths, lookupTitle))
    setSelected(new Set())
  }

  function toggleSave(path: string): void {
    if (skipClick.current) {
      skipClick.current = false
      return
    }
    togglePath(path)
  }

  function beginDrag(event: ReactPointerEvent, item: DragItem, label: string): void {
    if (event.button !== 0 || busy || running) return
    if ((event.target as HTMLElement).closest('input, button, a, select')) return
    sessionRef.current = {
      phase: 'pending',
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      item,
      label
    }
  }

  if (!installed.length && !files.length && !title) {
    return (
      <p className="muted">Install a Ren&apos;Py build from the Files tab to manage saves.</p>
    )
  }

  return (
    <div className="renpy-panel" ref={panelRef}>
      {ghost ? (
        <div
          ref={ghostRef}
          className="save-drag-ghost"
          style={{ transform: `translate(${ghostPos.current.x + 12}px, ${ghostPos.current.y + 12}px)` }}
        >
          {ghost}
        </div>
      ) : null}
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

      {error ? <p className="error-text">{error}</p> : null}
      {info?.message ? <p className="muted">{info.message}</p> : null}

      <section className="renpy-section">
        <div className="renpy-section-head">
          <h2>Saves</h2>
          <label className="save-slots-field">
            <span className="muted">Slots per page</span>
            <input
              className="save-place-input"
              type="number"
              min={detectedSlots}
              step={1}
              value={slotsPerPage}
              disabled={busy || running}
              onChange={(event) => {
                const next = Number(event.target.value)
                if (!Number.isInteger(next) || next < 1) return
                setSlotsInput(Math.max(detectedSlots, next))
              }}
              onMouseDown={(event) => event.stopPropagation()}
            />
          </label>
          <div className="renpy-actions">
            <button
              className="stop-btn"
              type="button"
              disabled={busy || running || selected.size === 0}
              onClick={() => void deleteSelected()}
            >
              {selected.size ? `Delete selected (${selected.size})` : 'Delete selected'}
            </button>
            <button
              className="ghost-btn"
              type="button"
              disabled={busy || running || !info?.savePath}
              onClick={() =>
                void window.api.renpy.openSaves(activeId, lookupTitle).catch((err) => {
                  setError(err instanceof Error ? err.message : 'Could not open the save folder.')
                })
              }
            >
              Open folder
            </button>
            <button
              className="ghost-btn"
              type="button"
              disabled={busy || running}
              onClick={() => void withInfo(() => window.api.renpy.info(activeId, false, lookupTitle))}
            >
              Refresh
            </button>
          </div>
        </div>
        {info?.savePath ? (
          <p className="muted library-file-meta" title={info.savePath}>
            {info.savePath}
            {info.savePathExists ? ` · ${formatBytes(info.saveFolderBytes)}` : ''}
          </p>
        ) : null}
        {busy && !info ? (
          <p className="muted">Reading save location…</p>
        ) : info?.savePath ? (
          <div className="save-pages">
            {boards.map((board) => {
              const filled = boardFilled(board)
              const paths = filled.map((save) => save.path)
              const selectedCount = paths.filter((path) => selected.has(path)).length
              const empty = boardEmpty(board)
              const pageDrop = allowPageDrop(board.page, board, drag)
              const pageOver = over === `page:${board.page}`
              return (
                <section
                  key={board.page}
                  className={[
                    'save-page',
                    empty ? 'is-empty' : '',
                    pageOver && pageDrop ? 'is-drop' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-save-drop="page"
                  data-page={board.page}
                >
                  <header className="save-page-head">
                    <PageCheck
                      label={board.label}
                      count={filled.length}
                      checked={selectedCount === paths.length && paths.length > 0}
                      indeterminate={selectedCount > 0 && selectedCount < paths.length}
                      disabled={busy || running || !paths.length}
                      onToggle={() => setPaths(paths, selectedCount !== paths.length)}
                    />
                    {filled.length ? (
                      <span
                        className="save-page-handle"
                        title="Drag this page onto an empty page"
                        onMouseDown={keepScrollOnMouse}
                        onPointerDown={(event) =>
                          beginDrag(event, { kind: 'page', page: board.page }, board.label)
                        }
                      >
                        Drag page
                      </span>
                    ) : (
                      <span className="muted">Empty page</span>
                    )}
                  </header>
                  <div className="save-grid">
                    {board.slots.map((item) => {
                      const save = item.save
                      const slotOver = over === `${board.page}:${item.slot}`
                      const canDrop = allowSaveDrop(board.page, item.slot, drag)
                      if (!save) {
                        return (
                          <div
                            key={item.slot}
                            className={
                              slotOver && canDrop ? 'save-slot save-slot-empty is-drop' : 'save-slot save-slot-empty'
                            }
                            data-save-drop="slot"
                            data-page={board.page}
                            data-slot={String(item.slot)}
                          >
                            <span>Slot {item.slot}</span>
                          </div>
                        )
                      }
                      const checked = selected.has(save.path)
                      const when = formatDateTime(save.savedAt || save.modifiedAt)
                      const dragging = drag?.kind === 'save' && drag.path === save.path
                      return (
                        <article
                          key={save.path}
                          className={[
                            'save-tile',
                            checked ? 'is-selected' : '',
                            dragging ? 'is-dragging' : ''
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          title={save.name}
                          onMouseDown={keepScrollOnMouse}
                          onPointerDown={(event) => {
                            if (save.slot == null) return
                            beginDrag(
                              event,
                              { kind: 'save', path: save.path, page: save.page, slot: save.slot },
                              saveTitle(save)
                            )
                          }}
                          onClick={() => toggleSave(save.path)}
                        >
                          <SaveThumb url={save.thumbnailUrl} />
                          <div className="save-tile-overlay">
                            <div className="save-tile-top">
                              <input
                                type="checkbox"
                                tabIndex={-1}
                                checked={checked}
                                disabled={busy || running}
                                aria-label={`Select ${saveTitle(save)}`}
                                onClick={(event) => event.stopPropagation()}
                                onMouseDown={keepScrollOnMouse}
                                onPointerDown={(event) => event.stopPropagation()}
                                onChange={() => togglePath(save.path)}
                              />
                              <span className="save-tile-slot">Slot {item.slot}</span>
                            </div>
                            <div className="save-tile-meta">
                              {save.saveName ? <strong>{save.saveName}</strong> : null}
                              {save.gameVersion ? <span>{save.gameVersion}</span> : null}
                              {when ? <span>{when}</span> : null}
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              )
            })}
            {leftovers.length ? (
              <section className="save-page">
                <header className="save-page-head">
                  <PageCheck
                    label="Other"
                    count={leftovers.length}
                    checked={leftovers.every((save) => selected.has(save.path))}
                    indeterminate={
                      leftovers.some((save) => selected.has(save.path)) &&
                      !leftovers.every((save) => selected.has(save.path))
                    }
                    disabled={busy || running}
                    onToggle={() => {
                      const leftoverPaths = leftovers.map((save) => save.path)
                      const all = leftoverPaths.every((path) => selected.has(path))
                      setPaths(leftoverPaths, !all)
                    }}
                  />
                </header>
                <div className="save-grid">
                  {leftovers.map((save) => {
                    const checked = selected.has(save.path)
                    const when = formatDateTime(save.savedAt || save.modifiedAt)
                    return (
                      <article
                        key={save.path}
                        className={checked ? 'save-tile is-selected' : 'save-tile'}
                        title={save.name}
                        onMouseDown={keepScrollOnMouse}
                        onClick={() => togglePath(save.path)}
                      >
                        <SaveThumb url={save.thumbnailUrl} />
                        <div className="save-tile-overlay">
                          <div className="save-tile-top">
                            <input
                              type="checkbox"
                              tabIndex={-1}
                              checked={checked}
                              disabled={busy || running}
                              aria-label={`Select ${saveTitle(save)}`}
                              onClick={(event) => event.stopPropagation()}
                              onMouseDown={keepScrollOnMouse}
                              onChange={() => togglePath(save.path)}
                            />
                            <span className="save-tile-slot">{save.label}</span>
                          </div>
                          <div className="save-tile-meta">
                            {when ? <span>{when}</span> : null}
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              </section>
            ) : null}
          </div>
        ) : info?.message ? null : (
          <p className="muted">
            {info?.savePathExists ? 'No save files in that folder yet.' : 'No save files found.'}
          </p>
        )}
      </section>
    </div>
  )
}
