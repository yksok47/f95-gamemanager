import { Fragment, useEffect, useMemo, useState, type JSX, type MouseEvent } from 'react'
import type {
  CatalogGame,
  DownloadRecord,
  FavoriteTag,
  GameLibraryFile,
  GameRarity,
  GameSummary,
  ThreadDetails,
  ThreadDownloadGroup,
  ThreadReview
} from '@shared/types'
import { pickLikeCount, pickViewCount } from '@shared/counts'
import { GAME_RARITIES, TAG_TIER_RANK } from '@shared/types'
import { compareGameVersions, engineKind, normalizeEngine } from '@shared/engines'
import { formatPlaytime, formatRelativeTime, formatSessionTime, formatUpdateDate, gameUpdateState, isRelativeDate } from '@shared/updates'
import EngineBadge from '../components/EngineBadge'
import DownloadRow from '../components/DownloadRow'
import { MoreMenu, SplitButton, type MenuItem } from '../components/MenuPopover'
import RenpySavesPanel from '../components/RenpySavesPanel'
import RpgMakerSavesPanel from '../components/RpgMakerSavesPanel'
import OptionsPanel from '../components/OptionsPanel'
import UnRenPanel from '../components/UnRenPanel'
import { favoriteTierByName } from '../lib/favorites'
import { formatBytes, isActiveDownload } from '../lib/downloads'
import { formatCount, formatRating, ratingClass } from '../lib/format'
import { usePlaySessions } from '../lib/library'

type DetailsTab =
  | 'overview'
  | 'description'
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
  onClose: () => void
  onOpenThread: (threadId: number, title: string) => void
  onToggleFollow: (game: CatalogGame) => Promise<void>
  onRefresh?: (threadId: number) => Promise<void>
  onSetRarity?: (threadId: number, rarity: GameRarity) => Promise<void>
  onSessionExpired: () => Promise<void>
}

