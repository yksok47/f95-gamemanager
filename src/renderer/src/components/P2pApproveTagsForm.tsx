import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type UIEvent
} from 'react'
import { createPortal } from 'react-dom'
import type {
  PackageConsensus,
  PackageInstallTags,
  PackageMetadata,
  PackageVersionWeight
} from '@shared/p2p'
import {
  CONTENT_KIND_BY_ID,
  CONTENT_KIND_IDS,
  CONTENT_KIND_LABELS,
  contentKindAllowsOs,
  contentKindAllowsVersion,
  contentKindRequiresOs,
  contentKindRequiresVersion,
  OS_KIND_BY_ID,
  OS_KIND_IDS,
  OS_KIND_LABELS,
  VERSION_NAME_MAX_LEN,
  type ContentKind,
  type OsKind
} from '@shared/types'
import { KindIcon, OsIcon } from './TagIcons'
import { notifyError } from './ErrorNotifications'

export type P2pApproveTagsFormProps = {
  /** Stable id so the Approve button can submit this form via the HTML `form` attribute. */
  formId: string
  contentHash?: string | null
  consensus?: PackageConsensus | null
  /** Used when metadata API is disabled or has no consensus for this hash (e.g. parsed F95 link). */
  fallbackConsensus?: PackageConsensus | null
  versions?: PackageVersionWeight[]
  onSubmit: (tags: PackageInstallTags) => void
  /** Fires when required fields become complete / incomplete so parents can disable Approve. */
  onReadyChange?: (ready: boolean) => void
  /** Size / finished time shown on the same row as install/flag stats. */
  statsPrefix?: string
  className?: string
}

const OS_OPTIONS = (Object.keys(OS_KIND_IDS) as OsKind[]).map((key) => ({
  key,
  id: OS_KIND_IDS[key],
  label: OS_KIND_LABELS[key]
}))

const KIND_DESCRIPTIONS: Record<ContentKind, string> = {
  other: 'Anything that does not fit the other categories.',
  game: 'Full base game / complete install package.',
  update: 'Version bump or incremental update package.',
  patch: 'Bugfix or small correction patch.',
  uncensor: 'Restores or removes censored content.',
  mod: 'Community modification or overhaul.',
  translation: 'Language pack or translation.',
  walkthrough: 'Guide, walkthrough, or tip sheet.',
  cheat: 'Cheats, trainers, or debug helpers.',
  crack: 'DRM bypass or crack files.',
  save: 'Save games or save folders.',
  dlc: 'Downloadable content or expansion.',
  extra: 'Bonus extras that are not required to play.'
}

/** "Other" is listed last so it sits at the bottom of the picker. */
const KIND_OPTIONS = ([
  ...(Object.keys(CONTENT_KIND_IDS) as ContentKind[]).filter((key) => key !== 'other'),
  'other'
] as ContentKind[]).map((key) => ({
  key,
  id: CONTENT_KIND_IDS[key],
  label: CONTENT_KIND_LABELS[key],
  description: KIND_DESCRIPTIONS[key]
}))

const RATCHET_ITEM_H = 30
const RATCHET_VISIBLE = 5
const RATCHET_PAD = Math.floor((RATCHET_VISIBLE - 1) / 2) * RATCHET_ITEM_H
const RATCHET_SETTLE_MS = 120

const KIND_ITEM_H = 56
const KIND_VISIBLE = 5
const KIND_PAD = Math.floor((KIND_VISIBLE - 1) / 2) * KIND_ITEM_H

