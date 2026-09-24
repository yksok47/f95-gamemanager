import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent
} from 'react'
import { createPortal } from 'react-dom'
import { confirm } from './ConfirmDialog'
import type { GameLibraryFile, RenpySaveFile } from '@shared/types'
import { formatDateTime } from '@shared/updates'
import { formatBytes } from '../lib/downloads'
import { cloudFolderKey, filesForSaveFolder, isPersistentSaveName, useCloudSavesForThread } from '../lib/cloud-saves'
import { useRenpySession } from '../lib/renpy'
import GameCloudSaves, { GameCloudSaveActions } from './GameCloudSaves'
import RenpySaveEditorDialog from './RenpySaveEditorDialog'
import SavesDeleteSelectedFab from './SavesDeleteSelectedFab'
import SavesPanelTabs, { SavesActionButton, type SavesPanelView } from './SavesPanelTabs'
import { InlineLoading } from './Spinner'

type RenpySavesPanelProps = {
  files: GameLibraryFile[]
  title?: string
  threadId?: number
}

type DragSave = { kind: 'save'; path: string; page: string; slot: number }
type DragPage = { kind: 'page'; page: string }
type DragItem = DragSave | DragPage

type PageBoard = {
  page: string
  label: string
  slots: Array<{ slot: number; save: RenpySaveFile | null }>
}

type DragGhost =
  | { kind: 'save'; save: RenpySaveFile; slot: number; width: number; height: number }
  | { kind: 'page'; label: string }

type DragSession =
  | {
      phase: 'pending'
      pointerId: number
      x: number
      y: number
      item: DragItem
      ghost: DragGhost
      grabX: number
      grabY: number
    }
  | {
      phase: 'live'
      pointerId: number
      item: DragItem
      ghost: DragGhost
      x: number
      y: number
      grabX: number
      grabY: number
    }

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

function cloudPlace(name: string): { page: string; slot: number } | null {
  const auto = name.match(/^(auto|quick)-(\d+)/i)
  if (auto) return { page: auto[1].toLowerCase(), slot: Number(auto[2]) }
  const paged = name.match(/^(\d+)-(\d+)/)
  if (paged) return { page: String(Number(paged[1])), slot: Number(paged[2]) }
  const only = name.match(/^(\d+)\.save$/i)
  if (only) return { page: '1', slot: Number(only[1]) }
  return null
}

function lastCloudPage(names: Iterable<string>): number {
  let last = 0
  for (const name of names) {
    const place = cloudPlace(name)
    if (place && /^\d+$/.test(place.page)) last = Math.max(last, Number(place.page))
  }
  return last
}

function maxCloudSlot(names: Iterable<string>): number {
  let max = 0
  for (const name of names) {
    const place = cloudPlace(name)
    if (!place || place.page === 'auto') continue
    max = Math.max(max, place.slot)
  }
  return max
}

function cloudByPlace(names: Iterable<string>): Map<string, string> {
  const map = new Map<string, string>()
  for (const name of names) {
    const place = cloudPlace(name)
    if (!place) continue
    map.set(`${place.page}:${place.slot}`, name)
  }
  return map
}

function folderName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() || path
}

function sameSavePath(a: string, b: string): boolean {
  return a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()
}

