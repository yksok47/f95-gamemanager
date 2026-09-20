import { memo, useEffect, useMemo, useRef, useState, type JSX, type MouseEvent, type PointerEvent as ReactPointerEvent} from 'react'
import { createPortal } from 'react-dom'
import type {
  CatalogGame,
  DownloadEntry,
  DownloadMirror,
  DownloadRecord,
  DownloadSection,
  DownloadSectionKind,
  FavoriteTag,
  HatedTag,
  GameLibraryFile,
  GameRarity,
  GameSummary,
  InstalledPatchRef,
  PackageTagHint,
  ThreadDetails,
  ThreadReview,
  VersionPlayStat,
  VersionPlayStatus
} from '@shared/types'
import {
  CONTENT_KIND_BY_ID,
  CONTENT_KIND_IDS,
  CONTENT_KIND_LABELS,
  LIBRARY_FILE_SECTION_ORDER,
  OS_KIND_IDS,
  OS_KIND_LABELS,
  TAG_TIER_RANK,
  contentKindRequiresVersion,
  downloadHostPreference,
  downloadMatchesHostOs,
  isInstallableLibraryPackage,
  isRenpyUncensorPackage,
  osKindFromNavigator,
  type ContentKind,
  type ContentKindId
} from '@shared/types'
import type { PackageInstallTags, P2pTransferProgress } from '@shared/p2p'
import { compareGameVersions, engineKind, normalizeEngine } from '@shared/engines'
import { engineFromPrefixIds, gameStatusFlags } from '@shared/prefixes'
import {
  formatPlaytime,
  formatRelativeTime,
  formatSessionTime,
  formatUpdateDate,
  effectiveVersionStatus,
  gameUpdateState,
  isRelativeDate,
  mergeVersionPlayStats,
  usableVersion,
  versionPlayStatsFromFiles
} from '@shared/updates'
import EngineBadge from '../components/EngineBadge'
import LibraryPresenceIcons from '../components/LibraryPresenceIcons'
import FollowButton from '../components/FollowButton'
import RaritySlider from '../components/RaritySlider'
import DownloadRow from '../components/DownloadRow'
import GameP2pSection from '../components/GameP2pSection'
import P2pTransferRow from '../components/P2pTransferRow'
import { confirm } from '../components/ConfirmDialog'
import { notifyCaught, notifyError } from '../components/ErrorNotifications'
import { MoreMenu, SplitButton, type MenuItem } from '../components/MenuPopover'
import UncensorInstallButton from '../components/UncensorInstallButton'
import UncensorRemoveButton from '../components/UncensorRemoveButton'
import RenpySavesPanel from '../components/RenpySavesPanel'
import RpgMakerSavesPanel from '../components/RpgMakerSavesPanel'
import OptionsPanel from '../components/OptionsPanel'
import UnRenPanel from '../components/UnRenPanel'
import UserNotesPanel from '../components/UserNotesPanel'
import { useCatalogPrefixes, useCatalogTags } from '../lib/catalog-prefixes'
import {
  formatBytes,
  isActiveDownload,
  isActiveP2pDownload,
  transferMatchesLibraryFile
} from '../lib/downloads'
import { formatCount, formatRating, ratingClass } from '../lib/format'
import {
  gamesWithPatchInstalled,
  listUncensorPatchTargets,
  useIdentifiedSaveThreadIds,
  usePlaySessions
} from '../lib/library'
import ReviewCard from '../components/ReviewCard'
import { PagerIcon, RefreshIcon, ClearIcon } from '../components/ToolbarIcons'
import PackageMetaTags from '../components/PackageMetaTags'

type DetailsTab =
  | 'overview'
  | 'about'
  | 'changelog'
  | 'userNotes'
  | 'gallery'
  | 'downloads'
  | 'files'
  | 'saves'
  | 'renpy'
  | 'reviews'

type AboutMode = 'description' | `note:${number}`
type RenpyMode = 'unren' | 'options'

function noteAboutMode(index: number): AboutMode {
  return `note:${index}`
}

function noteIndexFromAboutMode(mode: AboutMode): number | null {
  if (!mode.startsWith('note:')) return null
  const index = Number(mode.slice(5))
  return Number.isInteger(index) ? index : null
}

type GameDetailsPageProps = {
  summary: GameSummary
  subscribed: boolean
  rarity?: GameRarity
  favoriteTags?: FavoriteTag[]
  hatedTags?: HatedTag[]
  onClose: () => void
  onMinimize: () => void
  onOpenThread: (threadId: number, title: string) => void
  onApplyCatalogGame: (game: CatalogGame) => void
  onToggleFollow: (game: CatalogGame) => Promise<void>
  onSetRarity?: (threadId: number, rarity: GameRarity) => Promise<void>
  onIgnoredChange?: (threadId: number, ignored: boolean) => void
  onSessionExpired: () => Promise<void>
  /** When false/undefined, P2P section is hidden */
  p2pEnabled?: boolean
  p2pSharedHashes?: ReadonlySet<string>
  initialTab?: DetailsTab
  initialTabKey?: number
  elevated?: boolean
}

function formatDate(value: string): string {
  if (!value || isRelativeDate(value)) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function engineFromFields(fields?: Array<{ label: string; value: string }>): string {
  const field = fields?.find((item) => /^engine$/i.test(item.label))
  return normalizeEngine(field?.value)
}

function fileName(path: string): string {
  return path.split(/[/\\]/).pop() || path
}

function hostLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const masked = parsed.pathname.match(/^\/masked\/([^/]+)/i)
    if (masked?.[1]) return masked[1]
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return 'Link'
  }
}

