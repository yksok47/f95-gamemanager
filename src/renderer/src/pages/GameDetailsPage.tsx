import { useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react'
import type {
  CatalogGame,
  DownloadContentType,
  DownloadEntry,
  DownloadMirror,
  DownloadRecord,
  DownloadSection,
  DownloadSectionKind,
  DownloadSystem,
  FavoriteTag,
  HatedTag,
  GameLibraryFile,
  GameRarity,
  GameSummary,
  ThreadDetails,
  ThreadReview
} from '@shared/types'
import { pickLikeCount, pickViewCount } from '@shared/counts'
import { TAG_TIER_RANK } from '@shared/types'
import { compareGameVersions, engineKind, normalizeEngine } from '@shared/engines'
import { gameStatusFlags } from '@shared/prefixes'
import { formatPlaytime, formatRelativeTime, formatSessionTime, formatUpdateDate, gameUpdateState, isRelativeDate } from '@shared/updates'
import EngineBadge from '../components/EngineBadge'
import FollowButton from '../components/FollowButton'
import RaritySlider from '../components/RaritySlider'
import DownloadRow from '../components/DownloadRow'
import GameP2pSection from '../components/GameP2pSection'
import { confirm } from '../components/ConfirmDialog'
import { MoreMenu, SplitButton, type MenuItem } from '../components/MenuPopover'
import RenpySavesPanel from '../components/RenpySavesPanel'
import RpgMakerSavesPanel from '../components/RpgMakerSavesPanel'
import OptionsPanel from '../components/OptionsPanel'
import UnRenPanel from '../components/UnRenPanel'
import { useCatalogPrefixes } from '../lib/catalog-prefixes'
import { favoriteTierByName, isHatedTagName } from '../lib/favorites'
import { formatBytes, isActiveDownload } from '../lib/downloads'
import { formatCount, formatRating, ratingClass } from '../lib/format'
import ReviewCard from '../components/ReviewCard'
import { RefreshIcon } from '../components/ToolbarIcons'
import { usePlaySessions } from '../lib/library'

type DetailsTab =
  | 'overview'
  | 'description'
  | 'notes'
  | 'gallery'
  | 'changelog'
  | 'downloads'
  | 'files'
  | 'saves'
  | 'unren'
  | 'options'
  | 'reviews'

type GameDetailsPageProps = {
  summary: GameSummary
  subscribed: boolean
  rarity?: GameRarity
  favoriteTags?: FavoriteTag[]
  hatedTags?: HatedTag[]
  onClose: () => void
  onOpenThread: (threadId: number, title: string) => void
  onToggleFollow: (game: CatalogGame) => Promise<void>
  onRefresh?: (threadId: number) => Promise<void>
  onSetRarity?: (threadId: number, rarity: GameRarity) => Promise<void>
  onSessionExpired: () => Promise<void>
  /** When false/undefined, P2P section is hidden */
  p2pEnabled?: boolean
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

const SYSTEM_LABELS: Record<DownloadSystem, string> = {
  win: 'Windows',
  linux: 'Linux',
  mac: 'Mac',
  android: 'Android',
  ios: 'iOS',
  web: 'Web',
  html: 'HTML',
  joiplay: 'JoiPlay'
}

const CONTENT_TYPE_LABELS: Record<DownloadContentType, string> = {
  game: 'Game',
  fix: 'Fix',
  compressed: 'Compressed',
  patch: 'Patch',
  mod: 'Mod',
  walkthrough: 'Walkthrough',
  cheat: 'Cheat',
  translation: 'Translation',
  save: 'Save',
  guide: 'Guide',
  dlc: 'DLC',
  extra: 'Extra',
  other: 'Other'
}

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
  onOpen: (url: string) => void
}): JSX.Element {
  const heading = entryHeading(entry)
  const typeLabel = CONTENT_TYPE_LABELS[entry.contentType]
  const showType = entry.contentType !== 'game' && Boolean(entry.title?.trim())

  return (
    <section className="download-group">
      <div className="download-entry-heading">
        <h3>{heading}</h3>
        {showType ? <span className="download-meta">{typeLabel}</span> : null}
        {entry.unofficial ? <span className="download-meta">Unofficial</span> : null}
      </div>
      {entry.parts.length ? (
        <div className="download-parts">
          {entry.parts.map((part) => (
            <div key={`${part.index}-${part.label}`} className="download-part">
              <span className="download-part-label">{part.label || `Part ${part.index}`}</span>
              <MirrorButtons mirrors={part.mirrors} onOpen={onOpen} />
            </div>
          ))}
        </div>
      ) : (
        <MirrorButtons mirrors={entry.mirrors} onOpen={onOpen} />
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
  onOpen: (url: string) => void
  nested?: boolean
}): JSX.Element {
  const heading = sectionHeading(section)
  const body = (
    <>
      {section.entries.map((entry, index) => (
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

function toCatalogGame(summary: GameSummary, details: ThreadDetails | null): CatalogGame {
  return {
    threadId: summary.threadId,
    title: details?.title || summary.title,
    creator: details?.creator || summary.creator,
    version: details?.version || summary.version,
    views: pickViewCount(summary.views, details?.views),
    likes: pickLikeCount(summary.likes, details?.likes),
    rating: summary.rating,
    coverUrl: details?.coverUrl || summary.coverUrl,
    updatedAt: details?.updatedAt || summary.updatedAt || '',
    timestamp: summary.timestamp || 0,
    isNew: false,
    threadUrl: details?.threadUrl || summary.threadUrl,
    prefixes: summary.prefixes ?? [],
    tags: summary.tags ?? [],
    screens: summary.screens?.length ? summary.screens : details?.gallery ?? [],
    engine: details?.engine || summary.engine || ''
  }
}

export default function GameDetailsPage({
  summary,
  subscribed,
  rarity = 'regular',
  favoriteTags = [],
  hatedTags = [],
  onClose,
  onOpenThread,
  onToggleFollow,
  onRefresh,
  onSetRarity,
  onSessionExpired,
  p2pEnabled = false
}: GameDetailsPageProps): JSX.Element {
  const prefixCatalog = useCatalogPrefixes()
  const [details, setDetails] = useState<ThreadDetails | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [tab, setTab] = useState<DetailsTab>('description')
  const [p2pReloadKey, setP2pReloadKey] = useState(0)
  const [lightbox, setLightbox] = useState<number | null>(null)
  const lightboxThumbRefs = useRef<Array<HTMLButtonElement | null>>([])
  const lightboxThumbsRef = useRef<HTMLDivElement>(null)
  const lightboxDrag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 })
  const [coverBroken, setCoverBroken] = useState(!summary.coverUrl)
  const [fullCoverReady, setFullCoverReady] = useState(false)
  const [openVersions, setOpenVersions] = useState<Record<number, boolean>>({})
  const [files, setFiles] = useState<GameLibraryFile[]>([])
  const [filesReady, setFilesReady] = useState(false)
  const [installBytes, setInstallBytes] = useState<number | null>(null)
  const [transfers, setTransfers] = useState<DownloadRecord[]>([])
  const [threadIdCopied, setThreadIdCopied] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [playError, setPlayError] = useState<string | null>(null)
  const [refreshingMeta, setRefreshingMeta] = useState(false)
  const [reviewPage, setReviewPage] = useState(1)
  const [reviewItems, setReviewItems] = useState<ThreadReview[]>([])
  const [reviewsTotalPages, setReviewsTotalPages] = useState(1)
  const [reviewsBusy, setReviewsBusy] = useState(false)
  const [reviewsError, setReviewsError] = useState<string | null>(null)
  const [reviewsReload, setReviewsReload] = useState(0)
  const sessions = usePlaySessions()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError(null)
    setDetails(null)
    setTab('description')
    setLightbox(null)
    setOpenVersions({})
    setCoverBroken(!summary.coverUrl)
    setFullCoverReady(false)
    setReviewPage(1)
    setReviewItems([])
    setReviewsTotalPages(1)
    setReviewsBusy(false)
    setReviewsError(null)
    setReviewsReload(0)
    setThreadIdCopied(false)

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
        setError(message)
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

    setInstallError(null)
    setPlayError(null)
    setFilesReady(false)
    void refreshFiles()
    const stopLibrary = window.api.library.onChange(() => {
      void refreshFiles()
    })
    const stopDownloads = window.api.downloads.onChange((items) => {
      if (cancelled) return
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
    return () => {
      cancelled = true
      stopLibrary()
      stopDownloads()
    }
  }, [summary.threadId])

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
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [sessions.length])

  const title = details?.title && !/^Thread \d+$/i.test(details.title) ? details.title : summary.title
  const creator = details?.creator || summary.creator
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
  const version = details?.version || summary.version
  const engine = normalizeEngine(details?.engine) || engineFromFields(details?.fields)
  const status = useMemo(() => {
    const fromPrefixes = gameStatusFlags(summary.prefixes, prefixCatalog)
    const statusValue =
      details?.fields.find((field) => /^status$/i.test(field.label))?.value ?? ''
    return {
      completed: fromPrefixes.completed || /\b(completed?|complete)\b/i.test(statusValue),
      abandoned: fromPrefixes.abandoned || /\babandoned\b/i.test(statusValue),
      onHold: fromPrefixes.onHold || /\bon[\s-]?hold\b/i.test(statusValue)
    }
  }, [summary.prefixes, prefixCatalog, details?.fields])
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
  const threadUrl = details?.threadUrl || summary.threadUrl
  const likes = pickLikeCount(summary.likes, details?.likes)
  const views = pickViewCount(summary.views, details?.views)
  const gallery = details?.gallery ?? []
  const downloads = details?.downloads ?? []
  const downloadCount = useMemo(() => countDownloadMirrors(downloads), [downloads])
  const changelog = details?.changelog ?? []
  const notes = details?.notes ?? []
  const updatedLabel =
    formatUpdateDate(summary.timestamp) || formatDate(details?.updatedAt || '') || formatDate(summary.updatedAt || '')
  const releaseDate = details?.releaseDate || ''

  const tabs = useMemo(() => {
    const settled = !busy
    const items: Array<{ id: DetailsTab; label: string; count?: number; hidden?: boolean }> = [
      { id: 'description', label: 'Description', hidden: settled && !details?.descriptionHtml },
      { id: 'notes', label: 'Notes', count: notes.length, hidden: settled && !notes.length },
      { id: 'gallery', label: 'Gallery', count: gallery.length, hidden: settled && !gallery.length },
      { id: 'changelog', label: 'Changelog', count: changelog.length, hidden: settled && !changelog.length },
      { id: 'downloads', label: 'Downloads', count: downloadCount || undefined },
      { id: 'files', label: 'Files', count: files.length },
      { id: 'saves', label: 'Saves', hidden: !isRenpy && !isRpgMaker },
      { id: 'unren', label: 'UnRen', hidden: !isRenpy },
      { id: 'options', label: 'Options', hidden: !isRenpy },
      {
        id: 'reviews',
        label: 'Reviews',
        count: details?.reviewsTotal || details?.reviews.length,
        hidden: settled && !details?.reviews.length && !details?.reviewsTotal
      },
      { id: 'overview', label: 'Overview' }
    ]
    return items.filter((item) => !item.hidden)
  }, [busy, details, gallery.length, downloadCount, changelog.length, notes.length, files, isRenpy, isRpgMaker])

  useEffect(() => {
    if (!tabs.some((item) => item.id === tab)) setTab(tabs[0]?.id ?? 'overview')
  }, [tabs, tab])

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
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        if (lightbox != null) setLightbox(null)
        else onClose()
        return
      }
      if (lightbox == null) return
      if (event.key === 'ArrowRight') setLightbox((index) => (index == null ? index : (index + 1) % gallery.length))
      if (event.key === 'ArrowLeft') {
        setLightbox((index) => (index == null ? index : (index - 1 + gallery.length) % gallery.length))
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox, gallery.length, onClose])

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

  const latestInstalled = useMemo(() => {
    const installed = files.filter((file) => file.isInstalled)
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
  const totalPlaytimeMs =
    (summary.playtimeMs || 0) ||
    files.reduce((sum, file) => sum + (file.playtimeMs || 0), 0)
  const updates = gameUpdateState({
    latestVersion: version,
    installedVersion: latestInstalled?.version,
    lastPlayedVersion
  })

  const pendingInstall = useMemo(() => {
    if (latestInstalled) return null
    const candidates = files.filter((file) => file.hasArchive && !file.isInstalled)
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

  const installingFile = useMemo(
    () => files.find((file) => file.installPercent != null) ?? null,
    [files]
  )

  const hasLocalCopy = useMemo(
    () => files.some((file) => file.hasArchive || file.isInstalled),
    [files]
  )

  const gameTransfers = useMemo(
    () =>
      transfers.filter(
        (item) =>
          item.gameThreadId === summary.threadId &&
          (isActiveDownload(item) ||
            item.libraryStatus === 'hashing' ||
            item.libraryStatus === 'error' ||
            (item.status === 'completed' && item.libraryStatus !== 'indexed'))
      ),
    [transfers, summary.threadId]
  )

  async function openUrl(url: string): Promise<void> {
    await window.api.shell.open(url, {
      threadId: summary.threadId,
      title,
      version,
      engine,
      creator,
      coverUrl: coverUrl || summary.coverUrl,
      rating: summary.rating,
      likes: pickLikeCount(summary.likes, details?.likes),
      views: pickViewCount(summary.views, details?.views),
      threadUrl: details?.threadUrl || summary.threadUrl,
      prefixes: summary.prefixes,
      tags: summary.tags,
      timestamp: summary.timestamp,
      updatedAt: details?.updatedAt || summary.updatedAt,
      screens: summary.screens
    })
  }

  function openDownloadsTab(): void {
    setTab('downloads')
    setP2pReloadKey((n) => n + 1)
  }

  async function installFile(id: string): Promise<void> {
    setInstallError(null)
    try {
      await window.api.library.install(id, engine)
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Could not install that archive.')
    }
  }

  async function playFile(id: string): Promise<void> {
    setPlayError(null)
    try {
      await window.api.library.play(id, engine)
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'Could not start the game.')
    }
  }

  async function playLatest(): Promise<void> {
    setPlayError(null)
    try {
      await window.api.library.playLatest(summary.threadId, engine)
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'Could not start the game.')
    }
  }

  async function stopFile(id: string): Promise<void> {
    setPlayError(null)
    try {
      await window.api.library.stop(id)
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'Could not stop the game.')
    }
  }

  async function stopThread(): Promise<void> {
    setPlayError(null)
    try {
      for (const session of threadSessions) {
        await window.api.library.stop(session.fileId)
      }
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'Could not stop the game.')
    }
  }

  async function refreshMetadata(): Promise<void> {
    if (!onRefresh) return
    setPlayError(null)
    setRefreshingMeta(true)
    try {
      await onRefresh(summary.threadId)
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'Could not refresh metadata.')
    } finally {
      setRefreshingMeta(false)
    }
  }

  function sessionFor(fileId: string) {
    return threadSessions.find((session) => session.fileId === fileId) ?? null
  }

  function elapsedMs(startedAt: number, reported: number): number {
    return Math.max(reported, now - startedAt)
  }

  async function changeExecutable(id: string): Promise<void> {
    setPlayError(null)
    try {
      await window.api.library.pickExecutable(id)
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'Could not set the executable.')
    }
  }

  async function uninstallFile(id: string): Promise<void> {
    if (!(await confirm({ title: 'Uninstall version', message: 'Uninstall this version? The extracted folder will be deleted.', confirmLabel: 'Uninstall', danger: true }))) return
    setInstallError(null)
    try {
      await window.api.library.uninstall(id)
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Could not uninstall that version.')
    }
  }

  async function removeArchive(id: string): Promise<void> {
    if (!(await confirm({ title: 'Delete archive', message: 'Delete the archive for this version? The install folder is kept.', confirmLabel: 'Delete archive', danger: true }))) return
    setInstallError(null)
    try {
      await window.api.library.removeArchive(id)
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Could not remove that archive.')
    }
  }

  async function removeVersion(id: string): Promise<void> {
    if (!(await confirm({ title: 'Remove version', message: 'Remove this version? The archive and the extracted folder will both be deleted.', confirmLabel: 'Remove', danger: true }))) {
      return
    }
    setInstallError(null)
    try {
      setFiles(await window.api.library.removeVersion(id))
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Could not remove that version.')
    }
  }

  function removeMenuItems(file: GameLibraryFile): MenuItem[] {
    const items: MenuItem[] = []
    if (file.hasArchive) {
      items.push({
        id: 'remove-archive',
        label: 'Remove archive',
        onClick: () => void removeArchive(file.id)
      })
    }
    items.push({
      id: 'remove-version',
      label: 'Remove version',
      onClick: () => void removeVersion(file.id)
    })
    return items
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
  const showCheckedStatus = Boolean(summary.checkedAt || (subscribed && onRefresh))
  const showStatusLine = statusParts.length > 0 || showCheckedStatus

  function handleShellClick(event: MouseEvent<HTMLDivElement>): void {
    const page = event.currentTarget.querySelector('.details-page')
    if (page instanceof HTMLElement && page.contains(event.target as Node)) {
      event.stopPropagation()
      return
    }

    const modal = event.currentTarget.querySelector('.details-modal')
    if (!(modal instanceof HTMLElement)) {
      event.stopPropagation()
      return
    }

    const canScroll = modal.scrollHeight > modal.clientHeight + 1
    if (!canScroll) return

    const pageRect = page instanceof HTMLElement ? page.getBoundingClientRect() : null
    const modalRect = modal.getBoundingClientRect()
    if (!pageRect) {
      event.stopPropagation()
      return
    }

    const inScrollbarLane =
      event.clientX > pageRect.right &&
      event.clientX <= modalRect.right &&
      event.clientY >= modalRect.top &&
      event.clientY <= modalRect.bottom

    if (inScrollbarLane) event.stopPropagation()
  }

  return (
    <div
      className="details-backdrop"
      onClick={() => {
        if (lightbox != null) setLightbox(null)
        else onClose()
      }}
    >
      <div className="details-modal-shell" onClick={handleShellClick}>
        <div
          className={
            rarity === 'regular' ? 'details-modal-frame' : `details-modal-frame details-modal-frame-${rarity}`
          }
        >
        <div className="details-modal-corners" aria-hidden="true" />
        <div
          className="details-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="details-title"
        >
        <div className="details-page">
          <div className={coverBroken || !coverUrl ? 'details-hero details-hero-empty' : 'details-hero'}>
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
            {busy ? (
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
                {engine ? (
                  <EngineBadge name={engine} />
                ) : (
                  <span className="details-pill">Unknown engine</span>
                )}
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
              </div>
              <div className="details-sub">
                <div className="details-sub-row">
                  {updates.updateAvailable ? (
                    <span className="details-pill details-pill-update">
                      Update from {latestInstalled?.version}
                    </span>
                  ) : null}
                  {updates.unplayedUpdate ? (
                    <span className="details-pill details-pill-play">New since {lastPlayedVersion}</span>
                  ) : null}
                  {threadSessions.length ? (
                    <span className="details-pill details-pill-play">Playing</span>
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
              {showStatusLine ? (
                <p className="details-status muted">
                  {statusParts.join(' · ')}
                  {showCheckedStatus ? (
                    <>
                      {statusParts.length ? ' · ' : null}
                      <span className="details-checked">
                        Data checked{' '}
                        {summary.checkedAt ? formatRelativeTime(summary.checkedAt) : 'never'}
                        {subscribed && onRefresh ? (
                          <button
                            className="details-refresh-link"
                            type="button"
                            disabled={refreshingMeta}
                            title={refreshingMeta ? 'Refreshing…' : 'Refresh metadata'}
                            aria-label={refreshingMeta ? 'Refreshing metadata' : 'Refresh metadata'}
                            onClick={() => void refreshMetadata()}
                          >
                            <RefreshIcon spinning={refreshingMeta} />
                          </button>
                        ) : null}
                      </span>
                    </>
                  ) : null}
                </p>
              ) : null}
              {details?.tags.length ? (
                <div className="details-tags">
                  {[...details.tags]
                    .sort((a, b) => {
                      const aTier = favoriteTierByName(a, favoriteTags)
                      const bTier = favoriteTierByName(b, favoriteTags)
                      if (aTier && bTier) return TAG_TIER_RANK[bTier] - TAG_TIER_RANK[aTier]
                      if (aTier && !bTier) return -1
                      if (!aTier && bTier) return 1
                      const aHate = isHatedTagName(a, hatedTags)
                      const bHate = isHatedTagName(b, hatedTags)
                      if (aHate && !bHate) return -1
                      if (!aHate && bHate) return 1
                      return 0
                    })
                    .map((tag) => {
                      const tier = favoriteTierByName(tag, favoriteTags)
                      const hated = isHatedTagName(tag, hatedTags)
                      return (
                        <span
                          key={tag}
                          className={tier ? `chip chip-${tier}` : hated ? 'chip chip-hate' : 'chip'}
                        >
                          {tag}
                        </span>
                      )
                    })}
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
                {subscribed && onSetRarity ? (
                  <RaritySlider
                    value={rarity}
                    onChange={(next) => void onSetRarity(summary.threadId, next)}
                  />
                ) : null}
              </div>
              {playError ? <p className="error-text">{playError}</p> : null}
              {installError ? <p className="error-text">{installError}</p> : null}
            </div>
          </div>
          {gameTransfers.length ? (
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
                />
              ))}
            </div>
          ) : null}

      {error ? (
        <p className="catalog-status error-text">
          {error}{' '}
          <button className="ghost-btn" type="button" onClick={() => setReloadToken((value) => value + 1)}>
            Retry
          </button>
        </p>
      ) : null}

      <div className="details-tabs" role="tablist">
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

      <div className={tab === 'description' ? 'details-body details-body-description' : 'details-body'}>
        {tab === 'description' ? (
          details?.descriptionHtml ? (
            <div
              className="thread-prose"
              onClick={onProseClick}
              dangerouslySetInnerHTML={{ __html: details.descriptionHtml }}
            />
          ) : (
            <p className="muted">{busy ? 'Loading description…' : 'No overview section was found in the first post.'}</p>
          )
        ) : null}

        {tab === 'notes' ? (
          notes.length ? (
            <div className="notes-list">
              {notes.map((section, index) => (
                <section key={`${section.title}-${index}`} className="notes-section">
                  <h3 className="notes-title">{section.title}</h3>
                  <div
                    className="thread-prose"
                    onClick={onProseClick}
                    dangerouslySetInnerHTML={{ __html: section.html }}
                  />
                </section>
              ))}
            </div>
          ) : (
            <p className="muted">{busy ? 'Loading notes…' : 'No notes were found in the first post.'}</p>
          )
        ) : null}

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

        {tab === 'downloads' ? (
          <div className="download-list">
            {downloadCount ? (
              downloads.map((section, index) => (
                <DownloadSectionView
                  key={`${section.kind}-${section.title ?? 'current'}-${index}`}
                  section={section}
                  onOpen={(url) => void openUrl(url)}
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
              {installError ? <p className="error-text">{installError}</p> : null}
              {files.map((file) => (
                <article key={file.id} className="library-file">
                  <div className="library-file-main">
                    <strong title={file.archivePath || file.filename}>{file.filename}</strong>
                    <p className="muted library-file-meta">
                      Version {file.version || 'Unknown'}
                      {' · '}
                      {file.engine || engine || 'Unknown engine'}
                      {file.hash ? ` · ${file.hash.slice(0, 12)}` : ''}
                      {file.lastPlayedAt
                        ? ` · Last played ${formatRelativeTime(file.lastPlayedAt)}`
                        : ''}
                      {file.playtimeMs
                        ? ` · ${formatPlaytime(file.playtimeMs)}`
                        : ''}
                    </p>
                    {file.isInstalled ? (
                      <p className="muted library-file-meta">
                        {file.executablePath
                          ? `Launch: ${fileName(file.executablePath)}`
                          : 'No executable selected'}
                      </p>
                    ) : null}
                    <p className="library-file-flags">
                      <span className={file.hasArchive ? 'file-flag file-flag-on' : 'file-flag'}>
                        Archive {file.hasArchive ? 'yes' : 'no'}
                      </span>
                      <span className={file.isInstalled ? 'file-flag file-flag-on' : 'file-flag'}>
                        Installed {file.isInstalled ? 'yes' : 'no'}
                      </span>
                      {(() => {
                        const session = sessionFor(file.id)
                        return session ? (
                          <span className="file-flag file-flag-on">
                            Playing · {formatSessionTime(elapsedMs(session.startedAt, session.elapsedMs))}
                          </span>
                        ) : lastPlayedFile?.id === file.id ? (
                          <span className="file-flag file-flag-on">Last played</span>
                        ) : null
                      })()}
                    </p>
                    {file.installPercent != null ? (
                      <div className="download-progress" role="progressbar" aria-valuenow={file.installPercent}>
                        <span style={{ width: `${file.installPercent}%` }} />
                      </div>
                    ) : null}
                    {file.installError ? <p className="error-text">{file.installError}</p> : null}
                  </div>
                  <div className="library-file-actions">
                    {file.isInstalled ? (
                      sessionFor(file.id) ? (
                        <button className="stop-btn" type="button" onClick={() => void stopFile(file.id)}>
                          Stop
                        </button>
                      ) : file.installPercent == null ? (
                        <button className="primary-btn" type="button" onClick={() => void playFile(file.id)}>
                          Play
                        </button>
                      ) : null
                    ) : null}
                    {file.hasArchive ? (
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
                    {file.isInstalled ? (
                      <SplitButton
                        label="Uninstall"
                        variant="ghost"
                        disabled={file.installPercent != null}
                        onClick={() => void uninstallFile(file.id)}
                        items={removeMenuItems(file)}
                      />
                    ) : file.hasArchive ? (
                      <SplitButton
                        label="Remove archive"
                        variant="ghost"
                        disabled={file.installPercent != null}
                        onClick={() => void removeArchive(file.id)}
                        items={[
                          {
                            id: 'remove-version',
                            label: 'Remove version',
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
                        Remove version
                      </button>
                    )}
                    <MoreMenu
                      disabled={file.installPercent != null}
                      items={moreMenuItems(file)}
                    />
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="muted">
              No archives yet. Download a zip, 7z, or rar from the Downloads tab and it will be hashed
              and listed here for this version.
            </p>
          )
        ) : null}

        {tab === 'saves' ? (
          saveKind === 'rpgmaker' ? (
            <RpgMakerSavesPanel files={files} threadId={summary.threadId} title={title} />
          ) : (
            <RenpySavesPanel files={files} title={title} />
          )
        ) : null}
        {tab === 'unren' ? <UnRenPanel files={files} /> : null}
        {tab === 'options' ? <OptionsPanel files={files} /> : null}

        {tab === 'reviews' ? (
          reviewItems.length || reviewsTotalPages > 1 || reviewsBusy || reviewsError ? (
            <div className="review-list">
              {reviewsError ? (
                <p className="error-text">
                  {reviewsError}{' '}
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
                    className="ghost-btn pager-btn"
                    type="button"
                    disabled={reviewsBusy || reviewPage <= 1}
                    onClick={() => setReviewPage((value) => Math.max(1, value - 1))}
                  >
                    ‹
                  </button>
                  <span className="muted pager-label">
                    {reviewPage}/{reviewsTotalPages}
                  </span>
                  <button
                    className="ghost-btn pager-btn"
                    type="button"
                    disabled={reviewsBusy || reviewPage >= reviewsTotalPages}
                    onClick={() => setReviewPage((value) => value + 1)}
                  >
                    ›
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

      {lightbox != null && gallery[lightbox] ? (
        <div className="lightbox" onClick={() => setLightbox(null)} role="dialog" aria-modal="true">
          <div className="lightbox-stage">
            <img
              src={gallery[lightbox]}
              alt=""
              referrerPolicy="no-referrer"
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
        </div>
      ) : null}
        </div>
        </div>
        </div>
      </div>
    </div>
  )
}