function rarityLabel(rarity: GameRarity): string {
  return rarity[0].toUpperCase() + rarity.slice(1)
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

type DownloadSection = { key: string; title: string; groups: ThreadDownloadGroup[] }

/**
 * Group titles carry their section as a `Chapter 1 (v25) · Win/Linux` prefix.
 * Consecutive groups sharing one are nested under a single heading instead.
 */
function downloadSectionsOf(groups: ThreadDownloadGroup[]): DownloadSection[] {
  const sections: DownloadSection[] = []
  for (const group of groups) {
    const parts = group.title.split(' · ')
    const title = parts.slice(0, -1).join(' · ')
    const entry = { title: parts[parts.length - 1], links: group.links }
    const last = sections[sections.length - 1]
    if (last && last.title === title) last.groups.push(entry)
    else sections.push({ key: group.title, title, groups: [entry] })
  }
  return sections
}

/** Mirror buttons show the link text, falling back to the host when it is a bare URL. */
function linkLabel(link: { label: string; url: string }): string {
  const label = link.label.trim().replace(/[*\s]+$/, '')
  if (!label || /^https?:\/\//i.test(label)) return hostLabel(link.url)
  return label
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
  onClose,
  onOpenThread,
  onToggleFollow,
  onRefresh,
  onSetRarity,
  onSessionExpired
}: GameDetailsPageProps): JSX.Element {
  const [details, setDetails] = useState<ThreadDetails | null>(null)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [tab, setTab] = useState<DetailsTab>('description')
  const [lightbox, setLightbox] = useState<number | null>(null)
  const [coverBroken, setCoverBroken] = useState(!summary.coverUrl)
  const [fullCoverReady, setFullCoverReady] = useState(false)
  const [openVersions, setOpenVersions] = useState<Record<number, boolean>>({})
  const [files, setFiles] = useState<GameLibraryFile[]>([])
  const [installBytes, setInstallBytes] = useState<number | null>(null)
  const [transfers, setTransfers] = useState<DownloadRecord[]>([])
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
    if (reviewPage <= 1) {
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
        setReviewsTotalPages(Math.max(1, next.totalPages, details.reviewsTotalPages || 1))
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
  }, [details, reviewPage, reviewsReload, summary.threadId, onSessionExpired])

  useEffect(() => {
    let cancelled = false

    async function refreshFiles(): Promise<void> {
      const items = await window.api.library.list(summary.threadId)
      if (!cancelled) setFiles(items)
    }

    setInstallError(null)
    setPlayError(null)
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
          ) && !/other games|related games|more games|also (?:try|check|play)/i.test(field.label)
      ),
    [details]
  )
  const version = details?.version || summary.version
  const engine = normalizeEngine(details?.engine) || engineFromFields(details?.fields)
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
  const downloadCount = downloads.reduce((sum, group) => sum + group.links.length, 0)
  const downloadSections = useMemo(() => downloadSectionsOf(downloads), [downloads])
  const changelog = details?.changelog ?? []
  const updatedLabel =
    formatUpdateDate(summary.timestamp) || formatDate(details?.updatedAt || '') || formatDate(summary.updatedAt || '')
  const releaseDate = details?.releaseDate || ''

  const tabs = useMemo(() => {
    const settled = !busy
    const items: Array<{ id: DetailsTab; label: string; count?: number; hidden?: boolean }> = [
      { id: 'description', label: 'Description', hidden: settled && !details?.descriptionHtml },
      { id: 'gallery', label: 'Gallery', count: gallery.length, hidden: settled && !gallery.length },
      { id: 'changelog', label: 'Changelog', count: changelog.length, hidden: settled && !changelog.length },
      { id: 'downloads', label: 'Downloads', count: downloadCount, hidden: settled && !downloadCount },
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
  }, [busy, details, gallery.length, downloadCount, changelog.length, files, isRenpy, isRpgMaker])

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
    if (!window.confirm('Uninstall this version? The extracted folder will be deleted.')) return
    setInstallError(null)
    try {
      await window.api.library.uninstall(id)
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Could not uninstall that version.')
    }
  }

  async function removeArchive(id: string): Promise<void> {
    if (!window.confirm('Delete the archive for this version? The install folder is kept.')) return
    setInstallError(null)
    try {
      await window.api.library.removeArchive(id)
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : 'Could not remove that archive.')
    }
  }

  async function removeVersion(id: string): Promise<void> {
    if (!window.confirm('Remove this version? The archive and the extracted folder will both be deleted.')) {
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
    if (engineKind(file.engine) === 'renpy' || engineKind(engine) === 'renpy') {
      items.push({
        id: 'open-saves',
        label: 'Open saves',
        onClick: () => {
          void window.api.renpy.openSaves(file.id, title).catch((err) => {
            setInstallError(err instanceof Error ? err.message : 'Could not open the save folder.')
          })
        }
      })
    } else if (engineKind(file.engine) === 'rpgmaker' || engineKind(engine) === 'rpgmaker') {
      items.push({
        id: 'open-saves',
        label: 'Open saves',
        onClick: () => {
          void window.api.rpgmaker.openSaves(file.id, summary.threadId, title).catch((err) => {
            setInstallError(err instanceof Error ? err.message : 'Could not open the save folder.')
          })
        }
      })
    }
    return items
  }

  function onProseClick(event: MouseEvent<HTMLDivElement>): void {
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

  return (
    <div
      className="details-backdrop"
      onClick={() => {
        if (lightbox != null) setLightbox(null)
        else onClose()
      }}
    >
      <div
        className={
          rarity === 'regular' ? 'details-modal-frame' : `details-modal-frame details-modal-frame-${rarity}`
        }
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="details-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="details-title"
          onClick={(event) => event.stopPropagation()}
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
            <button className="details-close" type="button" aria-label="Close" onClick={onClose}>
              <span aria-hidden="true">×</span>
            </button>
            <div className="details-info">
              <h1 id="details-title" className="details-title">
                {title}
              </h1>
              <div className="details-sub">
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
                <span className="details-pill">{version || 'Unknown version'}</span>
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
                {engine ? (
                  <EngineBadge name={engine} />
                ) : (
                  <span className="details-pill">Unknown engine</span>
                )}
                {packageBytes > 0 ? (
                  <span className="details-pill">Package {formatBytes(packageBytes)}</span>
                ) : null}
                {installBytes ? (
                  <span className="details-pill">Installed {formatBytes(installBytes)}</span>
                ) : null}
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
              </div>
              {lastPlayedAt || summary.checkedAt || updatedLabel || totalPlaytimeMs || threadSessions.length ? (
                <p className="details-status muted">
                  {threadSessions.length
                    ? `Playing · ${formatSessionTime(elapsedMs(threadSessions[0].startedAt, threadSessions[0].elapsedMs))}`
                    : lastPlayedAt
                      ? `Last played ${lastPlayedVersion || 'unknown'} · ${formatRelativeTime(lastPlayedAt)}`
                      : 'Not played yet'}
                  {totalPlaytimeMs ? ` · ${formatPlaytime(totalPlaytimeMs)} total` : ''}
                  {updatedLabel ? ` · Thread updated ${updatedLabel}` : ''}
                  {summary.checkedAt ? ` · Data checked ${formatRelativeTime(summary.checkedAt)}` : ''}
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
                      return 0
                    })
                    .map((tag) => {
                      const tier = favoriteTierByName(tag, favoriteTags)
                      return (
                        <span key={tag} className={tier ? `chip chip-${tier}` : 'chip'}>
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
                <button
                  className={subscribed || latestInstalled ? 'ghost-btn' : 'primary-btn'}
                  type="button"
                  onClick={() => void onToggleFollow(toCatalogGame(summary, details))}
                >
                  {subscribed ? 'Unfollow' : 'Follow'}
                </button>
                {subscribed && onSetRarity ? (
                  <label className="rarity-field details-rarity">
                    <span className="muted">Rarity</span>
                    <select
                      className={`rarity-select rarity-select-${rarity}`}
                      value={rarity}
                      onChange={(event) => void onSetRarity(summary.threadId, event.target.value as GameRarity)}
                    >
                      {GAME_RARITIES.map((value) => (
                        <option key={value} value={value}>
                          {rarityLabel(value)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                {subscribed && onRefresh ? (
                  <button
                    className="ghost-btn"
                    type="button"
                    disabled={refreshingMeta}
                    onClick={() => void refreshMetadata()}
                  >
                    {refreshingMeta ? 'Refreshing…' : 'Refresh metadata'}
                  </button>
                ) : null}
                <button className="ghost-btn" type="button" onClick={() => void openUrl(threadUrl)}>
                  Open thread
                </button>
              </div>
              {playError ? <p className="error-text">{playError}</p> : null}
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
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.count ? <span className="details-tab-count">{item.count}</span> : null}
          </button>
        ))}
      </div>

      <div className="details-body">
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
                      <div
                        className="thread-prose"
                        onClick={onProseClick}
                        dangerouslySetInnerHTML={{ __html: entry.html }}
                      />
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
          downloadCount ? (
            <div className="download-list">
              {downloadSections.map((section) => {
                const rows = section.groups.map((group) => (
                  <section key={group.title} className="download-group">
                    <h3>{group.title}</h3>
                    <ul>
                      {group.links.map((link) => (
                        <li key={link.url}>
                          <button
                            className="download-link"
                            type="button"
                            title={`${link.label} · ${hostLabel(link.url)}`}
                            onClick={() => void openUrl(link.url)}
                          >
                            {linkLabel(link)}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
                if (!section.title) return <Fragment key={section.key}>{rows}</Fragment>
                return (
                  <section key={section.key} className="download-section">
                    <h2>{section.title}</h2>
                    {rows}
                  </section>
                )
              })}
            </div>
          ) : (
            <p className="muted">{busy ? 'Loading download links…' : 'No download links were found in the first post.'}</p>
          )
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
                      ) : (
                        <button className="primary-btn" type="button" onClick={() => void playFile(file.id)}>
                          Play
                        </button>
                      )
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
                  <article key={`${review.author}-${reviewPage}-${index}`} className="review-card">
                    <header>
                      <strong>{review.author}</strong>
                      <span>{review.rating ? `${review.rating}★` : 'No score'}</span>
                      <span className="muted">{formatDate(review.date)}</span>
                    </header>
                    <p>{review.body}</p>
                  </article>
                ))
              ) : (
                <p className="muted">No reviews on this page.</p>
              )}
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
          <img src={gallery[lightbox]} alt="" referrerPolicy="no-referrer" onClick={(event) => event.stopPropagation()} />
          {gallery.length > 1 ? (
            <>
              <button
                className="lightbox-nav lightbox-prev"
                type="button"
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
      ) : null}
        </div>
      </div>
      </div>
    </div>
  )
}