/** Mirror buttons show the link text, falling back to the host when it is a bare URL. */
function linkLabel(link: DownloadMirror): string {
  const label = link.label.trim().replace(/[*\s]+$/, '')
  if (!label || /^https?:\/\//i.test(label)) return hostLabel(link.url)
  return label
}

const SYSTEM_LABELS = OS_KIND_LABELS

const HOST_OS =
  typeof navigator === 'undefined'
    ? null
    : osKindFromNavigator(navigator.platform, navigator.userAgent)

const CONTENT_TYPE_LABELS = CONTENT_KIND_LABELS

const SECTION_KIND_LABELS: Record<DownloadSectionKind, string> = {
  current: 'Current',
  split: 'Split',
  archive: 'Archive',
  edition: 'Edition',
  patches: 'Patches',
  extras: 'Extras',
  other: 'Other'
}

function prettyVariant(value: string): string {
  const key = value.trim().toLowerCase()
  if (!key) return ''
  if (/^(hq|lq|hd|sd|4k|1080p|720p)$/i.test(key)) return key.toUpperCase()
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function sectionHeading(section: DownloadSection): string | null {
  if (section.title?.trim()) return section.title.trim()
  if (section.kind === 'current') return null
  return SECTION_KIND_LABELS[section.kind]
}

function entryHeading(entry: DownloadEntry): string {
  const parts: string[] = []
  if (entry.variants.length) parts.push(entry.variants.map(prettyVariant).filter(Boolean).join(' '))
  if (entry.systems.length) parts.push(entry.systems.map((system) => SYSTEM_LABELS[system]).join(' / '))
  if (entry.title?.trim()) parts.push(entry.title.trim())
  else if (entry.contentType !== 'game') parts.push(CONTENT_TYPE_LABELS[entry.contentType])
  if (entry.version?.trim()) parts.push(entry.version.trim())
  return parts.filter(Boolean).join(' · ') || CONTENT_TYPE_LABELS[entry.contentType]
}

function countDownloadMirrors(sections: DownloadSection[]): number {
  let total = 0
  for (const section of sections) {
    total += countDownloadMirrors(section.sections)
    for (const entry of section.entries) {
      total += entry.mirrors.length
      for (const part of entry.parts) total += part.mirrors.length
    }
  }
  return total
}

function packageHintFromEntry(entry: DownloadEntry, fallbackVersion: string): PackageTagHint | undefined {
  const os = [...new Set(entry.systems.map((system) => OS_KIND_IDS[system]))].sort((a, b) => a - b)
  const contentKind = CONTENT_KIND_IDS[entry.contentType]
  if (!Number.isFinite(contentKind)) return undefined
  // Only invent a version prefill when the kind requires one; optional kinds stay blank.
  // Always keep contentKind even when OS/version are empty (e.g. uncensor with no metadata).
  const fromEntry = (entry.version || '').trim()
  const version =
    fromEntry ||
    (contentKindRequiresVersion(contentKind) ? (fallbackVersion || '').trim() : '')
  return { os, contentKind, version }
}

function libraryFileContentKind(file: GameLibraryFile): ContentKind {
  const id = file.packageTags?.contentKind
  if (id != null && Number.isFinite(id) && id in CONTENT_KIND_BY_ID) {
    return CONTENT_KIND_BY_ID[id as ContentKindId]
  }
  return 'game'
}

function MirrorButtons({
  mirrors,
  onOpen
}: {
  mirrors: DownloadMirror[]
  onOpen: (url: string) => void
}): JSX.Element {
  return (
    <ul>
      {mirrors.map((link) => (
        <li key={link.url}>
          <button
            className="download-link"
            type="button"
            title={`${link.label} · ${hostLabel(link.url)}`}
            onClick={() => onOpen(link.url)}
          >
            {linkLabel(link)}
          </button>
        </li>
      ))}
    </ul>
  )
}

function DownloadEntryView({
  entry,
  onOpen
}: {
  entry: DownloadEntry
  onOpen: (url: string, entry: DownloadEntry) => void
}): JSX.Element {
  const heading = entryHeading(entry)
  const typeLabel = CONTENT_TYPE_LABELS[entry.contentType]
  const showType = entry.contentType !== 'game' && Boolean(entry.title?.trim())
  const forThisComputer = downloadMatchesHostOs(entry.systems, HOST_OS)

  return (
    <section className="download-group">
      <div className="download-entry-heading">
        <h3>{heading}</h3>
        {showType ? <span className="download-meta">{typeLabel}</span> : null}
        {forThisComputer ? <span className="download-meta download-meta-host">This computer</span> : null}
        {entry.unofficial ? <span className="download-meta">Unofficial</span> : null}
      </div>
      {entry.parts.length ? (
        <div className="download-parts">
          {entry.parts.map((part) => (
            <div key={`${part.index}-${part.label}`} className="download-part">
              <span className="download-part-label">{part.label || `Part ${part.index}`}</span>
              <MirrorButtons mirrors={part.mirrors} onOpen={(url) => onOpen(url, entry)} />
            </div>
          ))}
        </div>
      ) : (
        <MirrorButtons mirrors={entry.mirrors} onOpen={(url) => onOpen(url, entry)} />
      )}
    </section>
  )
}

function DownloadSectionView({
  section,
  onOpen,
  nested = false
}: {
  section: DownloadSection
  onOpen: (url: string, entry: DownloadEntry) => void
  nested?: boolean
}): JSX.Element {
  const heading = sectionHeading(section)
  const entries = [...section.entries].sort(
    (a, b) => downloadHostPreference(b.systems, HOST_OS) - downloadHostPreference(a.systems, HOST_OS)
  )
  const body = (
    <>
      {entries.map((entry, index) => (
        <DownloadEntryView
          key={`${entryHeading(entry)}-${index}`}
          entry={entry}
          onOpen={onOpen}
        />
      ))}
      {section.sections.map((child, index) => (
        <DownloadSectionView
          key={`${child.kind}-${child.title ?? 'section'}-${index}`}
          section={child}
          onOpen={onOpen}
          nested
        />
      ))}
    </>
  )

  if (!heading) return <>{body}</>

  return (
    <section className={nested ? 'download-section download-section-nested' : 'download-section'}>
      <h2>{heading}</h2>
      {body}
    </section>
  )
}

/** Catalog tiles use the preview CDN; the same path on attachments is the full file. */
function catalogPreviewToFull(url: string | null | undefined): string | null {
  if (!url) return null
  const upgraded = url.replace(/^https?:\/\/preview\.f95zone\.(?:to|com|ninja)\//i, 'https://attachments.f95zone.to/')
  return upgraded !== url ? upgraded : null
}

function isGeneratedCover(url: string): boolean {
  return /\/data\/covers\//i.test(url) || /preview\.f95zone\./i.test(url)
}

/** Follow / store metadata stays catalog-shaped; scrape only fills gaps (e.g. gallery). */
function needsCatalogMetadata(summary: GameSummary): boolean {
  return (
    !summary.checkedAt &&
    !summary.timestamp &&
    !(summary.tags && summary.tags.length) &&
    !(summary.prefixes && summary.prefixes.length)
  )
}

function toCatalogGame(summary: GameSummary, details: ThreadDetails | null): CatalogGame {
  return {
    threadId: summary.threadId,
    title: summary.title,
    creator: summary.creator,
    version: summary.version,
    views: summary.views || 0,
    likes: summary.likes || 0,
    rating: summary.rating,
    coverUrl: summary.coverUrl,
    updatedAt: summary.updatedAt || '',
    timestamp: summary.timestamp || 0,
    isNew: false,
    threadUrl: summary.threadUrl,
    prefixes: summary.prefixes ?? [],
    tags: summary.tags ?? [],
    screens: summary.screens?.length ? summary.screens : details?.gallery ?? [],
    engine: summary.engine || ''
  }
}

const skipDetailsRender = { current: false }

function GameDetailsPage({
  summary,
  subscribed,
  rarity = 'regular',
  favoriteTags = [],
  hatedTags = [],
  onClose,
  onMinimize,
  onOpenThread,
  onApplyCatalogGame,
  onToggleFollow,
  onSetRarity,
  onIgnoredChange,
  onSessionExpired,
  p2pEnabled = false,
  p2pSharedHashes,
  initialTab,
  initialTabKey = 0,
  elevated = false
}: GameDetailsPageProps): JSX.Element {
  const prefixCatalog = useCatalogPrefixes()
  const tagCatalog = useCatalogTags()
  const [details, setDetails] = useState<ThreadDetails | null>(null)
  const [busy, setBusy] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  const [catalogBusy, setCatalogBusy] = useState(false)
  const catalogLookupGen = useRef(0)
  const [tab, setTab] = useState<DetailsTab>(initialTab ?? 'overview')
  const [savesTabReady, setSavesTabReady] = useState(initialTab === 'saves')
  const [aboutMode, setAboutMode] = useState<AboutMode>('description')
  const [renpyMode, setRenpyMode] = useState<RenpyMode>('options')
  const [p2pReloadKey, setP2pReloadKey] = useState(0)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const lightboxThumbRefs = useRef<Array<HTMLButtonElement | null>>([])
  const lightboxThumbsRef = useRef<HTMLDivElement>(null)
  const lightboxStageRef = useRef<HTMLDivElement>(null)
  const lightboxDrag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 })
  const modalShellRef = useRef<HTMLDivElement>(null)
  const modalOffsetRef = useRef({ x: 0, y: 0 })
  const modalDrag = useRef({
    active: false,
    moved: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0
  })
  const backdropGesture = useRef(false)

  function applyModalOffset(x: number, y: number): void {
    modalOffsetRef.current = { x, y }
    const el = modalShellRef.current
    if (el) el.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  const lightboxSwipe = useRef({
    active: false,
    moved: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    dx: 0
  })
  const modalScrollRef = useRef<HTMLDivElement>(null)
  const modalRailRef = useRef<HTMLDivElement>(null)
  const modalScrollSyncing = useRef(false)
  const [modalRailHeight, setModalRailHeight] = useState(0)
  const [modalRailActive, setModalRailActive] = useState(false)
  const [coverBroken, setCoverBroken] = useState(!summary.coverUrl)
  const [fullCoverReady, setFullCoverReady] = useState(false)
  const [openVersions, setOpenVersions] = useState<Record<number, boolean>>({})
  const [files, setFiles] = useState<GameLibraryFile[]>([])
  const [filesReady, setFilesReady] = useState(false)
  const [installBytes, setInstallBytes] = useState<number | null>(null)
  const [transfers, setTransfers] = useState<DownloadRecord[]>([])
  const [p2pTransfers, setP2pTransfers] = useState<P2pTransferProgress[]>([])
  const [threadIdCopied, setThreadIdCopied] = useState(false)
  const [ignoreBusy, setIgnoreBusy] = useState(false)
  const [archiveBusy, setArchiveBusy] = useState(false)
  const [removeAllBusy, setRemoveAllBusy] = useState(false)
  const [reviewPage, setReviewPage] = useState(1)
  const [reviewItems, setReviewItems] = useState<ThreadReview[]>([])
  const [reviewsTotalPages, setReviewsTotalPages] = useState(1)
  const [reviewsBusy, setReviewsBusy] = useState(false)
  const [reviewsError, setReviewsError] = useState<string | null>(null)
  const [reviewsReload, setReviewsReload] = useState(0)
  const sessions = usePlaySessions()
  const saveThreadIds = useIdentifiedSaveThreadIds()
  const [now, setNow] = useState(() => Date.now())
  const [versionsExpanded, setVersionsExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setDetails(null)
    setTab('overview')
    setAboutMode('description')
    setLightbox(null)
    setOpenVersions({})
    setVersionsExpanded(false)
    setCoverBroken(!summary.coverUrl)
    setFullCoverReady(false)
    setReviewPage(1)
    setReviewItems([])
    setReviewsTotalPages(1)
    setReviewsBusy(false)
    setReviewsError(null)
    setReviewsReload(0)
    setThreadIdCopied(false)
    setIgnoreBusy(false)
    setArchiveBusy(false)
    applyModalOffset(0, 0)

    async function load(): Promise<void> {
      try {
        const next = await window.api.threads.details(summary.threadId)
        if (!cancelled) setDetails(next)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not load this thread.'
        if (message.includes('Not logged in')) {
          await onSessionExpired()
          return
        }
        notifyError(message, {
          label: 'Retry',
          onClick: () => setReloadToken((value) => value + 1)
        })
      } finally {
        if (!cancelled) setBusy(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [summary.threadId, reloadToken, onSessionExpired])

  useEffect(() => {
    if (!details) return

    const detailsComplete = details.reviewsTotal <= details.reviews.length
    // Prefer the payload from the single thread fetch. Only hit /br-reviews when
    // the user opens Reviews and the thread page didn't carry the full listing,
    // when paginating, or on explicit retry.
    const useDetailsPayload =
      reviewPage <= 1 && reviewsReload === 0 && (detailsComplete || tab !== 'reviews')

    if (useDetailsPayload) {
      setReviewItems(details.reviews)
      setReviewsTotalPages(Math.max(1, details.reviewsTotalPages || 1))
      setReviewsError(null)
      setReviewsBusy(false)
      return
    }

    let cancelled = false
    setReviewsBusy(true)
    setReviewsError(null)

    void window.api.threads
      .reviews(summary.threadId, reviewPage)
      .then((next) => {
        if (cancelled) return
        setReviewItems(next.reviews)
        setReviewsTotalPages(Math.max(1, next.totalPages))
      })
      .catch(async (err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not load reviews.'
        if (message.includes('Not logged in')) {
          await onSessionExpired()
          return
        }
        setReviewsError(message)
        notifyError(message, {
          label: 'Retry',
          onClick: () => setReviewsReload((value) => value + 1)
        })
      })
      .finally(() => {
        if (!cancelled) setReviewsBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [details, reviewPage, reviewsReload, tab, summary.threadId, onSessionExpired])

  useEffect(() => {
    let cancelled = false

    async function refreshFiles(): Promise<void> {
      const items = await window.api.library.list(summary.threadId)
      if (!cancelled) {
        setFiles(items)
        setFilesReady(true)
      }
    }

    setFilesReady(false)
    void refreshFiles()
    const stopLibrary = window.api.library.onChange((items) => {
      if (cancelled) return
      setFiles(items.filter((item) => item.threadId === summary.threadId))
      setFilesReady(true)
    })
    const stopDownloads = window.api.downloads.onChange((items) => {
      if (cancelled || modalDrag.current.active) return
      setTransfers(items)
      if (
        items.some(
          (item) => item.gameThreadId === summary.threadId && item.libraryStatus === 'indexed'
        )
      ) {
        void refreshFiles()
      }
    })
    void window.api.downloads.list().then((items) => {
      if (!cancelled) setTransfers(items)
    })
    void window.api.p2p.progress().then((items) => {
      if (!cancelled) setP2pTransfers(items)
    })
    const stopP2p = window.api.p2p.onProgress((items) => {
      if (cancelled || modalDrag.current.active) return
      setP2pTransfers(items)
    })
    return () => {
      cancelled = true
      stopLibrary()
      stopDownloads()
      stopP2p()
    }
  }, [summary.threadId])

  const installErrorsByFile = useRef(new Map<string, string>())
  useEffect(() => {
    const next = new Map<string, string>()
    for (const file of files) {
      if (!file.installError) continue
      next.set(file.id, file.installError)
      if (installErrorsByFile.current.get(file.id) !== file.installError) {
        notifyError(file.installError)
      }
    }
    installErrorsByFile.current = next
  }, [files])

  const installSignature = files
    .filter((file) => file.isInstalled && file.installPath)
    .map((file) => file.installPath)
    .sort()
    .join('|')

  useEffect(() => {
    let cancelled = false
    if (!installSignature) {
      setInstallBytes(0)
      return
    }
    setInstallBytes(null)
    void window.api.library
      .diskUsage(summary.threadId)
      .then((usage) => {
        if (!cancelled) setInstallBytes(usage.installBytes)
      })
      .catch(() => {
        if (!cancelled) setInstallBytes(0)
      })
    return () => {
      cancelled = true
    }
  }, [summary.threadId, installSignature])

  useEffect(() => {
    if (!sessions.length) return
    const timer = window.setInterval(() => {
      if (modalDrag.current.active) return
      setNow(Date.now())
    }, 1000)
    return () => window.clearInterval(timer)
  }, [sessions.length])

  // Persistent banner metadata comes from catalog/summary; scrape only fills gaps.
  const title =
    summary.title && !/^Thread \d+$/i.test(summary.title)
      ? summary.title
      : details?.title && !/^Thread \d+$/i.test(details.title)
        ? details.title
        : summary.title
  const creator = summary.creator || details?.creator || ''

  async function refreshCatalogMetadata(force: boolean): Promise<void> {
    if (!force && !needsCatalogMetadata(summary)) return
    const gen = ++catalogLookupGen.current
    setCatalogBusy(true)
    try {
      const game = await window.api.catalog.lookup({
        threadId: summary.threadId,
        title,
        creator
      })
      if (gen !== catalogLookupGen.current) return
      if (game) onApplyCatalogGame(game)
    } catch (err) {
      if (gen !== catalogLookupGen.current) return
      const message = err instanceof Error ? err.message : ''
      if (message.includes('Not logged in')) await onSessionExpired()
    } finally {
      if (gen === catalogLookupGen.current) setCatalogBusy(false)
    }
  }

  useEffect(() => {
    void refreshCatalogMetadata(false)
    // Auto-fill when opening from related-game links (no catalog row yet). Retry once
    // creator/title arrive from the thread page so title+author filters can run.
  }, [summary.threadId, title, creator, summary.checkedAt, summary.timestamp])

  const creatorLinks = useMemo(() => {
    const seen = new Set<string>()
    return (details?.creatorLinks ?? []).filter((link) => {
      if (seen.has(link.label.toLowerCase())) return false
      seen.add(link.label.toLowerCase())
      return true
    })
  }, [details])
  const overviewFields = useMemo(
    () =>
      (details?.fields ?? []).filter(
        (field) =>
          !/thread updated|thread update|^updated$|last updated|release date|^released$|publication date/i.test(
            field.label
          ) &&
          !/other games|related games|more games|also (?:try|check|play)/i.test(field.label) &&
          !/^genre$/i.test(field.label)
      ),
    [details]
  )
  // Banner / downloads / package hints use catalog version; scraped version stays in overview fields only.
  const version = summary.version || ''
  const engine =
    normalizeEngine(summary.engine) ||
    engineFromPrefixIds(summary.prefixes, prefixCatalog) ||
    normalizeEngine(details?.engine) ||
    engineFromFields(details?.fields)
  const status = useMemo(() => gameStatusFlags(summary.prefixes, prefixCatalog), [summary.prefixes, prefixCatalog])
  const packageBytes = useMemo(
    () => files.reduce((sum, file) => sum + (file.hasArchive ? file.size || 0 : 0), 0),
    [files]
  )
  const isRenpy =
    engineKind(engine) === 'renpy' || files.some((file) => engineKind(file.engine) === 'renpy')
  const isRpgMaker =
    engineKind(engine) === 'rpgmaker' || files.some((file) => engineKind(file.engine) === 'rpgmaker')
  const saveKind = useMemo(() => {
    const fromFiles = (list: GameLibraryFile[]): 'renpy' | 'rpgmaker' | null => {
      if (list.some((file) => engineKind(file.engine) === 'renpy')) return 'renpy'
      if (list.some((file) => engineKind(file.engine) === 'rpgmaker')) return 'rpgmaker'
      return null
    }
    return (
      fromFiles(files.filter((file) => file.isInstalled)) ||
      fromFiles(files) ||
      (isRenpy ? 'renpy' : isRpgMaker ? 'rpgmaker' : null)
    )
  }, [files, isRenpy, isRpgMaker])
  const previewCover = summary.coverUrl
  const guessedFull = catalogPreviewToFull(previewCover)
  const parsedCover = details?.coverUrl
  const fullCover =
    parsedCover && parsedCover !== previewCover && !isGeneratedCover(parsedCover)
      ? parsedCover
      : guessedFull || (parsedCover && parsedCover !== previewCover ? parsedCover : null)
  const coverUrl = fullCover || previewCover
  const threadUrl = summary.threadUrl || details?.threadUrl || ''
  const likes = summary.likes || 0
  const views = summary.views || 0
  const bannerTags = useMemo(() => {
    const byId = new Map(tagCatalog.map((tag) => [tag.id, tag.name]))
    const favoriteById = new Map(favoriteTags.map((tag) => [tag.id, tag.tier]))
    const hatedIds = new Set(hatedTags.map((tag) => tag.id))
    return (summary.tags ?? [])
      .map((id) => {
        const name = byId.get(id)
        if (!name) return null
        return { id, name, tier: favoriteById.get(id), hated: hatedIds.has(id) }
      })
      .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
      .sort((a, b) => {
        if (a.tier && b.tier) return TAG_TIER_RANK[b.tier] - TAG_TIER_RANK[a.tier]
        if (a.tier && !b.tier) return -1
        if (!a.tier && b.tier) return 1
        if (a.hated && !b.hated) return -1
        if (!a.hated && b.hated) return 1
        return a.name.localeCompare(b.name)
      })
  }, [tagCatalog, summary.tags, favoriteTags, hatedTags])
  const gallery = details?.gallery ?? []
  const downloads = details?.downloads ?? []
  const downloadCount = useMemo(() => countDownloadMirrors(downloads), [downloads])
  const changelog = details?.changelog ?? []
  const notes = details?.notes ?? []
  const updatedLabel =
    formatUpdateDate(summary.timestamp) || formatDate(details?.updatedAt || '') || formatDate(summary.updatedAt || '')
  const releaseDate = details?.releaseDate || ''

  const aboutModes = useMemo(() => {
    const settled = !busy
    const items: Array<{ id: AboutMode; label: string; hidden?: boolean }> = [
      { id: 'description', label: 'Description', hidden: settled && !details?.descriptionHtml },
      ...notes.map((section, index) => ({
        id: noteAboutMode(index),
        label: section.title,
        hidden: false as const
      }))
    ]
    return items.filter((item) => !item.hidden)
  }, [busy, details?.descriptionHtml, notes])

  const tabs = useMemo(() => {
    const settled = !busy
    const items: Array<{ id: DetailsTab; label: string; count?: number; hidden?: boolean }> = [
      { id: 'overview', label: 'Overview' },
      { id: 'downloads', label: 'Downloads', count: downloadCount || undefined },
      { id: 'files', label: 'Files', count: files.length },
      {
        id: 'reviews',
        label: 'Reviews',
        count: details?.reviewsTotal || details?.reviews.length,
        hidden: settled && !details?.reviews.length && !details?.reviewsTotal
      },
      {
        id: 'gallery',
        label: 'Gallery',
        count: gallery.length,
        hidden: settled && !gallery.length && initialTab !== 'gallery'
      },
      { id: 'about', label: 'About', hidden: settled && !aboutModes.length },
      { id: 'changelog', label: 'Changelog', count: changelog.length, hidden: settled && !changelog.length },
      { id: 'saves', label: 'Saves', hidden: !isRenpy && !isRpgMaker && !saveThreadIds.has(summary.threadId) },
      { id: 'userNotes', label: 'Notes' },
      { id: 'renpy', label: 'Renpy', hidden: !isRenpy }
    ]
    return items.filter((item) => !item.hidden)
  }, [
    busy,
    details,
    gallery.length,
    downloadCount,
    aboutModes.length,
    changelog.length,
    files,
    isRenpy,
    isRpgMaker,
    initialTab,
    saveThreadIds,
    summary.threadId
  ])

  useEffect(() => {
    if (tab === 'saves') setSavesTabReady(true)
  }, [tab])

  useEffect(() => {
    if (!initialTab) return
    if (tabs.some((item) => item.id === initialTab)) setTab(initialTab)
  }, [initialTab, initialTabKey, tabs])

  useEffect(() => {
    if (tabs.some((item) => item.id === tab)) return
    if (initialTab && tabs.some((item) => item.id === initialTab)) {
      setTab(initialTab)
      return
    }
    if (initialTab && !filesReady) return
    setTab(tabs[0]?.id ?? 'overview')
  }, [tabs, tab, initialTab, filesReady])

  useEffect(() => {
    if (!aboutModes.some((item) => item.id === aboutMode)) {
      setAboutMode(aboutModes[0]?.id ?? 'description')
    }
  }, [aboutModes, aboutMode])

  useEffect(() => {
    setCoverBroken(!previewCover && !fullCover)
    setFullCoverReady(false)
  }, [previewCover, fullCover])

  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    const modal = modalScrollRef.current
    if (!modal) return

    const syncRailMetrics = (): void => {
      if (modalDrag.current.active) return
      const scrollHeight = modal.scrollHeight
      const needsRail = scrollHeight > modal.clientHeight + 1
      setModalRailHeight(scrollHeight)
      setModalRailActive(needsRail)
      const rail = modalRailRef.current
      if (!rail || modalScrollSyncing.current) return
      if (Math.abs(rail.scrollTop - modal.scrollTop) > 1) rail.scrollTop = modal.scrollTop
    }

    syncRailMetrics()
    const observer = new ResizeObserver(syncRailMetrics)
    observer.observe(modal)
    const page = modal.firstElementChild
    if (page) observer.observe(page)
    return () => observer.disconnect()
  }, [details, tab, busy, files, reviewItems, gallery.length])

  useEffect(() => {
    if (!modalRailActive) return
    const modal = modalScrollRef.current
    const rail = modalRailRef.current
    if (!modal || !rail) return
    rail.scrollTop = modal.scrollTop
  }, [modalRailActive, modalRailHeight])

  function onModalScroll(): void {
    if (modalScrollSyncing.current) return
    const modal = modalScrollRef.current
    const rail = modalRailRef.current
    if (!modal || !rail) return
    modalScrollSyncing.current = true
    rail.scrollTop = modal.scrollTop
    modalScrollSyncing.current = false
  }

  function onModalRailScroll(): void {
    if (modalScrollSyncing.current) return
    const modal = modalScrollRef.current
    const rail = modalRailRef.current
    if (!modal || !rail) return
    modalScrollSyncing.current = true
    modal.scrollTop = rail.scrollTop
    modalScrollSyncing.current = false
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (lightbox != null) setLightbox(null)
        else onMinimize()
        return
      }
      if (lightbox == null) return
      if (event.key === 'ArrowRight') setLightbox((index) => (index == null ? index : (index + 1) % gallery.length))
      if (event.key === 'ArrowLeft') {
        setLightbox((index) => (index == null ? index : (index - 1 + gallery.length) % gallery.length))
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [lightbox, gallery.length, onMinimize])

  useEffect(() => {
    if (lightbox == null) return
    lightboxThumbRefs.current[lightbox]?.scrollIntoView({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest'
    })
  }, [lightbox])

  useEffect(() => {
    const thumbs = lightboxThumbsRef.current
    if (!thumbs || lightbox == null) return
    const strip: HTMLDivElement = thumbs
    const drag = lightboxDrag.current

    function onWheel(event: WheelEvent): void {
      if (!strip.scrollWidth) return
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (!delta) return
      event.preventDefault()
      strip.scrollLeft += delta
    }

    function onPointerDown(event: PointerEvent): void {
      if (event.button !== 0) return
      drag.active = true
      drag.moved = false
      drag.startX = event.clientX
      drag.startLeft = strip.scrollLeft
    }

    function onPointerMove(event: PointerEvent): void {
      if (!drag.active) return
      const dx = event.clientX - drag.startX
      if (!drag.moved && Math.abs(dx) < 8) return
      if (!drag.moved) {
        drag.moved = true
        strip.setPointerCapture(event.pointerId)
      }
      strip.scrollLeft = drag.startLeft - dx
    }

    function endDrag(event: PointerEvent): void {
      drag.active = false
      if (strip.hasPointerCapture(event.pointerId)) strip.releasePointerCapture(event.pointerId)
    }

    function onClickCapture(event: globalThis.MouseEvent): void {
      if (!drag.moved) return
      event.preventDefault()
      event.stopPropagation()
      drag.moved = false
    }

    strip.addEventListener('wheel', onWheel, { passive: false })
    strip.addEventListener('pointerdown', onPointerDown)
    strip.addEventListener('pointermove', onPointerMove)
    strip.addEventListener('pointerup', endDrag)
    strip.addEventListener('pointercancel', endDrag)
    strip.addEventListener('click', onClickCapture, true)
    return () => {
      strip.removeEventListener('wheel', onWheel)
      strip.removeEventListener('pointerdown', onPointerDown)
      strip.removeEventListener('pointermove', onPointerMove)
      strip.removeEventListener('pointerup', endDrag)
      strip.removeEventListener('pointercancel', endDrag)
      strip.removeEventListener('click', onClickCapture, true)
    }
  }, [lightbox])

  useEffect(() => {
    const stage = lightboxStageRef.current
    if (!stage || lightbox == null || gallery.length <= 1) return
    const swipe = lightboxSwipe.current
    const image = (): HTMLImageElement | null => stage.querySelector('img')
    const SWIPE_THRESHOLD = 56
    const LOCK_THRESHOLD = 10
    const WHEEL_COOLDOWN_MS = 280
    const WHEEL_THRESHOLD = 12
    let lastWheelAt = 0

    const stepLightbox = (delta: number): void => {
      setLightbox((index) =>
        index == null ? index : (index + delta + gallery.length) % gallery.length
      )
    }

    const resetTransform = (): void => {
      const img = image()
      if (!img) return
      img.style.transition = 'transform 160ms ease'
      img.style.transform = ''
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0) return
      if ((event.target as HTMLElement | null)?.closest?.('.lightbox-nav, .lightbox-close')) return
      swipe.active = true
      swipe.moved = false
      swipe.pointerId = event.pointerId
      swipe.startX = event.clientX
      swipe.startY = event.clientY
      swipe.dx = 0
      const img = image()
      if (img) img.style.transition = 'none'
    }

    const onPointerMove = (event: PointerEvent): void => {
      if (!swipe.active || event.pointerId !== swipe.pointerId) return
      const dx = event.clientX - swipe.startX
      const dy = event.clientY - swipe.startY
      if (!swipe.moved) {
        if (Math.abs(dx) < LOCK_THRESHOLD && Math.abs(dy) < LOCK_THRESHOLD) return
        if (Math.abs(dy) > Math.abs(dx)) {
          swipe.active = false
          return
        }
        swipe.moved = true
        stage.setPointerCapture(event.pointerId)
      }
      swipe.dx = dx
      const img = image()
      if (img) img.style.transform = `translateX(${dx}px)`
    }

    const endSwipe = (event: PointerEvent): void => {
      if (!swipe.active || event.pointerId !== swipe.pointerId) return
      const dx = swipe.dx
      const moved = swipe.moved
      swipe.active = false
      if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId)
      if (!moved) {
        const img = image()
        if (img) img.style.transition = ''
        return
      }
      if (Math.abs(dx) >= SWIPE_THRESHOLD) {
        const img = image()
        if (img) {
          img.style.transition = 'none'
          img.style.transform = ''
        }
        stepLightbox(dx < 0 ? 1 : -1)
        return
      }
      resetTransform()
    }

    function onClickCapture(event: globalThis.MouseEvent): void {
      if (!swipe.moved) return
      event.preventDefault()
      event.stopPropagation()
      swipe.moved = false
    }

    function onWheel(event: WheelEvent): void {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      if (Math.abs(delta) < WHEEL_THRESHOLD) return
      event.preventDefault()
      const now = performance.now()
      if (now - lastWheelAt < WHEEL_COOLDOWN_MS) return
      lastWheelAt = now
      stepLightbox(delta > 0 ? 1 : -1)
    }

    stage.addEventListener('pointerdown', onPointerDown)
    stage.addEventListener('pointermove', onPointerMove)
    stage.addEventListener('pointerup', endSwipe)
    stage.addEventListener('pointercancel', endSwipe)
    stage.addEventListener('click', onClickCapture, true)
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      stage.removeEventListener('pointerdown', onPointerDown)
      stage.removeEventListener('pointermove', onPointerMove)
      stage.removeEventListener('pointerup', endSwipe)
      stage.removeEventListener('pointercancel', endSwipe)
      stage.removeEventListener('click', onClickCapture, true)
      stage.removeEventListener('wheel', onWheel)
    }
  }, [lightbox, gallery.length])

  const latestInstalled = useMemo(() => {
    const installed = files.filter(
      (file) => file.isInstalled && isInstallableLibraryPackage(file.packageTags)
    )
    if (!installed.length) return null
    return [...installed].sort((a, b) => {
      const versions = compareGameVersions(a.version, b.version)
      if (versions) return versions
      return (a.installedAt || 0) - (b.installedAt || 0)
    }).at(-1) ?? null
  }, [files])

  const lastPlayedFile = useMemo(() => {
    return files
      .filter((file) => file.lastPlayedAt)
      .sort((a, b) => (a.lastPlayedAt || 0) - (b.lastPlayedAt || 0))
      .at(-1) ?? null
  }, [files])

  const lastPlayedVersion = summary.lastPlayedVersion || lastPlayedFile?.version || ''
  const lastPlayedAt = summary.lastPlayedAt || lastPlayedFile?.lastPlayedAt || 0
  const threadSessions = useMemo(
    () => sessions.filter((session) => session.threadId === summary.threadId),
    [sessions, summary.threadId]
  )
  const playedVersions = useMemo(
    () => mergeVersionPlayStats(versionPlayStatsFromFiles(files), summary.playedVersions),
    [files, summary.playedVersions]
  )
  const latestVersionKey = usableVersion(version)
  const lastPlayedVersionKey = usableVersion(lastPlayedVersion)
  const collapsedVersions = useMemo(() => {
    if (!playedVersions.length) return []
    const latest =
      (latestVersionKey
        ? playedVersions.find((item) => item.version === latestVersionKey)
        : null) || playedVersions[0]
    const lastPlayed =
      (lastPlayedVersionKey
        ? playedVersions.find((item) => item.version === lastPlayedVersionKey)
        : null) ||
      [...playedVersions]
        .filter((item) => item.lastPlayedAt)
        .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0))[0] ||
      null
    const selected = new Set<string>()
    const rows: VersionPlayStat[] = []
    for (const item of playedVersions) {
      const isLatest = item.version === latest.version
      const isLastPlayed = Boolean(lastPlayed && item.version === lastPlayed.version)
      if (!isLatest && !isLastPlayed) continue
      if (selected.has(item.version)) continue
      selected.add(item.version)
      rows.push(item)
    }
    return rows
  }, [playedVersions, latestVersionKey, lastPlayedVersionKey])
  const visibleVersions = versionsExpanded ? playedVersions : collapsedVersions
  const hiddenVersionCount = Math.max(0, playedVersions.length - collapsedVersions.length)
  const totalPlaytimeMs = Math.max(
    summary.playtimeMs || 0,
    files.reduce((sum, file) => sum + (file.playtimeMs || 0), 0)
  )
  const updates = gameUpdateState({
    latestVersion: version,
    installedVersion: latestInstalled?.version,
    lastPlayedVersion,
    playedVersions
  })

  const pendingInstall = useMemo(() => {
    if (latestInstalled) return null
    const candidates = files.filter(
      (file) =>
        file.hasArchive &&
        !file.isInstalled &&
        isInstallableLibraryPackage(file.packageTags)
    )
    if (!candidates.length) return null
    return (
      [...candidates]
        .sort((a, b) => {
          const versions = compareGameVersions(a.version, b.version)
          if (versions) return versions
          return (a.downloadedAt || 0) - (b.downloadedAt || 0)
        })
        .at(-1) ?? null
    )
  }, [files, latestInstalled])

  const libraryFileSections = useMemo(() => {
    const buckets = new Map<ContentKind, GameLibraryFile[]>()
    for (const file of files) {
      const kind = libraryFileContentKind(file)
      const list = buckets.get(kind)
      if (list) list.push(file)
      else buckets.set(kind, [file])
    }
    return LIBRARY_FILE_SECTION_ORDER.flatMap((kind) => {
      const items = buckets.get(kind)
      if (!items?.length) return []
      return [{ kind, label: CONTENT_KIND_LABELS[kind], items }]
    })
  }, [files])

  const installingFile = useMemo(
    () => files.find((file) => file.installPercent != null) ?? null,
    [files]
  )

  const hasLocalCopy = useMemo(
    () => files.some((file) => file.hasArchive || file.isInstalled),
    [files]
  )
  const hasArchive = useMemo(
    () =>
      files.some(
        (file) => file.hasArchive && isInstallableLibraryPackage(file.packageTags)
      ),
    [files]
  )
  const hasSaves = saveThreadIds.has(summary.threadId)
  const canRemoveEverything = hasLocalCopy || hasSaves || files.length > 0

  const gameTransfers = useMemo(
    () =>
      transfers.filter((item) => {
        if (item.gameThreadId !== summary.threadId) return false
        if (installingFile && transferMatchesLibraryFile(item, installingFile)) return false
        return (
          isActiveDownload(item) ||
          item.libraryStatus === 'hashing' ||
          item.libraryStatus === 'pendingReview' ||
          item.libraryStatus === 'error' ||
          (item.status === 'completed' && item.libraryStatus !== 'indexed')
        )
      }),
    [transfers, summary.threadId, installingFile]
  )

  const gameP2pTransfers = useMemo(
    () =>
      p2pEnabled
        ? p2pTransfers.filter((item) => {
            if (installingFile && transferMatchesLibraryFile(item, installingFile)) return false
            return (
              isActiveP2pDownload(item, p2pSharedHashes) &&
              (item.f95ThreadId === summary.threadId ||
                (item.gameName != null && item.gameName === title))
            )
          })
        : [],
    [p2pEnabled, p2pTransfers, p2pSharedHashes, summary.threadId, title, installingFile]
  )

  async function openUrl(url: string, entry?: DownloadEntry): Promise<void> {
    const packageHint = entry ? packageHintFromEntry(entry, version) : undefined
    const entryVersion = (entry?.version || '').trim()
    const requiresVersion =
      entry != null && contentKindRequiresVersion(CONTENT_KIND_IDS[entry.contentType])
    const contextVersion = entry
      ? entryVersion || (requiresVersion ? version : '')
      : version
    await window.api.shell.open(url, {
      threadId: summary.threadId,
      title,
      version: contextVersion,
      engine,
      creator,
      coverUrl: coverUrl || summary.coverUrl,
      rating: summary.rating,
      likes: summary.likes,
      views: summary.views,
      threadUrl: summary.threadUrl || details?.threadUrl,
      prefixes: summary.prefixes,
      tags: summary.tags,
      timestamp: summary.timestamp,
      updatedAt: summary.updatedAt,
      screens: summary.screens,
      packageHint
    })
  }

  async function approveTransfer(id: string, tags: PackageInstallTags): Promise<void> {
    setTransfers(await window.api.downloads.approve(id, tags))
  }

  async function rejectTransfer(id: string): Promise<void> {
    setTransfers(await window.api.downloads.reject(id))
  }

  async function flagTransfer(id: string): Promise<void> {
    setTransfers(await window.api.downloads.flag(id))
  }

  async function pauseP2pTransfer(id: string): Promise<void> {
    await window.api.p2p.pause(id)
  }

  async function resumeP2pTransfer(id: string): Promise<void> {
    await window.api.p2p.resume(id)
  }

  async function stopP2pTransfer(id: string): Promise<void> {
    await window.api.p2p.remove(id, true)
  }

  async function revealP2pQuarantine(id: string): Promise<void> {
    await window.api.p2p.revealQuarantine(id)
  }

  async function approveP2pQuarantine(id: string, tags: PackageInstallTags): Promise<void> {
    await window.api.p2p.approveQuarantine(id, tags)
    setTransfers(await window.api.downloads.list())
  }

  async function rejectP2pQuarantine(id: string): Promise<void> {
    await window.api.p2p.rejectQuarantine(id)
  }

  async function flagP2pQuarantine(id: string): Promise<void> {
    await window.api.p2p.flagQuarantine(id)
  }

  function openDownloadsTab(): void {
    setTab('downloads')
    setP2pReloadKey((n) => n + 1)
  }

  async function installFile(id: string): Promise<void> {
    try {
      await window.api.library.install(id, engine)
    } catch (err) {
      notifyCaught(err, 'Could not install that archive.')
    }
  }

  async function installUncensorPatch(patchId: string, targetFileId: string): Promise<void> {
    try {
      await window.api.library.installUncensorPatch(patchId, targetFileId)
    } catch (err) {
      notifyCaught(err, 'Could not install that uncensor patch.')
    }
  }

  async function uninstallUncensorPatch(gameFileId: string, patch: InstalledPatchRef): Promise<void> {
    try {
      await window.api.library.uninstallUncensorPatch(gameFileId, {
        patchId: patch.patchId,
        hash: patch.hash,
        uninstallSlot: patch.uninstallSlot
      })
    } catch (err) {
      notifyCaught(err, 'Could not remove that uncensor patch.')
    }
  }

  async function playFile(id: string): Promise<void> {
    try {
      await window.api.library.play(id, engine)
    } catch (err) {
      notifyCaught(err, 'Could not start the game.')
    }
  }

  async function playLatest(): Promise<void> {
    try {
      await window.api.library.playLatest(summary.threadId, engine)
    } catch (err) {
      notifyCaught(err, 'Could not start the game.')
    }
  }

  async function stopFile(id: string): Promise<void> {
    try {
      await window.api.library.stop(id)
    } catch (err) {
      notifyCaught(err, 'Could not stop the game.')
    }
  }

  async function stopThread(): Promise<void> {
    try {
      for (const session of threadSessions) {
        await window.api.library.stop(session.fileId)
      }
    } catch (err) {
      notifyCaught(err, 'Could not stop the game.')
    }
  }

  function sessionFor(fileId: string) {
    return threadSessions.find((session) => session.fileId === fileId) ?? null
  }

  function elapsedMs(startedAt: number, reported: number): number {
    return Math.max(reported, now - startedAt)
  }

  async function changeExecutable(id: string): Promise<void> {
    try {
      await window.api.library.pickExecutable(id)
    } catch (err) {
      notifyCaught(err, 'Could not set the executable.')
    }
  }

  async function uninstallFile(id: string): Promise<void> {
    if (!(await confirm({ title: 'Uninstall version', message: 'Uninstall this version? The extracted folder will be deleted.', confirmLabel: 'Uninstall', danger: true }))) return
    try {
      await window.api.library.uninstall(id)
    } catch (err) {
      notifyCaught(err, 'Could not uninstall that version.')
    }
  }

  async function removeVersion(id: string): Promise<void> {
    if (!(await confirm({ title: 'Remove', message: 'Remove this version? The archive and the extracted folder will both be deleted.', confirmLabel: 'Remove', danger: true }))) {
      return
    }
    try {
      setFiles(await window.api.library.removeVersion(id))
    } catch (err) {
      notifyCaught(err, 'Could not remove that version.')
    }
  }

  async function setVersionStatus(versionName: string, status: VersionPlayStatus): Promise<void> {
    if (!subscribed) return
    try {
      await window.api.subscriptions.setVersionStatus(summary.threadId, versionName, status)
    } catch (err) {
      notifyCaught(err, 'Could not update version status.')
    }
  }

  async function toggleIgnored(): Promise<void> {
    if (!details || ignoreBusy) return
    const next = !details.ignored
    setIgnoreBusy(true)
    try {
      const ignored = await window.api.threads.setIgnored(summary.threadId, next)
      setDetails((current) => (current ? { ...current, ignored } : current))
      onIgnoredChange?.(summary.threadId, ignored)
    } catch (err) {
      notifyCaught(err, next ? 'Could not ignore this game.' : 'Could not unignore this game.')
    } finally {
      setIgnoreBusy(false)
    }
  }

  async function toggleArchived(): Promise<void> {
    if (!subscribed || archiveBusy) return
    const next = !summary.archived
    setArchiveBusy(true)
    try {
      await window.api.subscriptions.setArchived(summary.threadId, next)
    } catch (err) {
      notifyCaught(err, next ? 'Could not archive this game.' : 'Could not unarchive this game.')
    } finally {
      setArchiveBusy(false)
    }
  }

  async function removeEverything(): Promise<void> {
    if (
      !(await confirm({
        title: 'Remove everything',
        message: `Remove everything for ${title}? Archives, installed copies, and save folders (including empty save and backup folders) will be deleted. This cannot be undone.`,
        confirmLabel: 'Remove everything',
        danger: true
      }))
    ) {
      return
    }
    setRemoveAllBusy(true)
    try {
      await window.api.library.removeLocalData(summary.threadId)
      setFiles(await window.api.library.list(summary.threadId))
    } catch (err) {
      notifyCaught(err, 'Could not remove that game.')
    } finally {
      setRemoveAllBusy(false)
    }
  }

  function versionStatusMenuItems(item: VersionPlayStat): MenuItem[] {
    if (!subscribed || !item.version) return []
    const current = effectiveVersionStatus(item)
    return [
      {
        id: 'mark-played',
        label: 'Mark as played',
        active: current === 'played',
        onClick: () => void setVersionStatus(item.version, 'played')
      },
      {
        id: 'mark-unplayed',
        label: 'Mark as not played',
        active: current === 'unplayed',
        onClick: () => void setVersionStatus(item.version, 'unplayed')
      },
      {
        id: 'mark-skipped',
        label: 'Skip version',
        active: current === 'skipped',
        onClick: () => void setVersionStatus(item.version, 'skipped')
      }
    ]
  }

  function moreMenuItems(file: GameLibraryFile): MenuItem[] {
    const items: MenuItem[] = []
    if (file.hasArchive) {
      items.push({
        id: 'show-archive',
        label: 'Show archive',
        onClick: () => void window.api.library.showArchive(file.id)
      })
    }
    if (file.isInstalled) {
      items.push({
        id: 'change-exe',
        label: 'Change exe',
        onClick: () => void changeExecutable(file.id)
      })
      items.push({
        id: 'open-folder',
        label: 'Open folder',
        onClick: () => void window.api.library.showInstall(file.id)
      })
    }
    return items
  }

  function onProseClick(event: MouseEvent<HTMLDivElement>): void {
    const spoilerButton = (event.target as HTMLElement).closest('.bbCodeSpoiler-button')
    if (spoilerButton) {
      event.preventDefault()
      const spoiler = spoilerButton.closest('.bbCodeSpoiler')
      spoiler?.classList.toggle('is-active')
      return
    }
    const target = (event.target as HTMLElement).closest('a')
    if (!target) return
    const href = target.getAttribute('href')
    if (!href) return
    event.preventDefault()
    const threadId = Number(target.getAttribute('data-thread-id') || 0)
    const hrefId = href.match(/\/threads\/(?:[^/?#]*\.)?(\d+)/i)
    const nextId = threadId || Number(hrefId?.[1] || 0)
    if (nextId) {
      onOpenThread(nextId, target.getAttribute('data-thread-title') || target.textContent?.trim() || '')
      return
    }
    void openUrl(href)
  }

  function copyThreadId(): void {
    void navigator.clipboard.writeText(String(summary.threadId)).then(() => {
      setThreadIdCopied(true)
      window.setTimeout(() => setThreadIdCopied(false), 1500)
    })
  }


  function isModalDragIgnoreTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return true
    if (target.closest('.details-tab')) return false
    return Boolean(
      target.closest(
        'button, a, input, textarea, select, label, .follow-btn, .rarity-slider, .details-pill, .link-chip, .chip, .ghost-btn, .switch, .menu-popover'
      )
    )
  }

  function suppressMiddleAutoscroll(
    event: ReactPointerEvent<HTMLElement> | MouseEvent<HTMLElement>
  ): void {
    if (event.button !== 1) return
    event.preventDefault()
    event.stopPropagation()
  }

  function closeOnMiddleButton(
    event: ReactPointerEvent<HTMLElement> | MouseEvent<HTMLElement>
  ): void {
    if (event.button !== 1) return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  function minimizeOnContextMenu(event: MouseEvent<HTMLElement>): void {
    event.preventDefault()
    event.stopPropagation()
    onMinimize()
  }

  function onModalDragPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    if (event.button !== 0) return
    if (isModalDragIgnoreTarget(event.target)) return
    backdropGesture.current = false
    const drag = modalDrag.current
    drag.active = true
    drag.moved = false
    drag.pointerId = event.pointerId
    drag.startX = event.clientX
    drag.startY = event.clientY
    drag.origX = modalOffsetRef.current.x
    drag.origY = modalOffsetRef.current.y
  }

  useEffect(() => {
    function onPointerMove(event: PointerEvent): void {
      const drag = modalDrag.current
      if (!drag.active || event.pointerId !== drag.pointerId) return
      const x = drag.origX + event.clientX - drag.startX
      const y = drag.origY + event.clientY - drag.startY
      if (!drag.moved && Math.hypot(x - drag.origX, y - drag.origY) < 4) return
      if (!drag.moved) {
        drag.moved = true
        skipDetailsRender.current = true
        document.body.classList.add('is-details-modal-dragging')
      }
      applyModalOffset(x, y)
    }

    function onPointerUp(event: PointerEvent): void {
      const drag = modalDrag.current
      if (!drag.active || event.pointerId !== drag.pointerId) return
      const moved = drag.moved
      drag.active = false
      drag.pointerId = -1
      skipDetailsRender.current = false
      document.body.classList.remove('is-details-modal-dragging')
      if (!moved) return
      const suppressClick = (clickEvent: globalThis.MouseEvent): void => {
        clickEvent.preventDefault()
        clickEvent.stopPropagation()
      }
      window.addEventListener('click', suppressClick, { capture: true, once: true })
    }

    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      modalDrag.current.active = false
      skipDetailsRender.current = false
      document.body.classList.remove('is-details-modal-dragging')
    }
  }, [])

  const statusPlayLabel = threadSessions.length
    ? `Playing · ${formatSessionTime(elapsedMs(threadSessions[0].startedAt, threadSessions[0].elapsedMs))}`
    : lastPlayedAt
      ? `Last played ${lastPlayedVersion || 'unknown'} · ${formatRelativeTime(lastPlayedAt)}`
      : null
  const statusParts = [
    statusPlayLabel,
    totalPlaytimeMs ? `${formatPlaytime(totalPlaytimeMs)} total` : null,
    updatedLabel ? `Thread updated ${updatedLabel}` : null
  ].filter(Boolean) as string[]
  const noteIndex = noteIndexFromAboutMode(aboutMode)
  const aboutNote = noteIndex != null ? notes[noteIndex] ?? null : null

  return (
    <div
      className={elevated ? 'details-backdrop is-elevated' : 'details-backdrop'}
      onPointerDown={(event) => {
        backdropGesture.current = event.button === 0 && event.target === event.currentTarget
        if (event.target === event.currentTarget) suppressMiddleAutoscroll(event)
      }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) suppressMiddleAutoscroll(event)
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        if (!backdropGesture.current) return
        backdropGesture.current = false
        if (lightbox != null) setLightbox(null)
        else onMinimize()
      }}
      onAuxClick={(event) => {
        if (event.target !== event.currentTarget) return
        closeOnMiddleButton(event)
      }}
      onContextMenu={(event) => {
        if (event.target !== event.currentTarget) return
        event.preventDefault()
        if (lightbox != null) setLightbox(null)
        else onMinimize()
      }}
    >
      <div className="details-modal-shell" ref={modalShellRef}>
        <div
          className={
            rarity === 'regular' ? 'details-modal-frame' : `details-modal-frame details-modal-frame-${rarity}`
          }
        >
        <div
          className="details-modal-card"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => {
            if (event.button === 0) backdropGesture.current = false
            suppressMiddleAutoscroll(event)
          }}
          onMouseDown={suppressMiddleAutoscroll}
          onAuxClick={closeOnMiddleButton}
          onContextMenu={minimizeOnContextMenu}
        >
        <div
          className="details-modal"
          ref={modalScrollRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="details-title"
          onScroll={onModalScroll}
        >
        <div className="details-page">
          <div className={coverBroken || !coverUrl ? 'details-hero details-hero-empty' : 'details-hero'} onPointerDown={onModalDragPointerDown}>
            <div className="details-hero-banner" aria-hidden="true">
              {coverBroken || !coverUrl ? (
                <div className="cover-fallback">No cover</div>
              ) : (
                <>
                  {previewCover ? (
                    <img
                      className="details-hero-preview"
                      src={previewCover}
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={() => {
                        if (!fullCover) setCoverBroken(true)
                      }}
                    />
                  ) : null}
                  {fullCover ? (
                    <img
                      className={
                        previewCover && !fullCoverReady ? 'details-hero-full' : 'details-hero-full is-ready'
                      }
                      src={fullCover}
                      alt=""
                      referrerPolicy="no-referrer"
                      onLoad={() => setFullCoverReady(true)}
                      onError={() => setFullCoverReady(false)}
                    />
                  ) : null}
                </>
              )}
            </div>
            {busy && !previewCover && !fullCover ? (
              <div className="details-hero-spinner" role="status" aria-label="Loading thread">
                <span aria-hidden="true" />
              </div>
            ) : null}
            <FollowButton
              variant="modal"
              subscribed={subscribed}
              onToggle={() => void onToggleFollow(toCatalogGame(summary, details))}
            />
            <div className="details-info">
              <div className="details-title-row">
                <h1 id="details-title" className="details-title">
                  <a
                    className="details-title-link"
                    href={threadUrl}
                    title="Open thread on F95zone"
                    onClick={(event) => {
                      event.preventDefault()
                      void openUrl(threadUrl)
                    }}
                  >
                    {title}
                  </a>
                </h1>
                <span className="details-pill">{version || 'Unknown version'}</span>
                <span className="details-engine-meta">
                  {engine ? (
                    <EngineBadge name={engine} />
                  ) : (
                    <span className="details-pill">Unknown engine</span>
                  )}
                  <LibraryPresenceIcons
                    archived={Boolean(subscribed && summary.archived)}
                    hasArchive={hasArchive}
                    hasSaves={hasSaves}
                  />
                </span>
                {status.completed ? (
                  <span className="cover-status-badge cover-status-completed" title="Completed">
                    Completed
                  </span>
                ) : null}
                {status.onHold ? (
                  <span className="cover-status-badge cover-status-onhold" title="On hold">
                    On hold
                  </span>
                ) : null}
                {status.abandoned ? (
                  <span className="cover-status-badge cover-status-abandoned" title="Abandoned">
                    Abandoned
                  </span>
                ) : null}
                {details?.ignored ? (
                  <span className="details-pill details-pill-ignored">Ignored</span>
                ) : null}
                {subscribed && summary.archived ? (
                  <span className="details-pill details-pill-archived">Archived</span>
                ) : null}
              </div>
              <div className="details-sub">
                <div className="details-sub-row">
                  {updates.updateAvailable ? (
                    <span className="details-pill details-pill-update">
                      Update from {latestInstalled?.version}
                    </span>
                  ) : null}
                  {updates.unplayedUpdate && lastPlayedVersion ? (
                    <span className="details-pill details-pill-play">
                      New since {lastPlayedVersion}
                    </span>
                  ) : null}
                  <div className="details-creator">
                    <span>{creator || 'Unknown creator'}</span>
                    {creatorLinks.map((link) => (
                      <button
                        key={link.url}
                        className="link-chip"
                        type="button"
                        onClick={() => void openUrl(link.url)}
                      >
                        {link.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="details-sub-row">
                  <span className={`details-pill ${ratingClass(summary.rating)}`}>
                    {formatRating(summary.rating)}
                  </span>
                  {likes ? (
                    <span className="details-pill">
                      {formatCount(likes)} likes
                    </span>
                  ) : null}
                  {views ? (
                    <span className="details-pill">
                      {formatCount(views)} views
                    </span>
                  ) : null}
                  {packageBytes > 0 ? (
                    <span className="details-pill">Package {formatBytes(packageBytes)}</span>
                  ) : null}
                  {installBytes ? (
                    <span className="details-pill">Installed {formatBytes(installBytes)}</span>
                  ) : null}
                  <button
                    className="details-pill details-pill-copy"
                    type="button"
                    title={threadIdCopied ? 'Copied' : 'Copy thread ID'}
                    onClick={copyThreadId}
                  >
                    {threadIdCopied ? 'Copied' : `Thread ${summary.threadId}`}
                  </button>
                </div>
              </div>
              <p className="details-status muted">
                  {statusParts.join(' · ')}
                  {statusParts.length ? ' · ' : null}
                  <span className="details-checked">
                    Data checked{' '}
                    {summary.checkedAt ? formatRelativeTime(summary.checkedAt) : 'never'}
                    <button
                      className="details-checked-refresh"
                      type="button"
                      title="Refresh catalog metadata"
                      aria-label="Refresh catalog metadata"
                      disabled={catalogBusy}
                      onClick={() => void refreshCatalogMetadata(true)}
                    >
                      <RefreshIcon spinning={catalogBusy} />
                    </button>
                  </span>
                </p>
              {bannerTags.length ? (
                <div className="details-tags">
                  {bannerTags.map((tag) => (
                    <span
                      key={tag.id}
                      className={tag.tier ? `chip chip-${tag.tier}` : tag.hated ? 'chip chip-hate' : 'chip'}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="details-actions">
                {threadSessions.length ? (
                  <button className="stop-btn" type="button" onClick={() => void stopThread()}>
                    Stop
                  </button>
                ) : null}
                {latestInstalled && !sessionFor(latestInstalled.id) ? (
                  <button className="primary-btn" type="button" onClick={() => void playLatest()}>
                    Play{latestInstalled.version ? ` ${latestInstalled.version}` : ''}
                  </button>
                ) : null}
                {installingFile ? (
                  <button className="primary-btn" type="button" disabled>
                    Installing… {installingFile.installPercent}%
                  </button>
                ) : pendingInstall ? (
                  <button
                    className="primary-btn"
                    type="button"
                    onClick={() => void installFile(pendingInstall.id)}
                  >
                    Install{pendingInstall.version ? ` ${pendingInstall.version}` : ''}
                  </button>
                ) : updates.updateAvailable ? (
                  <button className="update-btn" type="button" onClick={openDownloadsTab}>
                    Update
                    {version ? ` to ${version}` : ''}
                  </button>
                ) : filesReady && !hasLocalCopy ? (
                  <button className="primary-btn" type="button" onClick={openDownloadsTab}>
                    Download
                  </button>
                ) : null}
                <MoreMenu
                  disabled={ignoreBusy || archiveBusy || removeAllBusy}
                  items={[
                    {
                      id: 'ignore',
                      label: ignoreBusy
                        ? details?.ignored
                          ? 'Unignoring…'
                          : 'Ignoring…'
                        : details?.ignored
                          ? 'Unignore'
                          : 'Ignore',
                      disabled: !details || ignoreBusy,
                      onClick: () => void toggleIgnored()
                    },
                    ...(subscribed
                      ? [
                          {
                            id: 'archive',
                            label: archiveBusy
                              ? summary.archived
                                ? 'Unarchiving…'
                                : 'Archiving…'
                              : summary.archived
                                ? 'Unarchive'
                                : 'Archive',
                            disabled: archiveBusy,
                            onClick: () => void toggleArchived()
                          }
                        ]
                      : []),
                    ...(canRemoveEverything
                      ? [
                          {
                            id: 'remove-everything',
                            label: removeAllBusy ? 'Removing…' : 'Remove everything',
                            disabled: removeAllBusy,
                            onClick: () => void removeEverything()
                          }
                        ]
                      : [])
                  ]}
                />
                {subscribed && onSetRarity ? (
                  <RaritySlider
                    value={rarity}
                    onChange={(next) => void onSetRarity(summary.threadId, next)}
                  />
                ) : null}
              </div>
            </div>
          </div>
          {gameTransfers.length || gameP2pTransfers.length ? (
            <div className="details-transfers">
              {gameTransfers.map((item) => (
                <DownloadRow
                  key={item.id}
                  item={item}
                  compact
                  onCancel={(id) => void window.api.downloads.cancel(id)}
                  onPause={(id) => void window.api.downloads.pause(id)}
                  onResume={(id) => void window.api.downloads.resume(id)}
                  onRemove={(id) => void window.api.downloads.remove(id)}
                  onShowInFolder={(id) => void window.api.downloads.showInFolder(id)}
                  onOpenFile={(id) => void window.api.downloads.openFile(id)}
                  onApprove={(id, tags) => void approveTransfer(id, tags)}
                  onReject={(id) => void rejectTransfer(id)}
                  onFlag={(id) => void flagTransfer(id)}
                />
              ))}
              {gameP2pTransfers.map((item) => (
                <P2pTransferRow
                  key={`p2p-${item.id}`}
                  item={item}
                  compact
                  onPause={(id) => void pauseP2pTransfer(id)}
                  onResume={(id) => void resumeP2pTransfer(id)}
                  onStop={(id) => void stopP2pTransfer(id)}
                  onRevealQuarantine={(id) => void revealP2pQuarantine(id)}
                  onApproveQuarantine={(id, tags) => void approveP2pQuarantine(id, tags)}
                  onRejectQuarantine={(id) => void rejectP2pQuarantine(id)}
                  onFlagQuarantine={(id) => void flagP2pQuarantine(id)}
                />
              ))}
            </div>
          ) : null}

      <div className="details-tabs details-drag-handle" role="tablist" onPointerDown={onModalDragPointerDown}>
        {tabs.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'details-tab details-tab-active' : 'details-tab'}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
                  setTab(item.id)
                  if (item.id === 'downloads') setP2pReloadKey((n) => n + 1)
                }}
          >
            {item.label}
            {item.count ? <span className="details-tab-count">{item.count}</span> : null}
          </button>
        ))}
      </div>

      <div
        className={
          tab === 'about' && aboutMode === 'description' && aboutModes.length <= 1
            ? 'details-body details-body-description'
            : 'details-body'
        }
      >
        {tab === 'about' ? (
          <div className="about-tab">
            {aboutModes.length > 1 ? (
              <div className="match-toggle" role="group" aria-label="About sections">
                {aboutModes.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={aboutMode === item.id ? 'is-active' : undefined}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setAboutMode(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}

            {aboutMode === 'description' ? (
              details?.descriptionHtml ? (
                <div
                  className="thread-prose"
                  onClick={onProseClick}
                  dangerouslySetInnerHTML={{ __html: details.descriptionHtml }}
                />
              ) : (
                <p className="muted">
                  {busy ? 'Loading description…' : 'No overview section was found in the first post.'}
                </p>
              )
            ) : null}

            {aboutNote ? (
              <div className="notes-list">
                <section className="notes-section">
                  <div
                    className="thread-prose"
                    onClick={onProseClick}
                    dangerouslySetInnerHTML={{ __html: aboutNote.html }}
                  />
                </section>
              </div>
            ) : null}
          </div>
        ) : null}

        {tab === 'changelog' ? (
          changelog.length ? (
            <div className="changelog-list">
              {changelog.map((entry, index) => {
                const open = Boolean(openVersions[index])
                return (
                  <section key={`${entry.version}-${index}`} className="changelog-entry">
                    <button
                      className="changelog-toggle"
                      type="button"
                      aria-expanded={open}
                      onClick={() => setOpenVersions((current) => ({ ...current, [index]: !open }))}
                    >
                      <span>{entry.version}</span>
                      <span className="muted">{open ? 'Hide' : 'Show'}</span>
                    </button>
                    {open ? (
                      <div className="changelog-body" onClick={onProseClick}>
                        {entry.text}
                      </div>
                    ) : null}
                  </section>
                )
              })}
            </div>
          ) : (
            <p className="muted">{busy ? 'Loading changelog…' : 'No changelog was found.'}</p>
          )
        ) : null}

        {tab === 'userNotes' ? <UserNotesPanel threadId={summary.threadId} /> : null}

        {tab === 'gallery' ? (
          gallery.length ? (
            <div className="gallery-grid">
              {gallery.map((url, index) => (
                <button
                  key={`${url}-${index}`}
                  className="gallery-item"
                  type="button"
                  onClick={() => setLightbox(index)}
                >
                  <img src={url} alt="" referrerPolicy="no-referrer" />
                </button>
              ))}
            </div>
          ) : (
            <p className="muted">{busy ? 'Loading gallery…' : 'No full-size screenshots were found.'}</p>
          )
        ) : null}

        {tab === 'downloads' ? (
          <div className="download-list">
            {downloadCount ? (
              downloads.map((section, index) => (
                <DownloadSectionView
                  key={`${section.kind}-${section.title ?? 'current'}-${index}`}
                  section={section}
                  onOpen={(url, entry) => void openUrl(url, entry)}
                />
              ))
            ) : (
              <p className="muted">
                {busy ? 'Loading download links…' : 'No F95 download links were found in the first post.'}
              </p>
            )}
            {p2pEnabled ? (
              <GameP2pSection
                key={`p2p-${summary.threadId}-${p2pReloadKey}`}
                threadId={summary.threadId}
                gameName={title}
                onOpenFiles={() => setTab('files')}
              />
            ) : null}
          </div>
        ) : null}

        {tab === 'files' ? (
          files.length ? (
            <div className="library-file-list">
              {libraryFileSections.map((section) => (
                <section key={section.kind} className="library-file-section">
                  <h3 className="library-file-section-title">{section.label}</h3>
                  <div className="library-file-section-list">
                    {section.items.map((file) => {
                      const canInstall =
                        file.hasArchive && isInstallableLibraryPackage(file.packageTags)
                      const isUncensor = isRenpyUncensorPackage(file.packageTags)
                      const canInstallUncensor =
                        isUncensor && file.hasArchive && file.uncensorInstallable === true
                      const uncensorTargets = canInstallUncensor
                        ? listUncensorPatchTargets(files, file)
                        : []
                      const uncensorInstalledOn = isUncensor
                        ? gamesWithPatchInstalled(files, file)
                        : []
                      const tags = file.packageTags
                      // Approved tags are authoritative; never fall back to thread/game version.
                      const approvedVersion = tags
                        ? tags.version.trim()
                        : (file.version || '').trim()
                      return (
                        <article key={file.id} className="library-file">
                          <div className="library-file-main">
                            <strong title={file.archivePath || file.filename}>
                              {approvedVersion || file.filename}
                            </strong>
                            {approvedVersion ? (
                              <p
                                className="muted library-file-meta"
                                title={file.archivePath || file.filename}
                              >
                                {file.filename}
                              </p>
                            ) : null}
                            {file.lastPlayedAt || file.playtimeMs || file.isInstalled ? (
                              <p className="muted library-file-meta">
                                {[
                                  file.lastPlayedAt
                                    ? `Last played ${formatRelativeTime(file.lastPlayedAt)}`
                                    : null,
                                  file.playtimeMs ? formatPlaytime(file.playtimeMs) : null,
                                  file.isInstalled
                                    ? file.executablePath
                                      ? `Launch: ${fileName(file.executablePath)}`
                                      : 'No executable selected'
                                    : null
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                            ) : null}
                            {tags ? (
                              <PackageMetaTags
                                consensus={{
                                  os: tags.os,
                                  contentKind: tags.contentKind,
                                  version: tags.version,
                                  versionId: 0
                                }}
                                showKind={false}
                                showVersion={false}
                              />
                            ) : null}
                            {file.installedPatches?.length ? (
                              <p className="muted library-file-meta">
                                Uncensor:{' '}
                                {file.installedPatches
                                  .map((patch) => patch.filename || patch.hash.slice(0, 8))
                                  .join(', ')}
                              </p>
                            ) : null}
                            {uncensorInstalledOn.length ? (
                              <p className="muted library-file-meta">
                                Installed on{' '}
                                {uncensorInstalledOn
                                  .map(
                                    (game) =>
                                      game.packageTags?.version?.trim() ||
                                      game.version ||
                                      'Unknown'
                                  )
                                  .join(', ')}
                              </p>
                            ) : null}
                            {(() => {
                              const session = sessionFor(file.id)
                              if (!session) return null
                              return (
                                <p className="library-file-flags">
                                  <span className="file-flag file-flag-on">
                                    Playing ·{' '}
                                    {formatSessionTime(elapsedMs(session.startedAt, session.elapsedMs))}
                                  </span>
                                </p>
                              )
                            })()}
                            {file.installPercent != null ? (
                              <div
                                className="download-progress"
                                role="progressbar"
                                aria-valuenow={file.installPercent}
                              >
                                <span style={{ width: `${file.installPercent}%` }} />
                              </div>
                            ) : null}
                          </div>
                          <div className="library-file-actions">
                            {file.isInstalled ? (
                              sessionFor(file.id) ? (
                                <button
                                  className="stop-btn"
                                  type="button"
                                  onClick={() => void stopFile(file.id)}
                                >
                                  Stop
                                </button>
                              ) : file.installPercent == null ? (
                                <button
                                  className="primary-btn"
                                  type="button"
                                  onClick={() => void playFile(file.id)}
                                >
                                  Play
                                </button>
                              ) : null
                            ) : null}
                            {canInstall ? (
                              <button
                                className="primary-btn"
                                type="button"
                                disabled={file.installPercent != null}
                                onClick={() => void installFile(file.id)}
                              >
                                {file.installPercent != null
                                  ? `Installing… ${file.installPercent}%`
                                  : file.isInstalled
                                    ? 'Reinstall'
                                    : 'Install'}
                              </button>
                            ) : null}
                            {canInstallUncensor ? (
                              <UncensorInstallButton
                                targets={uncensorTargets}
                                disabled={file.installPercent != null}
                                installingLabel={
                                  file.installPercent != null
                                    ? `Installing… ${file.installPercent}%`
                                    : null
                                }
                                onInstall={(targetId) =>
                                  void installUncensorPatch(file.id, targetId)
                                }
                              />
                            ) : null}
                            {file.isInstalled && file.installedPatches?.length ? (
                              <UncensorRemoveButton
                                patches={file.installedPatches}
                                disabled={file.installPercent != null}
                                onRemove={(patch) => void uninstallUncensorPatch(file.id, patch)}
                              />
                            ) : null}
                            {file.isInstalled ? (
                              <SplitButton
                                label="Uninstall"
                                variant="ghost"
                                disabled={file.installPercent != null}
                                onClick={() => void uninstallFile(file.id)}
                                items={[
                                  {
                                    id: 'remove',
                                    label: 'Remove',
                                    onClick: () => void removeVersion(file.id)
                                  }
                                ]}
                              />
                            ) : (
                              <button
                                className="ghost-btn"
                                type="button"
                                disabled={file.installPercent != null}
                                onClick={() => void removeVersion(file.id)}
                              >
                                Remove
                              </button>
                            )}
                            <MoreMenu
                              disabled={file.installPercent != null}
                              items={moreMenuItems(file)}
                            />
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <p className="muted">
              No archives yet. Download a zip, 7z, or rar from the Downloads tab and it will be hashed
              and listed here for this version.
            </p>
          )
        ) : null}

        {savesTabReady ? (
          <div hidden={tab !== 'saves'}>
            {saveKind === 'rpgmaker' ? (
              <RpgMakerSavesPanel files={files} threadId={summary.threadId} title={title} />
            ) : (
              <RenpySavesPanel files={files} title={title} threadId={summary.threadId} />
            )}
          </div>
        ) : null}
        {tab === 'renpy' ? (
          <div className="renpy-tab">
            <div className="match-toggle" role="group" aria-label="Renpy tools">
              <button
                type="button"
                className={renpyMode === 'options' ? 'is-active' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setRenpyMode('options')}
              >
                Options
              </button>
              <button
                type="button"
                className={renpyMode === 'unren' ? 'is-active' : undefined}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setRenpyMode('unren')}
              >
                UnRen
              </button>
            </div>
            {renpyMode === 'options' ? <OptionsPanel files={files} /> : <UnRenPanel files={files} />}
          </div>
        ) : null}

        {tab === 'reviews' ? (
          reviewItems.length || reviewsTotalPages > 1 || reviewsBusy || reviewsError ? (
            <div className="review-list">
              {reviewsError ? (
                <p className="muted">
                  <button className="ghost-btn" type="button" onClick={() => setReviewsReload((value) => value + 1)}>
                    Retry
                  </button>
                </p>
              ) : reviewsBusy ? (
                <p className="muted">Loading reviews…</p>
              ) : reviewItems.length ? (
                reviewItems.map((review, index) => (
                  <ReviewCard
                    key={`${review.author}-${reviewPage}-${index}`}
                    review={review}
                    date={formatDate(review.date)}
                    onProseClick={onProseClick}
                  />
                ))
              ) : (
                <p className="muted">No reviews on this page.</p>
              )}
              {reviewsTotalPages > 1 ? (
                <div className="pager review-pager">
                  <button
                    className="ghost-btn icon-btn"
                    type="button"
                    disabled={reviewsBusy || reviewPage <= 1}
                    aria-label="Previous page"
                    onClick={() => setReviewPage((value) => Math.max(1, value - 1))}
                  >
                    <PagerIcon kind="prev" />
                  </button>
                  <span className="muted pager-label">
                    {reviewPage}/{reviewsTotalPages}
                  </span>
                  <button
                    className="ghost-btn icon-btn"
                    type="button"
                    disabled={reviewsBusy || reviewPage >= reviewsTotalPages}
                    aria-label="Next page"
                    onClick={() => setReviewPage((value) => value + 1)}
                  >
                    <PagerIcon kind="next" />
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="muted">{busy ? 'Loading reviews…' : 'No reviews were found for this thread.'}</p>
          )
        ) : null}

        {tab === 'overview' ? (
          <div className="overview-panel">
            <div className="overview-dates">
              <div>
                <span className="muted">Updated</span>
                <strong>{updatedLabel || 'Unknown'}</strong>
              </div>
              <div>
                <span className="muted">Data checked</span>
                <strong>
                  {summary.checkedAt ? formatRelativeTime(summary.checkedAt) : 'Not checked yet'}
                </strong>
              </div>
              <div>
                <span className="muted">Last played</span>
                <strong>
                  {lastPlayedAt
                    ? `${lastPlayedVersion || 'Unknown'} · ${formatRelativeTime(lastPlayedAt)}`
                    : 'Never'}
                </strong>
              </div>
              <div>
                <span className="muted">Playtime</span>
                <strong>
                  {threadSessions.length
                    ? `${formatPlaytime(totalPlaytimeMs)} · ${formatSessionTime(elapsedMs(threadSessions[0].startedAt, threadSessions[0].elapsedMs))} this session`
                    : formatPlaytime(totalPlaytimeMs)}
                </strong>
              </div>
              <div>
                <span className="muted">Released</span>
                <strong>{formatDate(releaseDate) || releaseDate || 'Unknown'}</strong>
              </div>
            </div>
            {playedVersions.length ? (
              <section className="played-versions">
                <div className="played-versions-header">
                  <h2>Versions</h2>
                  {hiddenVersionCount ? (
                    <button
                      className="ghost-btn played-versions-toggle"
                      type="button"
                      onClick={() => setVersionsExpanded((value) => !value)}
                    >
                      {versionsExpanded
                        ? 'Show less'
                        : `Show ${hiddenVersionCount} more`}
                    </button>
                  ) : null}
                </div>
                <ul className="played-versions-list">
                  {visibleVersions.map((item) => {
                    const parts = [
                      item.releasedAt ? `Released ${formatUpdateDate(item.releasedAt)}` : '',
                      item.lastPlayedAt
                        ? `Last played ${formatRelativeTime(item.lastPlayedAt, now)}`
                        : ''
                    ].filter(Boolean)
                    const isLatest =
                      (latestVersionKey
                        ? item.version === latestVersionKey
                        : item.version === playedVersions[0]?.version) && Boolean(item.version)
                    const status = effectiveVersionStatus(item)
                    const isUnplayedLatest = isLatest && status === 'unplayed'
                    const statusItems = versionStatusMenuItems(item)
                    const statusLabel =
                      status === 'skipped'
                        ? 'Skipped'
                        : status === 'played'
                          ? 'Played'
                          : 'Unplayed'
                    return (
                      <li
                        key={item.version || '__unknown__'}
                        className={[
                          isUnplayedLatest ? 'played-versions-latest-new' : '',
                          status === 'skipped' ? 'played-versions-skipped' : ''
                        ]
                          .filter(Boolean)
                          .join(' ') || undefined}
                      >
                        <strong className="played-versions-version">
                          {item.version || 'Unknown'}
                        </strong>
                        <span className="muted">{parts.join(' · ') || '—'}</span>
                        <div className="played-versions-aside">
                          <span className={`played-versions-status status-${status}`}>
                            {statusLabel}
                          </span>
                          <span className="played-versions-playtime">
                            {item.lastPlayedAt || item.playtimeMs
                              ? formatPlaytime(item.playtimeMs)
                              : '—'}
                          </span>
                          {statusItems.length ? (
                            <MoreMenu items={statusItems} label={`Version ${item.version} actions`} />
                          ) : null}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ) : null}
            {details?.relatedGames.length ? (
              <section className="related-games">
                <h2>Related games</h2>
                <ul>
                  {details.relatedGames.map((game) => (
                    <li key={game.threadId}>
                      <button type="button" onClick={() => onOpenThread(game.threadId, game.title)}>
                        {game.title}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {overviewFields.length ? (
              <dl className="details-fields">
                {overviewFields.map((field) => (
                  <div key={field.label} className="details-field">
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="muted">{busy ? 'Reading the first post…' : 'No overview fields were found in the first post.'}</p>
            )}
          </div>
        ) : null}
      </div>

      {lightbox != null && gallery[lightbox]
        ? createPortal(
            <div className={elevated ? 'lightbox is-elevated' : 'lightbox'} onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
              <button
                className="lightbox-close"
                type="button"
                aria-label="Close gallery"
                onClick={(event) => {
                  event.stopPropagation()
                  setLightbox(null)
                }}
              >
                <ClearIcon />
              </button>
              <div className="lightbox-stage" ref={lightboxStageRef}>
                <img
                  src={gallery[lightbox]}
                  alt=""
                  referrerPolicy="no-referrer"
                  draggable={false}
                  onClick={(event) => event.stopPropagation()}
                />
                {gallery.length > 1 ? (
                  <>
                    <button
                      className="lightbox-nav lightbox-prev"
                      type="button"
                      aria-label="Previous photo"
                      onClick={(event) => {
                        event.stopPropagation()
                        setLightbox((index) => (index == null ? 0 : (index - 1 + gallery.length) % gallery.length))
                      }}
                    >
                      ‹
                    </button>
                    <button
                      className="lightbox-nav lightbox-next"
                      type="button"
                      aria-label="Next photo"
                      onClick={(event) => {
                        event.stopPropagation()
                        setLightbox((index) => (index == null ? 0 : (index + 1) % gallery.length))
                      }}
                    >
                      ›
                    </button>
                  </>
                ) : null}
              </div>
              {gallery.length > 1 ? (
                <div
                  ref={lightboxThumbsRef}
                  className="lightbox-thumbs"
                  role="listbox"
                  aria-label="Gallery thumbnails"
                  onClick={(event) => event.stopPropagation()}
                >
                  {gallery.map((url, index) => (
                    <button
                      key={`${url}-${index}`}
                      ref={(node) => {
                        lightboxThumbRefs.current[index] = node
                      }}
                      className={index === lightbox ? 'lightbox-thumb is-active' : 'lightbox-thumb'}
                      type="button"
                      role="option"
                      aria-selected={index === lightbox}
                      title={`Photo ${index + 1} of ${gallery.length}`}
                      onClick={() => setLightbox(index)}
                    >
                      <img src={url} alt="" referrerPolicy="no-referrer" draggable={false} />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>,
            document.body
          )
        : null}
        </div>
        </div>
        </div>
        <div className="details-modal-rail-slot" aria-hidden="true">
          {modalRailActive ? (
            <div
              className="details-modal-rail"
              ref={modalRailRef}
              onClick={(event) => event.stopPropagation()}
              onPointerDown={suppressMiddleAutoscroll}
              onMouseDown={suppressMiddleAutoscroll}
              onAuxClick={closeOnMiddleButton}
              onContextMenu={minimizeOnContextMenu}
              onScroll={onModalRailScroll}
            >
              <div className="details-modal-rail-spacer" style={{ height: modalRailHeight }} />
            </div>
          ) : null}
        </div>
        </div>
      </div>
    </div>
  )
}

export default memo(GameDetailsPage, () => skipDetailsRender.current)