function normalizeVersionInput(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

type AnchoredPopupProps = {
  anchor: HTMLElement
  onClose: () => void
  children: ReactNode
  className?: string
  matchAnchorCenter?: boolean
}

/** Floating panel centered on the anchor tile. */
function AnchoredPopup({
  anchor,
  onClose,
  children,
  className,
  matchAnchorCenter = true
}: AnchoredPopupProps): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0, ready: false })

  useLayoutEffect(() => {
    function place(): void {
      const el = ref.current
      if (!el) return
      const rect = anchor.getBoundingClientRect()
      const width = el.offsetWidth
      const height = el.offsetHeight
      let left = rect.left + rect.width / 2 - width / 2
      let top = matchAnchorCenter
        ? rect.top + rect.height / 2 - height / 2
        : rect.bottom + 6
      left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
      top = Math.max(8, Math.min(top, window.innerHeight - height - 8))
      setPos({ top, left, ready: true })
    }

    place()
    const id = window.requestAnimationFrame(place)
    return () => window.cancelAnimationFrame(id)
  }, [anchor, matchAnchorCenter])

  useEffect(() => {
    function onPointer(event: PointerEvent): void {
      const target = event.target as Node
      if (ref.current?.contains(target) || anchor.contains(target)) return
      onClose()
    }

    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }

    function onScroll(event: Event): void {
      const target = event.target
      if (target instanceof Node && ref.current?.contains(target)) return
      onClose()
    }

    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      className={className ? `p2p-tag-popup ${className}` : 'p2p-tag-popup'}
      style={{
        top: pos.top,
        left: pos.left,
        visibility: pos.ready ? 'visible' : 'hidden'
      }}
      role="dialog"
    >
      {children}
    </div>,
    document.body
  )
}

type KindLoopPickerProps = {
  options: typeof KIND_OPTIONS
  value: number | null
  onChange: (id: number) => void
  onPick: (id: number) => void
}

/**
 * Circular content-type picker driven by wheel / drag on a translate track.
 * Avoids scrollTop/item-height rounding that skipped every other option.
 */