function saveLocationLabel(
  locations: Array<{ savePath: string; folderName: string }>,
  item: { savePath: string; folderName: string }
): string {
  const name = item.folderName || folderName(item.savePath)
  const clashes = locations.filter(
    (entry) => (entry.folderName || folderName(entry.savePath)).toLowerCase() === name.toLowerCase()
  )
  return clashes.length > 1 ? item.savePath : name
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

function buildBoards(saves: RenpySaveFile[], slotCount: number, lastPage: number): PageBoard[] {
  const placed = savesByPlace(saves)
  const boards: PageBoard[] = [
    { page: 'auto', label: 'Auto', slots: makeSlots('auto', AUTO_SLOT_COUNT, placed) },
    { page: 'quick', label: 'Quick', slots: makeSlots('quick', slotCount, placed) }
  ]
  for (let page = 1; page <= lastPage + 1; page++) {
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

function SaveThumb({ url, eager }: { url?: string; eager?: boolean }): JSX.Element {
  const ref = useRef<HTMLElement | null>(null)
  const [visible, setVisible] = useState(Boolean(eager && url))
  const [broken, setBroken] = useState(false)

  useEffect(() => {
    setBroken(false)
    setVisible(Boolean(eager && url))
    if (!url || eager) return
    const node = ref.current
    if (!node) return
    const root = node.closest('.details-modal')
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        setVisible(true)
        io.disconnect()
      },
      { root: root instanceof Element ? root : null, rootMargin: '160px' }
    )
    io.observe(node)
    return () => io.disconnect()
  }, [eager, url])

  function bindRef(node: HTMLElement | null): void {
    ref.current = node
  }

  if (!url || broken || !visible) {
    return <div ref={bindRef} className="save-tile-shot save-tile-empty" aria-hidden="true" />
  }
  return (
    <img
      ref={bindRef}
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

export default function RenpySavesPanel({
  files,
  title = '',
  threadId = 0
}: RenpySavesPanelProps): JSX.Element {
  const {
    installed,
    activeId,
    lookupTitle,
    threadId: lookupThreadId,
    setFileId,
    info,
    setError,
    busy,
    running,
    withInfo
  } = useRenpySession(files, { title, threadId, scope: 'saves' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [slotsInput, setSlotsInput] = useState<number | null>(null)
  const [drag, setDrag] = useState<DragItem | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [ghost, setGhost] = useState<DragGhost | null>(null)
  const [fabHost, setFabHost] = useState<Element | null>(null)
  const [editing, setEditing] = useState<RenpySaveFile | null>(null)
  const [view, setView] = useState<SavesPanelView>('saves')
  const [localBusy, setLocalBusy] = useState<'refresh' | 'delete' | null>(null)
  const [pickedPath, setPickedPath] = useState('')
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
  const cloud = useCloudSavesForThread(lookupThreadId)
  const localNames = useMemo(() => new Set(saves.map((save) => save.name)), [saves])
  const locations = info?.saveLocations ?? []
  const currentPath = info?.savePath || ''
  const desiredPath = pickedPath || currentPath
  const selectedLocation =
    locations.find((item) => sameSavePath(item.savePath, desiredPath))?.savePath || desiredPath
  const currentFolderKey = cloudFolderKey(
    locations.find((item) => sameSavePath(item.savePath, selectedLocation))?.folderName ||
      folderName(selectedLocation)
  )
  const locationCloudFiles = useMemo(
    () => filesForSaveFolder(cloud.files, currentFolderKey, lookupThreadId),
    [cloud.files, currentFolderKey, lookupThreadId]
  )
  const locationCloudNames = useMemo(
    () => new Set(locationCloudFiles.map((file) => file.name)),
    [locationCloudFiles]
  )
  const syncedCloudNames = useMemo(() => {
    const names = new Set<string>()
    if (!cloud.enabled) return names
    for (const name of cloud.syncedNames) names.add(name)
    for (const name of locationCloudNames) names.add(name)
    return names
  }, [cloud.syncedNames, locationCloudNames, cloud.enabled])
  const cloudPlaces = useMemo(() => cloudByPlace(locationCloudNames), [locationCloudNames])
  const detectedSlots = useMemo(
    () => Math.max(detectedSlotCount(saves), maxCloudSlot(locationCloudNames)),
    [saves, locationCloudNames]
  )
  const slotsMin = detectedSlots
  const slotsMax = Math.max(slotsMin + 12, 24)
  const slotsPerPage = Math.min(Math.max(slotsMin, slotsInput ?? slotsMin), slotsMax)
  const slotsAtDefault = slotsPerPage === slotsMin
  const boards = useMemo(
    () =>
      buildBoards(
        saves,
        slotsPerPage,
        Math.max(lastNumberedPage(saves), lastCloudPage(locationCloudNames))
      ),
    [saves, slotsPerPage, locationCloudNames]
  )
  const leftovers = useMemo(
    () =>
      saves.filter(
        (save) => save.kind === 'other' && !isPersistentSaveName(save.name)
      ),
    [saves]
  )
  const canAssign = Boolean(activeId || lookupTitle || lookupThreadId)
  const showLocationSelect = locations.length > 1

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
    setFabHost(panelRef.current?.closest('.details-modal-card') ?? null)
  }, [])

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
    setEditing(null)
    setPickedPath('')
    setLocalBusy(null)
    sessionRef.current = null
    document.body.classList.remove('is-save-dragging')
  }, [activeId])

  useEffect(() => {
    if (!cloud.enabled && view === 'cloud') setView('saves')
  }, [cloud.enabled, view])

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
    function placeGhost(x: number, y: number, grabX: number, grabY: number): void {
      ghostPos.current = { x: x - grabX, y: y - grabY }
      const node = ghostRef.current
      if (node) node.style.transform = `translate(${ghostPos.current.x}px, ${ghostPos.current.y}px)`
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
          ghost: session.ghost,
          x: event.clientX,
          y: event.clientY,
          grabX: session.grabX,
          grabY: session.grabY
        }
        freezeModalScroll()
        document.body.classList.add('is-save-dragging')
        placeGhost(event.clientX, event.clientY, session.grabX, session.grabY)
        setDrag(session.item)
        setGhost(session.ghost)
        setOver(overKey(event.clientX, event.clientY, session.item))
        return
      }
      if (event.cancelable) event.preventDefault()
      session.x = event.clientX
      session.y = event.clientY
      placeGhost(event.clientX, event.clientY, session.grabX, session.grabY)
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
    if (!(await confirm({ title: 'Delete saves', message: `Delete ${paths.length} ${noun}?`, confirmLabel: 'Delete', danger: true }))) return
    await withInfo(() => window.api.renpy.deleteSaves(activeId, paths, lookupTitle))
    setSelected(new Set())
  }

  async function refreshSaves(): Promise<void> {
    setLocalBusy('refresh')
    try {
      await withInfo(() =>
        window.api.renpy.info(activeId, false, lookupTitle, lookupThreadId, 'saves')
      )
    } finally {
      setLocalBusy(null)
    }
  }

  async function deleteSaveFolder(): Promise<void> {
    const name = currentPath ? folderName(currentPath) : ''
    if (
      !(await confirm({
        title: 'Delete saves',
        message: name
          ? `Delete the save folder “${name}” and all files in it? Empty folders are removed too. This cannot be undone.`
          : `Delete all save folders for ${lookupTitle || 'this game'}? Empty folders are removed too. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true
      }))
    ) {
      return
    }
    setLocalBusy('delete')
    try {
      await withInfo(async () => {
        await window.api.library.clearSaves(
          lookupThreadId,
          info?.savePathExists ? currentPath : undefined
        )
        return window.api.renpy.info(activeId, false, lookupTitle, lookupThreadId, 'saves')
      })
      setSelected(new Set())
    } finally {
      setLocalBusy(null)
    }
  }

  async function switchSaveLocation(savePath: string): Promise<void> {
    if (!savePath || sameSavePath(savePath, currentPath)) return
    setPickedPath(savePath)
    try {
      await withInfo(() =>
        window.api.renpy.setSaveDirectory(activeId, savePath, lookupTitle, lookupThreadId)
      )
    } finally {
      setPickedPath('')
    }
  }

  async function unlinkSaveLocation(): Promise<void> {
    if (!currentPath) return
    if (
      !(await confirm({
        title: 'Remove save location',
        message: 'Stop using this folder for this game? Save files stay on disk.',
        confirmLabel: 'Remove'
      }))
    ) {
      return
    }
    await withInfo(() =>
      window.api.renpy.unlinkSaveDirectory(activeId, currentPath, lookupTitle, lookupThreadId)
    )
  }

  async function autoDetectSaveLocation(): Promise<void> {
    if (locations.length > 1) {
      if (
        !(await confirm({
          title: 'Auto-detect save folder',
          message: 'This unlinks all save folders for this game and tries to detect the location again.',
          confirmLabel: 'Auto-detect'
        }))
      ) {
        return
      }
    }
    await withInfo(() => window.api.renpy.clearSaveDirectory(activeId, lookupTitle, lookupThreadId))
  }

  function toggleSave(path: string): void {
    if (skipClick.current) {
      skipClick.current = false
      return
    }
    togglePath(path)
  }

  function openEditor(save: RenpySaveFile): void {
    skipClick.current = false
    freezeModalScroll()
    setEditing(save)
  }

  function beginDrag(
    event: ReactPointerEvent,
    item: DragItem,
    ghost: DragGhost,
    grabX: number,
    grabY: number
  ): void {
    if (event.button !== 0 || busy || running) return
    if ((event.target as HTMLElement).closest('input, button, a, select')) return
    sessionRef.current = {
      phase: 'pending',
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      item,
      ghost,
      grabX,
      grabY
    }
  }

  if (!installed.length && !files.length && !title) {
    return (
      <p className="muted">Install a Ren&apos;Py build from the Files tab to manage saves.</p>
    )
  }

  return (
    <div className="renpy-panel" ref={panelRef}>
      {ghost
        ? createPortal(
            <div
              ref={ghostRef}
              className={ghost.kind === 'save' ? 'save-drag-ghost is-save' : 'save-drag-ghost is-page'}
              style={{
                transform: `translate(${ghostPos.current.x}px, ${ghostPos.current.y}px)`,
                ...(ghost.kind === 'save'
                  ? { width: ghost.width, height: ghost.height }
                  : null)
              }}
            >
              {ghost.kind === 'save' ? (
                <article className="save-tile">
                  <SaveThumb url={ghost.save.thumbnailUrl} eager />
                  <div className="save-tile-overlay">
                    <div className="save-tile-top">
                      <span className="save-tile-slot">Slot {ghost.slot}</span>
                    </div>
                    <div className="save-tile-meta">
                      {ghost.save.saveName ? <strong>{ghost.save.saveName}</strong> : null}
                      {ghost.save.gameVersion ? <span>{ghost.save.gameVersion}</span> : null}
                      {formatDateTime(ghost.save.savedAt || ghost.save.modifiedAt) ? (
                        <span>{formatDateTime(ghost.save.savedAt || ghost.save.modifiedAt)}</span>
                      ) : null}
                    </div>
                  </div>
                </article>
              ) : (
                ghost.label
              )}
            </div>,
            document.body
          )
        : null}
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

      {info?.message && view === 'saves' ? <p className="muted">{info.message}</p> : null}

      <SavesPanelTabs
        view={view}
        onViewChange={setView}
        cloudEnabled={cloud.enabled}
        localActions={
          <>
            <SavesActionButton
              label="Refresh"
              busyLabel="Refreshing"
              title="Reload local saves"
              busy={localBusy === 'refresh'}
              disabled={busy || running}
              onClick={() => void refreshSaves()}
            />
            {lookupThreadId || (currentPath && info?.savePathExists) || localBusy === 'delete' ? (
              <SavesActionButton
                label="Delete"
                busyLabel="Deleting"
                title={
                  currentPath && info?.savePathExists
                    ? 'Delete this save folder, even if it has no save files'
                    : 'Delete save folders for this game, even if they have no save files'
                }
                danger
                busy={localBusy === 'delete'}
                disabled={busy || running}
                onClick={() => void deleteSaveFolder()}
              />
            ) : null}
          </>
        }
        cloudActions={
          lookupThreadId && cloud.enabled && cloud.signedIn ? (
            <GameCloudSaveActions threadId={lookupThreadId} cloud={cloud} disabled={busy || running} />
          ) : null
        }
      />

      {view === 'saves' && showLocationSelect ? (
        <div className="saves-controls">
          <div className="folder-field saves-location-field">
            <span className="filter-label">Save location</span>
            <div className="folder-path-row">
              <select
                className="folder-path toolbar-select"
                value={selectedLocation}
                disabled={busy || running}
                title={currentPath || undefined}
                onChange={(event) => void switchSaveLocation(event.target.value)}
              >
                {locations.map((item) => (
                  <option key={item.savePath} value={item.savePath} title={item.savePath}>
                    {saveLocationLabel(locations, item)}
                  </option>
                ))}
              </select>
              <button
                className="ghost-btn saves-toolbar-btn"
                type="button"
                disabled={busy || running || !currentPath}
                onClick={() =>
                  void window.api.renpy.openSaves(activeId, lookupTitle, lookupThreadId).catch((err) => {
                    setError(err instanceof Error ? err.message : 'Could not open the save folder.')
                  })
                }
              >
                Open
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {view === 'settings' ? (
        <section className="renpy-section">
          <div className="saves-controls">
            <div className="folder-field saves-location-field">
              <div className="saves-location-head">
                <span className="filter-label">Save location</span>
                {locations.length > 1 ? (
                  <span className="muted">{locations.length} folders</span>
                ) : null}
              </div>
              <div className="folder-path-row">
                {showLocationSelect ? (
                  <select
                    className="folder-path toolbar-select"
                    value={selectedLocation}
                    disabled={busy || running}
                    title={currentPath || undefined}
                    onChange={(event) => void switchSaveLocation(event.target.value)}
                  >
                    {locations.map((item) => (
                      <option key={item.savePath} value={item.savePath} title={item.savePath}>
                        {saveLocationLabel(locations, item)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="folder-path"
                    readOnly
                    value={currentPath}
                    placeholder={busy && !info ? 'Reading…' : 'Not set — browse to choose a folder'}
                    title={currentPath || undefined}
                  />
                )}
                {currentPath && info?.savePathExists ? (
                  <span className="muted saves-location-meta">{formatBytes(info.saveFolderBytes)}</span>
                ) : null}
                <button
                  className="ghost-btn saves-toolbar-btn"
                  type="button"
                  disabled={busy || running || !canAssign}
                  onClick={() =>
                    void withInfo(() =>
                      window.api.renpy.chooseSaveDirectory(activeId, lookupTitle, lookupThreadId)
                    )
                  }
                >
                  {currentPath ? 'Add' : 'Browse'}
                </button>
                <button
                  className="ghost-btn saves-toolbar-btn"
                  type="button"
                  disabled={busy || running || !currentPath}
                  onClick={() =>
                    void window.api.renpy.openSaves(activeId, lookupTitle, lookupThreadId).catch((err) => {
                      setError(err instanceof Error ? err.message : 'Could not open the save folder.')
                    })
                  }
                >
                  Open
                </button>
                {currentPath ? (
                  <button
                    className="ghost-btn saves-toolbar-btn"
                    type="button"
                    disabled={busy || running || !canAssign}
                    title="Stop using this folder for this game. Save files stay on disk."
                    onClick={() => void unlinkSaveLocation()}
                  >
                    Remove
                  </button>
                ) : null}
                {currentPath ? (
                  <button
                    className="ghost-btn saves-toolbar-btn"
                    type="button"
                    disabled={busy || running || !canAssign}
                    title="Clear saved locations and try auto-detection again"
                    onClick={() => void autoDetectSaveLocation()}
                  >
                    Auto-detect
                  </button>
                ) : null}
              </div>
            </div>

            {info?.savePath ? (
              <div className="saves-slots-field">
                <div className="saves-slots-head">
                  <span className="filter-label" id="saves-slots-label">
                    Slots per page
                  </span>
                  <span className="saves-slots-value" aria-live="polite">
                    {slotsPerPage}
                    {slotsAtDefault ? <span className="muted"> · default</span> : null}
                  </span>
                </div>
                {slotsMax > slotsMin ? (
                  <div className="saves-slots-control">
                    <input
                      className="saves-slots-slider"
                      type="range"
                      min={slotsMin}
                      max={slotsMax}
                      step={1}
                      value={slotsPerPage}
                      disabled={busy || running}
                      aria-labelledby="saves-slots-label"
                      aria-valuemin={slotsMin}
                      aria-valuemax={slotsMax}
                      aria-valuenow={slotsPerPage}
                      aria-valuetext={
                        slotsAtDefault ? `${slotsPerPage} (default)` : String(slotsPerPage)
                      }
                      onChange={(event) => {
                        const next = Number(event.target.value)
                        if (!Number.isInteger(next)) return
                        setSlotsInput(next <= slotsMin ? null : next)
                      }}
                      onMouseDown={(event) => event.stopPropagation()}
                    />
                    <div className="saves-slots-scale" aria-hidden="true">
                      <button
                        type="button"
                        className={
                          slotsAtDefault
                            ? 'saves-slots-mark is-default is-active'
                            : 'saves-slots-mark is-default'
                        }
                        disabled={busy || running || slotsAtDefault}
                        title={`Reset to default (${slotsMin})`}
                        onClick={() => setSlotsInput(null)}
                      >
                        Default · {slotsMin}
                      </button>
                      <span className="saves-slots-mark is-max">{slotsMax}</span>
                    </div>
                  </div>
                ) : (
                  <p className="muted saves-slots-hint">
                    {slotsPerPage} slots from existing saves
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      {view === 'saves' ? (
      <section className="renpy-section">
        {busy && !info ? (
          <InlineLoading label="Reading save location" />
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
                        onPointerDown={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect()
                          beginDrag(
                            event,
                            { kind: 'page', page: board.page },
                            { kind: 'page', label: board.label },
                            event.clientX - rect.left,
                            event.clientY - rect.top
                          )
                        }}
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
                        const cloudName = cloudPlaces.get(`${board.page}:${item.slot}`)
                        const cloudFile = locationCloudFiles.find((file) => file.name === cloudName)
                        if (
                          cloud.enabled &&
                          cloudName &&
                          cloudFile &&
                          !cloudFile.presentLocally &&
                          !localNames.has(cloudName)
                        ) {
                          return (
                            <article
                              key={`cloud:${cloudName}`}
                              className="save-tile save-tile-cloud-only"
                              title={`${cloudName} is only in Google Drive`}
                            >
                              <div className="save-tile-overlay">
                                <div className="save-tile-top">
                                  <span className="save-tile-slot">Slot {item.slot}</span>
                                  <span className="save-cloud-badge is-only">Cloud only</span>
                                </div>
                                <div className="save-tile-meta">
                                  <strong>{cloudName}</strong>
                                </div>
                              </div>
                            </article>
                          )
                        }
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
                            const rect = event.currentTarget.getBoundingClientRect()
                            beginDrag(
                              event,
                              { kind: 'save', path: save.path, page: save.page, slot: save.slot },
                              {
                                kind: 'save',
                                save,
                                slot: save.slot,
                                width: rect.width,
                                height: rect.height
                              },
                              event.clientX - rect.left,
                              event.clientY - rect.top
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
                              {syncedCloudNames.has(save.name) ? (
                                <span className="save-cloud-badge" title="Also in Google Drive">
                                  Cloud
                                </span>
                              ) : null}
                              <button
                                type="button"
                                className="save-tile-edit"
                                disabled={busy || running}
                                onMouseDown={keepScrollOnMouse}
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  openEditor(save)
                                }}
                              >
                                Edit
                              </button>
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
                            {syncedCloudNames.has(save.name) ? (
                              <span className="save-cloud-badge" title="Also in Google Drive">
                                Cloud
                              </span>
                            ) : null}
                            <button
                              type="button"
                              className="save-tile-edit"
                              disabled={busy || running}
                              onMouseDown={keepScrollOnMouse}
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.stopPropagation()
                                openEditor(save)
                              }}
                            >
                              Edit
                            </button>
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
      ) : null}
      {view === 'cloud' && lookupThreadId ? (
        <GameCloudSaves
          threadId={lookupThreadId}
          localNames={localNames}
          folderKey={currentFolderKey}
          cloud={cloud}
        />
      ) : null}
      {editing ? (
        <RenpySaveEditorDialog
          fileId={activeId}
          title={lookupTitle}
          save={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await withInfo(() => window.api.renpy.info(activeId, false, lookupTitle, lookupThreadId, 'saves'))
          }}
        />
      ) : null}
      <SavesDeleteSelectedFab
        count={selected.size}
        disabled={busy || running}
        host={fabHost}
        onDelete={() => void deleteSelected()}
      />
    </div>
  )
}