function KindLoopPicker({ options, value, onChange, onPick }: KindLoopPickerProps): JSX.Element {
  const n = options.length
  const viewportRef = useRef<HTMLDivElement>(null)
  const wheelAccRef = useRef(0)
  const dragRef = useRef<{ y: number; index: number; pointerId: number } | null>(null)

  function indexOfValue(v: number | null): number {
    if (v == null) return 0
    const idx = options.findIndex((o) => o.id === v)
    return idx >= 0 ? idx : 0
  }

  const [index, setIndex] = useState(() => indexOfValue(value))
  const [dragOffset, setDragOffset] = useState(0)
  const indexRef = useRef(index)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onPickRef = useRef(onPick)
  const didDragRef = useRef(false)
  indexRef.current = index
  valueRef.current = value
  onChangeRef.current = onChange
  onPickRef.current = onPick

  function wrap(i: number): number {
    return ((i % n) + n) % n
  }

  function commitIndex(next: number): void {
    const i = wrap(next)
    indexRef.current = i
    setIndex(i)
    setDragOffset(0)
    const opt = options[i]
    if (opt && opt.id !== valueRef.current) onChangeRef.current(opt.id)
  }

  useEffect(() => {
    setIndex(indexOfValue(value))
    setDragOffset(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync from external value only
  }, [value])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    function onWheel(e: WheelEvent): void {
      e.preventDefault()
      e.stopPropagation()
      // Normalize to pixels; one option per threshold so mouse notches don't skip.
      let dy = e.deltaY
      if (e.deltaMode === 1) dy *= 16
      else if (e.deltaMode === 2) dy *= KIND_ITEM_H
      wheelAccRef.current += dy
      const threshold = KIND_ITEM_H * 0.45
      if (wheelAccRef.current >= threshold) {
        wheelAccRef.current = 0
        commitIndex(indexRef.current + 1)
      } else if (wheelAccRef.current <= -threshold) {
        wheelAccRef.current = 0
        commitIndex(indexRef.current - 1)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable listener via refs
  }, [n, options])

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    didDragRef.current = false
    dragRef.current = { y: e.clientY, index: indexRef.current, pointerId: e.pointerId }
    // Delay capture so a plain click still reaches the option button.
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    const delta = e.clientY - drag.y
    if (!didDragRef.current && Math.abs(delta) > 4) {
      didDragRef.current = true
      e.currentTarget.setPointerCapture(e.pointerId)
    }
    if (didDragRef.current) setDragOffset(delta)
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    dragRef.current = null
    if (didDragRef.current) {
      const delta = e.clientY - drag.y
      const steps = Math.round(-delta / KIND_ITEM_H)
      commitIndex(drag.index + steps)
      try {
        e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    } else {
      setDragOffset(0)
    }
  }

  // Render a window of items around the current index (circular).
  const windowItems = useMemo(() => {
    const half = Math.floor(KIND_VISIBLE / 2) + 2
    const out: Array<{ opt: (typeof KIND_OPTIONS)[number]; offset: number; key: string }> = []
    for (let o = -half; o <= half; o++) {
      const opt = options[wrap(index + o)]
      if (!opt) continue
      out.push({ opt, offset: o, key: `${index}-${o}-${opt.id}` })
    }
    return out
  }, [index, options, n])

  return (
    <div
      className="p2p-kind-loop"
      style={
        {
          ['--kind-item-h']: `${KIND_ITEM_H}px`,
          ['--kind-visible']: String(KIND_VISIBLE),
          ['--kind-pad']: `${KIND_PAD}px`
        } as CSSProperties
      }
    >
      <div className="p2p-kind-loop-fade p2p-kind-loop-fade-top" aria-hidden />
      <div className="p2p-kind-loop-fade p2p-kind-loop-fade-bottom" aria-hidden />
      <div className="p2p-kind-loop-window" aria-hidden />
      <div
        ref={viewportRef}
        className="p2p-kind-loop-viewport"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="listbox"
        aria-label="Content type"
        tabIndex={0}
      >
        <div
          className="p2p-kind-loop-track"
          style={{ transform: `translateY(${dragOffset}px)` }}
        >
          {windowItems.map(({ opt, offset, key }) => {
            const approxActive = Math.abs(offset * KIND_ITEM_H - dragOffset) < KIND_ITEM_H / 2
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={approxActive}
                className={`p2p-kind-loop-item${approxActive ? ' is-active' : ''}`}
                style={{ top: `calc(50% + ${offset * KIND_ITEM_H}px)` }}
                onClick={(ev) => {
                  if (didDragRef.current) {
                    ev.preventDefault()
                    didDragRef.current = false
                    return
                  }
                  onPickRef.current(opt.id)
                }}
              >
                <span className="p2p-kind-loop-icon">
                  <KindIcon kind={opt.key} />
                </span>
                <span className="p2p-kind-loop-text">
                  <span className="p2p-kind-loop-label">{opt.label}</span>
                  <span className="p2p-kind-loop-desc">{opt.description}</span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

type VersionRatchetProps = {
  options: PackageVersionWeight[]
  value: string
  onPick: (name: string) => void
  onCollapse?: () => void
}

function VersionRatchet({ options, value, onPick, onCollapse }: VersionRatchetProps): JSX.Element {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const ignoreScrollRef = useRef(false)
  const scrollingRef = useRef(false)
  const snapTimerRef = useRef<number | null>(null)
  const names = useMemo(() => options.map((o) => o.name), [options])
  const [activeIndex, setActiveIndex] = useState(() => {
    if (!value) return 0
    const idx = names.indexOf(value)
    return idx >= 0 ? idx + 1 : 0
  })

  function indexForValue(v: string): number {
    if (!v) return 0
    const idx = names.indexOf(v)
    return idx >= 0 ? idx + 1 : 0
  }

  function valueForIndex(idx: number): string {
    const clamped = Math.max(0, Math.min(names.length, idx))
    return clamped === 0 ? '' : (names[clamped - 1] ?? '')
  }

  function clampIndex(idx: number): number {
    return Math.max(0, Math.min(names.length, idx))
  }

  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || scrollingRef.current) return
    const expectedIdx = indexForValue(value)
    setActiveIndex(expectedIdx)
    const expected = expectedIdx * RATCHET_ITEM_H
    if (Math.abs(el.scrollTop - expected) <= 1) return
    ignoreScrollRef.current = true
    el.scrollTop = expected
    requestAnimationFrame(() => {
      ignoreScrollRef.current = false
    })
  }, [names, value])

  useEffect(() => {
    return () => {
      if (snapTimerRef.current != null) window.clearTimeout(snapTimerRef.current)
    }
  }, [])

  function commitIndex(idx: number, collapse = false): void {
    const el = scrollerRef.current
    if (!el) return
    const clamped = clampIndex(idx)
    scrollingRef.current = false
    ignoreScrollRef.current = true
    el.scrollTop = clamped * RATCHET_ITEM_H
    setActiveIndex(clamped)
    const next = valueForIndex(clamped)
    if (next !== value) onPick(next)
    requestAnimationFrame(() => {
      ignoreScrollRef.current = false
    })
    if (collapse && next) onCollapse?.()
  }

  function handleScroll(e: UIEvent<HTMLDivElement>): void {
    if (ignoreScrollRef.current) return
    scrollingRef.current = true
    const idx = clampIndex(Math.round(e.currentTarget.scrollTop / RATCHET_ITEM_H))
    setActiveIndex(idx)
    if (snapTimerRef.current != null) window.clearTimeout(snapTimerRef.current)
    snapTimerRef.current = window.setTimeout(() => {
      commitIndex(idx)
    }, RATCHET_SETTLE_MS)
  }

  return (
    <div
      className="p2p-version-ratchet"
      style={
        {
          ['--ratchet-item-h']: `${RATCHET_ITEM_H}px`,
          ['--ratchet-visible']: String(RATCHET_VISIBLE),
          ['--ratchet-pad']: `${RATCHET_PAD}px`
        } as CSSProperties
      }
    >
      <div className="p2p-version-ratchet-fade p2p-version-ratchet-fade-top" aria-hidden />
      <div className="p2p-version-ratchet-fade p2p-version-ratchet-fade-bottom" aria-hidden />
      <div className="p2p-version-ratchet-window" aria-hidden />
      <div
        ref={scrollerRef}
        className="p2p-version-ratchet-scroller"
        onScroll={handleScroll}
        role="listbox"
        aria-label="Version"
        tabIndex={0}
      >
        <button
          type="button"
          className={`p2p-version-ratchet-item p2p-version-ratchet-blank${activeIndex === 0 ? ' is-active' : ''}`}
          role="option"
          aria-selected={activeIndex === 0}
          onClick={() => commitIndex(0)}
        >
          ···
        </button>
        {options.map((v, i) => {
          const active = activeIndex === i + 1
          return (
            <button
              key={v.id}
              type="button"
              role="option"
              aria-selected={active}
              className={`p2p-version-ratchet-item${active ? ' is-active' : ''}`}
              onClick={() => commitIndex(i + 1, true)}
            >
              {v.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function flagCountsOf(pkg: PackageMetadata): { broken: number; harmful: number; total: number } {
  const broken = Math.max(0, pkg.flagCounts?.broken ?? 0)
  const harmful = Math.max(0, pkg.flagCounts?.harmful ?? 0)
  return { broken, harmful, total: broken + harmful }
}

function trustLevel(pkg: PackageMetadata): 'good' | 'uncertain' | 'caution' | 'bad' | 'none' {
  const installs = Math.max(0, pkg.installCount ?? 0)
  const flags = flagCountsOf(pkg).total
  if (flags === 0 && installs === 0) return 'none'
  if (flags === 0) return 'good'
  if (flags > installs) return 'bad'
  const ratio = installs / flags
  if (ratio >= 10) return 'good'
  if (ratio > 2) return 'uncertain'
  return 'caution'
}

function formatFirstRecorded(iso?: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return `First recorded ${d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
}

function installFlagLabel(pkg: PackageMetadata): string {
  const installs = Math.max(0, pkg.installCount ?? 0)
  const flags = flagCountsOf(pkg).total
  const installBit = `${installs} install${installs === 1 ? '' : 's'}`
  if (flags === 0) return `${installBit} · no flags`
  return `${installBit} · ${flags} flag${flags === 1 ? '' : 's'}`
}

function flagDetail(pkg: PackageMetadata): string | null {
  const { harmful, broken, total } = flagCountsOf(pkg)
  if (total === 0) return null
  return [harmful > 0 ? `harmful ×${harmful}` : null, broken > 0 ? `broken ×${broken}` : null]
    .filter(Boolean)
    .join(', ')
}

/** Inline OS / content-kind / version fields for quarantine approval (one-step, no modal). */
export default function P2pApproveTagsForm({
  formId,
  contentHash,
  consensus,
  fallbackConsensus,
  versions: versionsProp,
  onSubmit,
  onReadyChange,
  statsPrefix,
  className
}: P2pApproveTagsFormProps): JSX.Element {
  const [os, setOs] = useState<number[]>([])
  const [contentKind, setContentKind] = useState<number | null>(null)
  const [version, setVersion] = useState('')
  const [versions, setVersions] = useState<PackageVersionWeight[]>([])
  const [customVersion, setCustomVersion] = useState(false)
  const [versionOpen, setVersionOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [pkgMeta, setPkgMeta] = useState<PackageMetadata | null>(null)
  const [kindOpen, setKindOpen] = useState(false)
  const [osOpen, setOsOpen] = useState(false)
  const kindAnchorRef = useRef<HTMLButtonElement>(null)
  const osAnchorRef = useRef<HTMLButtonElement>(null)
  const versionAnchorRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let cancelled = false
    setPkgMeta(null)
    setLoading(true)

    const initialConsensus = consensus
    const linkFallback = fallbackConsensus
    const initialVersions = versionsProp ?? []

    const prefill = (next: PackageConsensus | null | undefined, vers: PackageVersionWeight[]) => {
      const sorted = vers.slice().sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))
      setVersions(sorted)
      if (next) {
        setOs([...next.os].sort((a, b) => a - b))
        setContentKind(next.contentKind)
        setVersion(next.version)
        const inList = sorted.some((v) => v.name === next.version)
        setCustomVersion(sorted.length > 0 ? !inList : true)
      } else {
        setOs([])
        setContentKind(null)
        setVersion('')
        setCustomVersion(sorted.length === 0)
      }
      setVersionOpen(false)
    }

    prefill(initialConsensus ?? linkFallback, initialVersions)

    async function load(): Promise<void> {
      const hash = contentHash?.trim()
      if (!hash) {
        setLoading(false)
        return
      }
      try {
        const pkg = await window.api.p2p.getPackage(hash)
        if (cancelled) return
        setPkgMeta(pkg)
        prefill(
          pkg?.consensus ?? initialConsensus ?? linkFallback,
          pkg?.versions ?? initialVersions
        )
      } catch {
        if (!cancelled) {
          setPkgMeta(null)
          prefill(initialConsensus ?? linkFallback, initialVersions)
          notifyError('Could not refresh metadata prefill')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- consensus/versions are initial prefill only
  }, [contentHash])

  const hasVersionOptions = versions.length > 0
  const showRatchet = hasVersionOptions && !customVersion
  const selectedKind = KIND_OPTIONS.find((o) => o.id === contentKind) ?? null
  const selectedOs = OS_OPTIONS.filter((o) => os.includes(o.id))
  const allowsOs = contentKind != null && contentKindAllowsOs(contentKind)
  const allowsVersion = contentKind != null && contentKindAllowsVersion(contentKind)
  const requiresOs = contentKind != null && contentKindRequiresOs(contentKind)
  const requiresVersion = contentKind != null && contentKindRequiresVersion(contentKind)
  const normalizedVersion = normalizeVersionInput(version)
  const trustLevelValue = pkgMeta ? trustLevel(pkgMeta) : null
  const trustLabel = pkgMeta ? installFlagLabel(pkgMeta) : null
  const flagsLabel = pkgMeta ? flagDetail(pkgMeta) : null
  const firstRecorded = pkgMeta ? formatFirstRecorded(pkgMeta.createdAt) : null

  const ready =
    contentKind != null &&
    Number.isFinite(contentKind) &&
    contentKind in CONTENT_KIND_BY_ID &&
    (!requiresOs || os.length > 0) &&
    (!requiresVersion || normalizedVersion.length > 0) &&
    (!allowsVersion ||
      normalizedVersion.length === 0 ||
      [...normalizedVersion].length <= VERSION_NAME_MAX_LEN)

  useEffect(() => {
    onReadyChange?.(ready)
  }, [ready, onReadyChange])

  useEffect(() => {
    if (contentKind == null) return
    if (!contentKindAllowsOs(contentKind)) {
      setOs([])
      setOsOpen(false)
    }
    if (!contentKindAllowsVersion(contentKind)) {
      setVersion('')
      setVersionOpen(false)
      setCustomVersion(false)
    }
  }, [contentKind])

  function toggleOs(id: number): void {
    setOs((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      return [...prev, id].sort((a, b) => a - b)
    })
  }

  function handleSubmit(e: FormEvent): void {
    e.preventDefault()
    if (contentKind == null || !Number.isFinite(contentKind) || !(contentKind in CONTENT_KIND_BY_ID)) {
      notifyError('Choose a content type')
      return
    }
    const allowOs = contentKindAllowsOs(contentKind)
    const allowVer = contentKindAllowsVersion(contentKind)
    const submitOs = allowOs ? os : []
    if (contentKindRequiresOs(contentKind) && submitOs.length === 0) {
      notifyError('Select at least one OS')
      return
    }
    for (const id of submitOs) {
      if (!(id in OS_KIND_BY_ID)) {
        notifyError('Invalid OS selection')
        return
      }
    }
    const ver = allowVer ? normalizeVersionInput(version) : ''
    if (contentKindRequiresVersion(contentKind) && !ver) {
      notifyError('Version is required')
      return
    }
    if (ver && [...ver].length > VERSION_NAME_MAX_LEN) {
      notifyError(`Version must be at most ${VERSION_NAME_MAX_LEN} characters`)
      return
    }
    onSubmit({ os: submitOs, contentKind, version: ver })
  }

  return (
    <form
      id={formId}
      className={className ? `p2p-approve-panel ${className}` : 'p2p-approve-panel'}
      onSubmit={handleSubmit}
    >
      {statsPrefix || loading || (pkgMeta && trustLevelValue && trustLabel) ? (
        <p
          className="p2p-approve-trust"
          aria-label={[statsPrefix, trustLabel, flagsLabel, firstRecorded].filter(Boolean).join('. ')}
        >
          {statsPrefix ? <span className="p2p-approve-trust-prefix">{statsPrefix}</span> : null}
          {loading && !pkgMeta ? <span className="muted p2p-approve-loading">Loading…</span> : null}
          {pkgMeta && trustLevelValue && trustLabel ? (
            <>
              <span
                className={`p2p-trust-badge p2p-trust-${trustLevelValue}`}
                title="Installs vs flags (unique reports)"
              >
                {trustLabel}
              </span>
              {flagsLabel ? (
                <span className={`p2p-approve-trust-flags${trustLevelValue === 'bad' ? ' is-bad' : ''}`}>
                  {flagsLabel}
                </span>
              ) : null}
              {firstRecorded ? (
                <span className="p2p-approve-trust-date" title={pkgMeta.createdAt}>
                  {firstRecorded}
                </span>
              ) : null}
            </>
          ) : null}
        </p>
      ) : null}

      <div className="p2p-approve-fields">
        <div className="p2p-approve-field">
          <span>Content type</span>
          <button
            ref={kindAnchorRef}
            type="button"
            className={`p2p-tag-tile p2p-tag-tile-kind${selectedKind ? ' is-filled' : ''}${kindOpen ? ' is-open' : ''}`}
            aria-haspopup="dialog"
            aria-expanded={kindOpen}
            onClick={() => {
              setOsOpen(false)
              setVersionOpen(false)
              setKindOpen((v) => !v)
            }}
          >
            {selectedKind ? (
              <>
                <span className="p2p-tag-tile-kind-row">
                  <span className="p2p-tag-tile-icon">
                    <KindIcon kind={selectedKind.key} />
                  </span>
                  <span className="p2p-tag-tile-title">{selectedKind.label}</span>
                </span>
                <span className="p2p-tag-tile-desc">{selectedKind.description}</span>
              </>
            ) : (
              <span className="p2p-tag-tile-title">Choose…</span>
            )}
          </button>
          {kindOpen && kindAnchorRef.current ? (
            <AnchoredPopup
              anchor={kindAnchorRef.current}
              className="p2p-tag-popup-kind"
              onClose={() => setKindOpen(false)}
            >
              <KindLoopPicker
                options={KIND_OPTIONS}
                value={contentKind}
                onChange={setContentKind}
                onPick={(id) => {
                  setContentKind(id)
                  setKindOpen(false)
                }}
              />
            </AnchoredPopup>
          ) : null}
        </div>

        {allowsOs ? (
          <div className="p2p-approve-field">
            <span>OS</span>
            <button
              ref={osAnchorRef}
              type="button"
              className={`p2p-tag-tile p2p-tag-tile-os${selectedOs.length ? ' is-filled' : ''}${osOpen ? ' is-open' : ''}`}
              aria-haspopup="dialog"
              aria-expanded={osOpen}
              onClick={() => {
                setKindOpen(false)
                setVersionOpen(false)
                setOsOpen((v) => !v)
              }}
            >
              {selectedOs.length ? (
                <span
                  className={`p2p-tag-os-selected${selectedOs.length > 2 ? ' is-compact' : ''}`}
                >
                  {selectedOs.map((opt) => (
                    <span key={opt.id} className="p2p-tag-os-selected-item" title={opt.label}>
                      <OsIcon os={opt.key} />
                      {selectedOs.length <= 2 ? <span>{opt.label}</span> : null}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="p2p-tag-tile-title">Choose…</span>
              )}
            </button>
            {osOpen && osAnchorRef.current ? (
              <AnchoredPopup
                anchor={osAnchorRef.current}
                className="p2p-tag-popup-os"
                onClose={() => setOsOpen(false)}
              >
                <div className="p2p-tag-os-grid" role="group" aria-label="Operating systems">
                  {OS_OPTIONS.map((opt) => {
                    const checked = os.includes(opt.id)
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        className={`p2p-tag-os-option${checked ? ' is-active' : ''}`}
                        aria-pressed={checked}
                        onClick={() => toggleOs(opt.id)}
                      >
                        <OsIcon os={opt.key} />
                        <span>{opt.label}</span>
                      </button>
                    )
                  })}
                </div>
              </AnchoredPopup>
            ) : null}
          </div>
        ) : null}

        {allowsVersion ? (
          <div className="p2p-approve-field p2p-approve-version">
            <span>{requiresVersion ? 'Version' : 'Version (optional)'}</span>
            {showRatchet ? (
              <div className="p2p-approve-version-stack">
                <button
                  ref={versionAnchorRef}
                  type="button"
                  className={`p2p-approve-version-trigger${version ? ' is-filled' : ''}${versionOpen ? ' is-open' : ''}`}
                  aria-haspopup="dialog"
                  aria-expanded={versionOpen}
                  onClick={() => {
                    setKindOpen(false)
                    setOsOpen(false)
                    setVersionOpen((v) => !v)
                  }}
                >
                  {version || (requiresVersion ? 'Choose version…' : 'Any / none…')}
                </button>
                {versionOpen && versionAnchorRef.current ? (
                  <AnchoredPopup
                    anchor={versionAnchorRef.current}
                    className="p2p-tag-popup-version"
                    onClose={() => setVersionOpen(false)}
                  >
                    <VersionRatchet
                      options={versions}
                      value={version}
                      onPick={setVersion}
                      onCollapse={() => setVersionOpen(false)}
                    />
                  </AnchoredPopup>
                ) : null}
                <button
                  type="button"
                  className="p2p-approve-version-custom-link"
                  onClick={() => {
                    setVersionOpen(false)
                    setCustomVersion(true)
                  }}
                >
                  Not in the list? Type it
                </button>
              </div>
            ) : (
              <div className="p2p-approve-version-stack">
                <input
                  type="text"
                  className={`p2p-approve-version-input${hasVersionOptions ? ' is-custom-path' : ''}`}
                  value={version}
                  maxLength={VERSION_NAME_MAX_LEN}
                  placeholder={requiresVersion ? 'e.g. 0.7.0' : 'Optional — e.g. 0.7.0'}
                  onChange={(e) => setVersion(e.target.value)}
                  autoFocus={hasVersionOptions && customVersion}
                />
                {hasVersionOptions ? (
                  <button
                    type="button"
                    className="p2p-approve-version-custom-link"
                    onClick={() => {
                      setCustomVersion(false)
                      setVersionOpen(false)
                      if (version && !versions.some((v) => v.name === version)) {
                        setVersion('')
                      }
                    }}
                  >
                    Back to known versions
                  </button>
                ) : null}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </form>
  )
}
