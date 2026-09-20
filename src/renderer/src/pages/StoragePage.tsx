import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  LibraryImportCandidate,
  LibraryStorageGame,
  LibraryStorageItem,
  LibraryStorageKind,
  LibraryStorageStats
} from '@shared/types'
import type { PackageInstallTags } from '@shared/p2p'
import FooterPortal from '../components/FooterPortal'
import { MenuPopover, type MenuItem } from '../components/MenuPopover'
import SelectMenu from '../components/SelectMenu'
import LibraryImportDialog, { type LibraryImportPick } from '../components/LibraryImportDialog'
import SaveFolderIdentifyDialog, {
  type SaveFolderIdentifyPick,
  type SaveFolderIdentifyTarget
} from '../components/SaveFolderIdentifyDialog'
import { SavePeekButton, SavePeekCover } from '../components/SavePeek'
import { RefreshIcon } from '../components/ToolbarIcons'
import { confirm } from '../components/ConfirmDialog'
import { notifyCaught, notifyError } from '../components/ErrorNotifications'
import { formatBytes } from '../lib/downloads'
import { useStorageScan } from '../lib/storage-scan'

export type StorageOpenTab = 'files' | 'saves' | 'gallery'

export type StorageOpenGame = {
  threadId: number
  title: string
  creator: string
  coverUrl: string | null
  engine: string
  version?: string
}

type StoragePageProps = {
  onOpen: (game: StorageOpenGame, tab?: StorageOpenTab) => void
}

type ListTab = 'games' | 'archives' | 'installs' | 'saves'
type StorageSort = 'size' | 'game' | 'file' | 'status'

const GAME_SORTS: Array<{ value: StorageSort; label: string }> = [
  { value: 'size', label: 'Size' },
  { value: 'game', label: 'Game name' }
]

const FILE_SORTS: Array<{ value: StorageSort; label: string }> = [
  { value: 'size', label: 'Size' },
  { value: 'game', label: 'Game name' },
  { value: 'file', label: 'File name' },
  { value: 'status', label: 'Identification' }
]

const KIND_META: Record<LibraryStorageKind, { label: string; color: string }> = {
  archive: { label: 'Archives', color: '#f0b429' },
  install: { label: 'Installed', color: '#6ea8fe' },
  saves: { label: 'Saves', color: '#63e6be' }
}

function matchesQuery(haystack: string, query: string): boolean {
  if (!query) return true
  return haystack.toLowerCase().includes(query)
}

function itemFileName(item: LibraryStorageItem): string {
  if (item.kind === 'saves') return item.saveFolderName || item.filename || item.title
  return item.filename || item.title
}

/** Higher rank surfaces first when sorting identification descending (needs attention first). */
function identificationRank(item: LibraryStorageItem): number {
  if (item.identifyFailed && !item.identified) return 6
  if (item.pendingImport) return 5
  if (!item.identified && item.kind === 'saves') return 4
  if (item.layoutMismatch) return 3
  if (item.identified && !item.inLibrary && !item.inFollowed) return 2
  if (item.inFollowed && !item.inLibrary) return 1
  return 0
}

function compareStorageGames(
  a: LibraryStorageGame,
  b: LibraryStorageGame,
  sort: StorageSort,
  descending: boolean
): number {
  let result = 0
  if (sort === 'game') {
    result = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
    if (!result) result = a.creator.localeCompare(b.creator, undefined, { sensitivity: 'base' })
  } else {
    result = a.totalBytes - b.totalBytes
  }
  if (!result) result = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  return descending ? -result : result
}

function compareStorageItems(
  a: LibraryStorageItem,
  b: LibraryStorageItem,
  sort: StorageSort,
  descending: boolean
): number {
  let result = 0
  if (sort === 'game') {
    result = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  } else if (sort === 'file') {
    result = itemFileName(a).localeCompare(itemFileName(b), undefined, { sensitivity: 'base' })
  } else if (sort === 'status') {
    result = identificationRank(a) - identificationRank(b)
  } else {
    result = a.bytes - b.bytes
  }
  if (!result) result = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  if (!result) result = itemFileName(a).localeCompare(itemFileName(b), undefined, { sensitivity: 'base' })
  return descending ? -result : result
}

function listSortForTab(tab: ListTab, sort: StorageSort): StorageSort {
  if (tab === 'games' && (sort === 'file' || sort === 'status')) {
    return sort === 'file' ? 'game' : 'size'
  }
  return sort
}

function sortDirectionCopy(sort: StorageSort, descending: boolean): { title: string; label: string } {
  if (sort === 'game' || sort === 'file') {
    return descending
      ? { title: 'Z–A', label: 'Sort Z to A' }
      : { title: 'A–Z', label: 'Sort A to Z' }
  }
  if (sort === 'status') {
    return descending
      ? { title: 'Needs attention first', label: 'Sort needs attention first' }
      : { title: 'Identified first', label: 'Sort identified first' }
  }
  return descending
    ? { title: 'Largest first', label: 'Sort largest first' }
    : { title: 'Smallest first', label: 'Sort smallest first' }
}

function StorageCover({ url, title }: { url: string | null; title: string }): JSX.Element {
  const [broken, setBroken] = useState(!url)
  useEffect(() => {
    setBroken(!url)
  }, [url])
  if (broken) {
    return (
      <span className="storage-cover storage-cover-fallback" aria-hidden="true">
        {(title.trim()[0] || '?').toUpperCase()}
      </span>
    )
  }
  return (
    <img
      className="storage-cover"
      src={url || ''}
      alt=""
      onError={() => setBroken(true)}
    />
  )
}

function SizeBar({
  archiveBytes,
  installBytes,
  saveBytes,
  maxBytes
}: {
  archiveBytes: number
  installBytes: number
  saveBytes: number
  maxBytes: number
}): JSX.Element {
  const total = archiveBytes + installBytes + saveBytes
  const width = maxBytes > 0 ? Math.max(4, (total / maxBytes) * 100) : 0
  const parts = [
    { key: 'archive', bytes: archiveBytes, color: KIND_META.archive.color },
    { key: 'install', bytes: installBytes, color: KIND_META.install.color },
    { key: 'saves', bytes: saveBytes, color: KIND_META.saves.color }
  ].filter((part) => part.bytes > 0)
  return (
    <div className="storage-bar" title={formatBytes(total)}>
      <div className="storage-bar-fill" style={{ width: `${width}%` }}>
        {parts.map((part) => (
          <span
            key={part.key}
            style={{
              flex: `${Math.max(part.bytes, 1)} 1 0%`,
              background: part.color
            }}
          />
        ))}
      </div>
    </div>
  )
}

function DonutChart({ stats }: { stats: LibraryStorageStats }): JSX.Element {
  const slices = [
    { kind: 'archive' as const, bytes: stats.archiveBytes },
    { kind: 'install' as const, bytes: stats.installBytes },
    { kind: 'saves' as const, bytes: stats.saveBytes }
  ]
  const total = stats.totalBytes
  const r = 42
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="storage-donut">
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle className="storage-donut-track" cx="60" cy="60" r={r} />
        {total > 0
          ? slices
              .filter((slice) => slice.bytes > 0)
              .map((slice) => {
                const len = (slice.bytes / total) * c
                const dashOffset = -offset
                offset += len
                return (
                  <circle
                    key={slice.kind}
                    cx="60"
                    cy="60"
                    r={r}
                    fill="none"
                    stroke={KIND_META[slice.kind].color}
                    strokeWidth="16"
                    strokeDasharray={`${len} ${c}`}
                    strokeDashoffset={dashOffset}
                    transform="rotate(-90 60 60)"
                  />
                )
              })
          : null}
      </svg>
      <div className="storage-donut-label">
        <strong>{formatBytes(total)}</strong>
        <span className="muted">on disk</span>
      </div>
    </div>
  )
}

export default function StoragePage({ onOpen }: StoragePageProps): JSX.Element {
  const { stats, scanning, hasScan, ensure, refresh } = useStorageScan()
  const [acting, setActing] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<ListTab>('games')
  const [sort, setSort] = useState<StorageSort>('size')
  const [descending, setDescending] = useState(true)
  const [menuFor, setMenuFor] = useState<number | null>(null)
  const [identifyTarget, setIdentifyTarget] = useState<SaveFolderIdentifyTarget | null>(null)
  const [importCandidate, setImportCandidate] = useState<LibraryImportCandidate | null>(null)
  const [importing, setImporting] = useState(false)
  const menuAnchor = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    void ensure()
  }, [ensure])

  const needle = query.trim().toLowerCase()
  const listSort = listSortForTab(tab, sort)
  const sortOptions = tab === 'games' ? GAME_SORTS : FILE_SORTS
  const sortDir = sortDirectionCopy(listSort, descending)
  const games = useMemo(() => {
    const filtered = stats.games.filter((game) =>
      matchesQuery(`${game.title} ${game.creator} ${game.engine}`, needle)
    )
    return filtered.sort((a, b) => compareStorageGames(a, b, listSort, descending))
  }, [stats.games, needle, listSort, descending])
  const itemsByKind = useCallback(
    (kind: LibraryStorageKind) =>
      stats.items
        .filter(
          (item) =>
            item.kind === kind &&
            matchesQuery(
              `${item.title} ${item.filename} ${item.version} ${item.saveFolderName || ''} ${item.engine}`,
              needle
            )
        )
        .sort((a, b) => compareStorageItems(a, b, listSort, descending)),
    [stats.items, needle, listSort, descending]
  )
  const archives = useMemo(() => itemsByKind('archive'), [itemsByKind])
  const installs = useMemo(() => itemsByKind('install'), [itemsByKind])
  const saves = useMemo(() => itemsByKind('saves'), [itemsByKind])
  const matchedSavesByThread = useMemo(() => {
    const map = new Map<number, Array<{ folderName: string; savePath: string }>>()
    for (const item of stats.items) {
      if (item.kind !== 'saves' || !item.identified || !item.threadId || !item.savePath) continue
      const list = map.get(item.threadId) || []
      list.push({
        folderName: item.saveFolderName || item.title,
        savePath: item.savePath
      })
      map.set(item.threadId, list)
    }
    return map
  }, [stats.items])
  const maxGameBytes = useMemo(
    () => games.reduce((max, game) => Math.max(max, game.totalBytes), 0),
    [games]
  )
  const topGames = useMemo(
    () =>
      games
        .slice()
        .sort((a, b) => b.totalBytes - a.totalBytes || a.title.localeCompare(b.title))
        .slice(0, 10),
    [games]
  )
  const redundantArchives = useMemo(
    () => stats.items.filter((item) => item.kind === 'archive' && item.isInstalled && item.fileId),
    [stats.items]
  )
  const mismatchedInstalls = useMemo(
    () => stats.items.filter((item) => item.kind === 'install' && item.layoutMismatch && item.fileId),
    [stats.items]
  )
  const pendingImports = useMemo(
    () => stats.items.filter((item) => item.pendingImport && item.importPath),
    [stats.items]
  )

  function openGame(
    game: Pick<StorageOpenGame, 'threadId' | 'title' | 'creator' | 'coverUrl' | 'engine'> & {
      version?: string
    },
    tab?: StorageOpenTab
  ): void {
    onOpen(
      {
        threadId: game.threadId,
        title: game.title,
        creator: game.creator,
        coverUrl: game.coverUrl,
        engine: game.engine,
        version: game.version
      },
      tab
    )
  }

  async function runAction(
    id: string,
    work: () => Promise<void>,
    failed = 'Could not free that space.'
  ): Promise<void> {
    setActing(id)
    try {
      await work()
      await refresh()
    } catch (err) {
      notifyCaught(err, failed)
    } finally {
      setActing(null)
    }
  }

  async function removeArchive(item: LibraryStorageItem): Promise<void> {
    if (!item.fileId) return
    const keepInstall = item.isInstalled
    if (
      !(await confirm({
        title: keepInstall ? 'Delete archive' : 'Delete archive',
        message: keepInstall
          ? `Delete the archive for ${item.title}? The installed copy will stay.`
          : `Delete the archive for ${item.title}? This is the only local copy.`,
        confirmLabel: 'Delete',
        danger: true
      }))
    ) {
      return
    }
    await runAction(item.id, () => window.api.library.removeArchive(item.fileId as string).then(() => undefined))
  }

  async function uninstallItem(item: LibraryStorageItem): Promise<void> {
    if (!item.fileId) return
    if (
      !(await confirm({
        title: 'Uninstall version',
        message: `Uninstall ${item.title}${item.version ? ` ${item.version}` : ''}? The extracted folder will be deleted.`,
        confirmLabel: 'Uninstall',
        danger: true
      }))
    ) {
      return
    }
    await runAction(item.id, () => window.api.library.uninstall(item.fileId as string).then(() => undefined))
  }

  async function deleteSaves(item: LibraryStorageGame | LibraryStorageItem): Promise<void> {
    if (
      !(await confirm({
        title: 'Delete saves',
        message: `Delete all saves for ${item.title}? This cannot be undone.`,
        confirmLabel: 'Delete saves',
        danger: true
      }))
    ) {
      return
    }
    const savePath = 'savePath' in item ? item.savePath || undefined : undefined
    const actionId = 'id' in item ? item.id : `saves:${item.threadId}`
    await runAction(actionId, () => window.api.library.clearSaves(item.threadId, savePath))
  }

  async function openSaveFolder(savePath: string | null | undefined): Promise<void> {
    if (!savePath) return
    setActing(`folder:${savePath}`)
    try {
      await window.api.library.openSaveFolder(savePath)
    } catch (err) {
      notifyCaught(err, 'Could not open that folder.')
    } finally {
      setActing(null)
    }
  }

  async function openInstallFolder(fileId: string | null | undefined): Promise<void> {
    if (!fileId) return
    setActing(`folder:${fileId}`)
    try {
      await window.api.library.showInstall(fileId)
    } catch (err) {
      notifyCaught(err, 'Could not open that folder.')
    } finally {
      setActing(null)
    }
  }

  function openIdentifyPicker(item: LibraryStorageItem): void {
    if (!item.savePath) return
    setIdentifyTarget({
      id: item.id,
      savePath: item.savePath,
      folderName: item.saveFolderName || item.title
    })
  }

  async function identifySaveFolder(item: LibraryStorageItem): Promise<void> {
    if (!item.savePath) return
    if (item.identifyFailed) {
      openIdentifyPicker(item)
      return
    }
    setActing(`identify:${item.id}`)
    try {
      const next = await window.api.library.identifySaveFolder(item.savePath)
      const row = next.items.find((entry) => entry.id === item.id)
      if (row && row.identifyFailed && !row.identified) {
        openIdentifyPicker({ ...item, ...row, savePath: row.savePath || item.savePath })
      }
    } catch (err) {
      notifyCaught(err, 'Could not identify that save folder.')
    } finally {
      setActing(null)
    }
  }

  async function assignIdentifiedGame(game: SaveFolderIdentifyPick): Promise<void> {
    if (!identifyTarget) return
    setActing(`identify:${identifyTarget.id}`)
    try {
      await window.api.library.assignSaveFolder(identifyTarget.savePath, game)
      setIdentifyTarget(null)
    } catch (err) {
      notifyCaught(err, 'Could not assign that game.')
    } finally {
      setActing(null)
    }
  }

  async function importExternalLibraries(): Promise<void> {
    setImporting(true)
    try {
      const result = await window.api.library.importExternal()
      if (result.truncated) {
        notifyError('Stopped after 400 files. Split folders or import again after reviewing.')
      } else if (!result.pending) {
        notifyError('No unidentified archives or games found in the library folders.')
      }
    } catch (err) {
      notifyCaught(err, 'Could not import libraries.')
    } finally {
      setImporting(false)
    }
  }

  async function openImportReview(item: LibraryStorageItem): Promise<void> {
    if (!item.importPath) return
    setActing(`import:${item.id}`)
    try {
      const next =
        (await window.api.library.identifyImport(item.importPath)) ||
        (await window.api.library.getImport(item.importPath))
      if (!next) {
        notifyCaught(new Error('That file is no longer waiting to be imported.'), 'Could not open that import.')
        return
      }
      setImportCandidate(next)
    } catch (err) {
      notifyCaught(err, 'Could not identify that file.')
    } finally {
      setActing(null)
    }
  }

  async function approveImport(game: LibraryImportPick, tags: PackageInstallTags): Promise<void> {
    if (!importCandidate) return
    setActing(`import:${importCandidate.id}`)
    try {
      await window.api.library.approveImport(importCandidate.path, game, tags)
      setImportCandidate(null)
    } catch (err) {
      notifyCaught(err, 'Could not add that file to the library.')
    } finally {
      setActing(null)
    }
  }

  async function dismissImport(item: LibraryStorageItem): Promise<void> {
    if (!item.importPath) return
    await runAction(item.id, () => window.api.library.dismissImport(item.importPath as string).then(() => undefined))
  }

  async function revealImport(item: LibraryStorageItem): Promise<void> {
    if (!item.importPath) return
    setActing(`folder:${item.importPath}`)
    try {
      await window.api.library.revealImport(item.importPath)
    } catch (err) {
      notifyCaught(err, 'Could not show that file.')
    } finally {
      setActing(null)
    }
  }

  async function removeGameArchives(game: LibraryStorageGame): Promise<void> {
    if (!game.archiveIds.length) return
    if (
      !(await confirm({
        title: 'Delete archives',
        message: `Delete ${game.archiveIds.length === 1 ? 'the archive' : `${game.archiveIds.length} archives`} for ${game.title}? Installed copies are kept.`,
        confirmLabel: 'Delete',
        danger: true
      }))
    ) {
      return
    }
    await runAction(`archives:${game.threadId}`, async () => {
      for (const id of game.archiveIds) await window.api.library.removeArchive(id)
    })
  }

  async function uninstallGame(game: LibraryStorageGame): Promise<void> {
    if (!game.installIds.length) return
    if (
      !(await confirm({
        title: 'Uninstall game',
        message: `Uninstall ${game.title}? Extracted folders will be deleted. Archives and saves are kept.`,
        confirmLabel: 'Uninstall',
        danger: true
      }))
    ) {
      return
    }
    await runAction(`installs:${game.threadId}`, async () => {
      for (const id of game.installIds) await window.api.library.uninstall(id)
    })
  }

  async function removeRedundantArchives(): Promise<void> {
    if (!redundantArchives.length) return
    const bytes = redundantArchives.reduce((sum, item) => sum + item.bytes, 0)
    if (
      !(await confirm({
        title: 'Delete installed archives',
        message: `Delete ${redundantArchives.length} archive${redundantArchives.length === 1 ? '' : 's'} (${formatBytes(bytes)}) for games that are already installed?`,
        confirmLabel: 'Delete archives',
        danger: true
      }))
    ) {
      return
    }
    await runAction('bulk-archives', async () => {
      for (const item of redundantArchives) {
        if (item.fileId) await window.api.library.removeArchive(item.fileId)
      }
    })
  }

  async function relocateInstall(item: LibraryStorageItem): Promise<void> {
    if (!item.fileId) return
    const from = item.installPath || 'the current folder'
    const to = item.expectedInstallPath || 'Title / Version'
    if (
      !(await confirm({
        title: 'Fix folder layout',
        message: `Move ${item.title}${item.version ? ` ${item.version}` : ''} into the standard library folder?\n\nFrom:\n${from}\n\nTo:\n${to}\n\nSave and launch paths that pointed at the old folder will be updated.`,
        confirmLabel: 'Move folder'
      }))
    ) {
      return
    }
    await runAction(
      item.id,
      () => window.api.library.relocateInstall(item.fileId as string).then(() => undefined),
      'Could not move that folder.'
    )
  }

  async function relocateMismatchedInstalls(): Promise<void> {
    if (!mismatchedInstalls.length) return
    if (
      !(await confirm({
        title: 'Fix folder layout',
        message: `Move ${mismatchedInstalls.length} installed game${mismatchedInstalls.length === 1 ? '' : 's'} into Title / Version folders under the library? Save and launch paths that pointed at the old folders will be updated.`,
        confirmLabel: 'Move folders'
      }))
    ) {
      return
    }
    await runAction(
      'bulk-layout',
      async () => {
        for (const item of mismatchedInstalls) {
          if (item.fileId) await window.api.library.relocateInstall(item.fileId)
        }
      },
      'Could not move those folders.'
    )
  }

  function gameMenuItems(game: LibraryStorageGame): MenuItem[] {
    const items: MenuItem[] = []
    if (game.archiveBytes > 0) {
      items.push({
        id: 'archives',
        label: `Delete archives (${formatBytes(game.archiveBytes)})`,
        onClick: () => void removeGameArchives(game)
      })
    }
    if (game.installBytes > 0) {
      items.push({
        id: 'installs',
        label: `Uninstall (${formatBytes(game.installBytes)})`,
        onClick: () => void uninstallGame(game)
      })
    }
    if (game.saveBytes > 0 || game.savePath) {
      items.push({
        id: 'saves',
        label: `Delete saves (${formatBytes(game.saveBytes)})`,
        onClick: () => void deleteSaves(game)
      })
    }
    return items
  }

  const listCounts: Record<ListTab, number> = {
    games: games.length,
    archives: archives.length,
    installs: installs.length,
    saves: saves.length
  }

  return (
    <div className="storage-page">
      <FooterPortal>
        <span className="muted pager-label">
          {scanning
            ? hasScan
              ? `Measuring… · ${formatBytes(stats.totalBytes)} across ${stats.games.length} games`
              : 'Measuring…'
            : importing
              ? 'Importing libraries…'
              : pendingImports.length
                ? `${formatBytes(stats.totalBytes)} across ${stats.games.length} games · ${pendingImports.length} to review`
                : mismatchedInstalls.length
                  ? `${formatBytes(stats.totalBytes)} across ${stats.games.length} games · ${mismatchedInstalls.length} folder${mismatchedInstalls.length === 1 ? '' : 's'} to fix`
                  : `${formatBytes(stats.totalBytes)} across ${stats.games.length} games`}
        </span>
      </FooterPortal>

      <section className="storage-hero">
        <div className="downloads-page-header">
          <div>
            <h1>Storage</h1>
            <p className="muted settings-lead">
              See how much archives, installed games, and saves weigh, then free space or open a game.
            </p>
          </div>
          <div className="downloads-page-actions">
            <button
              className="ghost-btn"
              type="button"
              disabled={importing || Boolean(acting)}
              onClick={() => void importExternalLibraries()}
            >
              {importing ? 'Importing…' : 'Import libraries'}
            </button>
            <button
              className="ghost-btn"
              type="button"
              disabled={!mismatchedInstalls.length || Boolean(acting)}
              onClick={() => void relocateMismatchedInstalls()}
            >
              Fix folder layout
              {mismatchedInstalls.length ? ` (${mismatchedInstalls.length})` : ''}
            </button>
            <button
              className="ghost-btn"
              type="button"
              disabled={!redundantArchives.length || Boolean(acting)}
              onClick={() => void removeRedundantArchives()}
            >
              Delete installed archives
              {redundantArchives.length ? ` (${redundantArchives.length})` : ''}
            </button>
            <button
              className="ghost-btn icon-btn"
              type="button"
              title="Refresh"
              aria-label="Refresh storage"
              disabled={scanning}
              onClick={() => void refresh()}
            >
              <RefreshIcon spinning={scanning} />
            </button>
          </div>
        </div>

        <div className="storage-overview">
          <div className="storage-card storage-card-chart">
            <DonutChart stats={stats} />
            <ul className="storage-legend">
              {(['archive', 'install', 'saves'] as const).map((kind) => {
                const bytes =
                  kind === 'archive' ? stats.archiveBytes : kind === 'install' ? stats.installBytes : stats.saveBytes
                const share = stats.totalBytes ? Math.round((bytes / stats.totalBytes) * 100) : 0
                return (
                  <li key={kind}>
                    <button
                      type="button"
                      className="storage-legend-btn"
                      onClick={() =>
                        setTab(kind === 'archive' ? 'archives' : kind === 'install' ? 'installs' : 'saves')
                      }
                    >
                      <span className="storage-swatch" style={{ background: KIND_META[kind].color }} />
                      <span>
                        {KIND_META[kind].label}
                        <em className="muted"> {share}%</em>
                      </span>
                      <strong>{formatBytes(bytes)}</strong>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>

          <div className="storage-card">
            <div className="storage-card-head">
              <h2>Largest games</h2>
              <span className="muted">{topGames.length ? 'Top 10 by disk use' : 'Nothing to chart yet'}</span>
            </div>
            {topGames.length ? (
              <ol className="storage-top-list">
                {topGames.map((game) => (
                  <li key={game.threadId}>
                    <button
                      className="storage-top-btn"
                      type="button"
                      onClick={() => openGame(game)}
                    >
                      <span className="storage-top-label">
                        <span className="storage-top-title">{game.title}</span>
                        <span className="muted">{formatBytes(game.totalBytes)}</span>
                      </span>
                      <SizeBar
                        archiveBytes={game.archiveBytes}
                        installBytes={game.installBytes}
                        saveBytes={game.saveBytes}
                        maxBytes={maxGameBytes}
                      />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">{scanning && !hasScan ? 'Scanning folders…' : 'Download or install a game to see usage here.'}</p>
            )}
          </div>
        </div>
      </section>

      <section className="storage-card storage-lists">
        <div className="storage-list-toolbar">
          <div className="downloads-p2p-tabs" role="tablist">
            {(
              [
                ['games', 'Games'],
                ['archives', 'Archives'],
                ['installs', 'Installed'],
                ['saves', 'Saves']
              ] as Array<[ListTab, string]>
            ).map(([id, label]) => (
              <button
                key={id}
                className={tab === id ? 'details-tab details-tab-active' : 'details-tab'}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setTab(id)}
              >
                {label}
                <span className="details-tab-count">{listCounts[id]}</span>
              </button>
            ))}
          </div>
          <div className="storage-list-tools">
            <SelectMenu
              value={listSort}
              options={sortOptions}
              ariaLabel="Sort storage"
              onChange={(next) => {
                setSort(next)
                setDescending(next !== 'game' && next !== 'file')
              }}
              addon={
                <button
                  className="ghost-btn icon-btn sort-split-dir"
                  type="button"
                  title={sortDir.title}
                  aria-label={sortDir.label}
                  onClick={() => setDescending((value) => !value)}
                >
                  {descending ? '↓' : '↑'}
                </button>
              }
            />
            <input
              className="folder-path storage-search"
              type="search"
              data-page-search=""
              value={query}
              placeholder="Filter by name"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        {tab === 'games' ? (
          games.length ? (
            <ul className="storage-rows">
              {games.map((game) => {
                const menuItems = gameMenuItems(game)
                return (
                  <li key={game.threadId} className="storage-row">
                    <button
                      className="storage-row-main"
                      type="button"
                      onClick={() => openGame(game)}
                    >
                      <StorageCover url={game.coverUrl} title={game.title} />
                      <span className="storage-row-copy">
                        <strong>{game.title}</strong>
                        <span className="muted">
                          {[game.creator, game.engine].filter(Boolean).join(' · ') || 'Game'}
                        </span>
                        <SizeBar
                          archiveBytes={game.archiveBytes}
                          installBytes={game.installBytes}
                          saveBytes={game.saveBytes}
                          maxBytes={maxGameBytes || game.totalBytes}
                        />
                      </span>
                    </button>
                    <div className="storage-row-meta">
                      <span className="storage-row-size">{formatBytes(game.totalBytes)}</span>
                      <span className="muted storage-row-breakdown">
                        {game.archiveBytes ? `Archives ${formatBytes(game.archiveBytes)}` : null}
                        {game.archiveBytes && (game.installBytes || game.saveBytes) ? ' · ' : null}
                        {game.installBytes ? `Installed ${formatBytes(game.installBytes)}` : null}
                        {game.installBytes && game.saveBytes ? ' · ' : null}
                        {game.saveBytes ? `Saves ${formatBytes(game.saveBytes)}` : null}
                      </span>
                    </div>
                    <div className="storage-row-actions">
                      {game.savePath ? (
                        <button
                          className="ghost-btn"
                          type="button"
                          disabled={Boolean(acting)}
                          title="Open save folder"
                          onClick={() => void openSaveFolder(game.savePath)}
                        >
                          Folder
                        </button>
                      ) : null}
                      {menuItems.length ? (
                        <button
                          className="ghost-btn"
                          type="button"
                          disabled={Boolean(acting)}
                          onClick={(event) => {
                            menuAnchor.current = event.currentTarget
                            setMenuFor(game.threadId)
                          }}
                        >
                          Free space
                        </button>
                      ) : null}
                      {menuFor === game.threadId && menuAnchor.current ? (
                        <MenuPopover
                          anchor={menuAnchor.current}
                          items={menuItems}
                          onClose={() => setMenuFor(null)}
                        />
                      ) : null}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="muted">{scanning && !hasScan ? 'Scanning folders…' : 'No games match that filter.'}</p>
          )
        ) : null}

        {tab === 'archives' ? (
          <StorageItemList
            items={archives}
            empty={scanning && !hasScan ? 'Scanning folders…' : 'No archives on disk.'}
            actionLabel="Delete archive"
            busyId={acting}
            onOpen={(item) =>
              item.pendingImport ? void openImportReview(item) : openGame(item, 'files')
            }
            onAction={(item) =>
              item.pendingImport ? void dismissImport(item) : void removeArchive(item)
            }
            onIdentify={(item) => void openImportReview(item)}
            onReveal={(item) => void revealImport(item)}
          />
        ) : null}

        {tab === 'installs' ? (
          <StorageItemList
            items={installs}
            empty={scanning && !hasScan ? 'Scanning folders…' : 'No installed games on disk.'}
            actionLabel="Uninstall"
            busyId={acting}
            onOpen={(item) =>
              item.pendingImport ? void openImportReview(item) : openGame(item, 'files')
            }
            onAction={(item) =>
              item.pendingImport ? void dismissImport(item) : void uninstallItem(item)
            }
            onIdentify={(item) => void openImportReview(item)}
            onReveal={(item) => void revealImport(item)}
            onShowInstall={(item) => void openInstallFolder(item.fileId)}
            onFixLayout={(item) => void relocateInstall(item)}
          />
        ) : null}

        {tab === 'saves' ? (
          <StorageSavesList
            items={saves}
            empty={scanning && !hasScan ? 'Scanning folders…' : 'No save folders found.'}
            busyId={acting}
            onOpenGame={(item) => openGame(item, 'saves')}
            onOpenFolder={(item) => void openSaveFolder(item.savePath)}
            onIdentify={(item) => void identifySaveFolder(item)}
            onDelete={(item) => void deleteSaves(item)}
          />
        ) : null}
      </section>

      {identifyTarget ? (
        <SaveFolderIdentifyDialog
          target={identifyTarget}
          busy={Boolean(acting)}
          matchedSavesByThread={matchedSavesByThread}
          onClose={() => {
            if (acting) return
            setIdentifyTarget(null)
          }}
          onPick={(game) => void assignIdentifiedGame(game)}
          onOpenGame={(game) =>
            openGame(
              {
                threadId: game.threadId,
                title: game.title,
                creator: game.creator || '',
                coverUrl: game.coverUrl,
                engine: game.engine || ''
              },
              'gallery'
            )
          }
        />
      ) : null}
      {importCandidate ? (
        <LibraryImportDialog
          candidate={importCandidate}
          busy={Boolean(acting)}
          onClose={() => {
            if (acting) return
            setImportCandidate(null)
          }}
          onApprove={(game, tags) => void approveImport(game, tags)}
          onOpenGame={(game) =>
            openGame(
              {
                threadId: game.threadId,
                title: game.title,
                creator: game.creator || '',
                coverUrl: game.coverUrl,
                engine: game.engine || ''
              },
              'gallery'
            )
          }
        />
      ) : null}
    </div>
  )
}

function saveStatusPills(item: LibraryStorageItem): Array<{ key: string; label: string; tone: string }> {
  const pills: Array<{ key: string; label: string; tone: string }> = []
  if (item.inLibrary) pills.push({ key: 'library', label: 'In library', tone: 'library' })
  if (item.inFollowed) pills.push({ key: 'followed', label: 'Followed', tone: 'followed' })
  if (!item.inLibrary && !item.inFollowed && item.identified) {
    pills.push({ key: 'identified', label: 'Identified', tone: 'identified' })
  }
  if (item.identifyFailed && !item.identified) {
    pills.push({ key: 'unknown', label: 'Unable to identify', tone: 'unknown' })
  }
  return pills
}

function StorageSavesList({
  items,
  empty,
  busyId,
  onOpenGame,
  onOpenFolder,
  onIdentify,
  onDelete
}: {
  items: LibraryStorageItem[]
  empty: string
  busyId: string | null
  onOpenGame: (item: LibraryStorageItem) => void
  onOpenFolder: (item: LibraryStorageItem) => void
  onIdentify: (item: LibraryStorageItem) => void
  onDelete: (item: LibraryStorageItem) => void
}): JSX.Element {
  if (!items.length) return <p className="muted">{empty}</p>
  const maxBytes = items.reduce((max, item) => Math.max(max, item.bytes), 0)
  return (
    <ul className="storage-rows">
      {items.map((item) => {
        const pills = saveStatusPills(item)
        const canOpenGame = item.threadId > 0
        const identifying = busyId === `identify:${item.id}`
        return (
          <li key={item.id} className="storage-row">
            <button
              className="storage-row-main"
              type="button"
              onClick={() => (canOpenGame ? onOpenGame(item) : onOpenFolder(item))}
            >
              <SavePeekCover
                url={item.coverUrl}
                title={item.title}
                savePath={item.savePath}
                identified={item.identified}
              />
              <span className="storage-row-copy">
                <strong>{item.title}</strong>
                <span className="muted">
                  {[item.saveFolderName, item.engine].filter(Boolean).join(' · ')}
                </span>
                {pills.length ? (
                  <span className="storage-status">
                    {pills.map((pill) => (
                      <span key={pill.key} className={`storage-status-pill storage-status-${pill.tone}`}>
                        {pill.label}
                      </span>
                    ))}
                  </span>
                ) : null}
                <SizeBar
                  archiveBytes={0}
                  installBytes={0}
                  saveBytes={item.bytes}
                  maxBytes={maxBytes}
                />
              </span>
            </button>
            <div className="storage-row-meta">
              <span className="storage-row-size">{formatBytes(item.bytes)}</span>
            </div>
            <div className="storage-row-actions">
              {item.savePath ? (
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={Boolean(busyId)}
                  title="Open save folder"
                  onClick={() => onOpenFolder(item)}
                >
                  Folder
                </button>
              ) : null}
              {item.savePath ? (
                <SavePeekButton savePath={item.savePath} disabled={Boolean(busyId)} />
              ) : null}
              {!item.identified ? (
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={Boolean(busyId) || !item.savePath}
                  onClick={() => onIdentify(item)}
                >
                  {identifying ? 'Identifying…' : item.identifyFailed ? 'Find game' : 'Identify'}
                </button>
              ) : null}
              <button
                className="stop-btn"
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => onDelete(item)}
              >
                Delete saves
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function StorageItemList({
  items,
  empty,
  actionLabel,
  busyId,
  onOpen,
  onAction,
  onIdentify,
  onReveal,
  onShowInstall,
  onFixLayout
}: {
  items: LibraryStorageItem[]
  empty: string
  actionLabel: string
  busyId: string | null
  onOpen: (item: LibraryStorageItem) => void
  onAction: (item: LibraryStorageItem) => void
  onIdentify?: (item: LibraryStorageItem) => void
  onReveal?: (item: LibraryStorageItem) => void
  onShowInstall?: (item: LibraryStorageItem) => void
  onFixLayout?: (item: LibraryStorageItem) => void
}): JSX.Element {
  if (!items.length) return <p className="muted">{empty}</p>
  const maxBytes = items.reduce((max, item) => Math.max(max, item.bytes), 0)
  return (
    <ul className="storage-rows">
      {items.map((item) => {
        const reviewing = busyId === `import:${item.id}`
        const fixing = busyId === item.id
        const showFolder =
          (item.pendingImport && item.importPath && onReveal) ||
          (item.layoutMismatch && item.fileId && onShowInstall)
        return (
          <li key={item.id} className="storage-row">
            <button className="storage-row-main" type="button" onClick={() => onOpen(item)}>
              <StorageCover url={item.coverUrl} title={item.title} />
              <span className="storage-row-copy">
                <strong>{item.title}</strong>
                <span className="muted">
                  {[item.version, item.filename !== 'Saves' ? item.filename : null, item.engine]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {item.pendingImport || item.layoutMismatch ? (
                  <span className="storage-status">
                    {item.pendingImport ? (
                      <span
                        className={`storage-status-pill storage-status-${item.identifyFailed ? 'unknown' : 'identified'}`}
                      >
                        {item.identifyFailed ? 'Unable to identify' : 'Needs review'}
                      </span>
                    ) : null}
                    {item.layoutMismatch ? (
                      <span className="storage-status-pill storage-status-layout">Wrong folder</span>
                    ) : null}
                  </span>
                ) : null}
                <SizeBar
                  archiveBytes={item.kind === 'archive' ? item.bytes : 0}
                  installBytes={item.kind === 'install' ? item.bytes : 0}
                  saveBytes={item.kind === 'saves' ? item.bytes : 0}
                  maxBytes={maxBytes}
                />
              </span>
            </button>
            <div className="storage-row-meta">
              <span className="storage-row-size">{formatBytes(item.bytes)}</span>
            </div>
            <div className="storage-row-actions">
              {showFolder ? (
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={Boolean(busyId)}
                  title={item.installPath || item.importPath || 'Show in folder'}
                  onClick={() =>
                    item.pendingImport && onReveal ? onReveal(item) : onShowInstall?.(item)
                  }
                >
                  Folder
                </button>
              ) : null}
              {item.pendingImport && onIdentify ? (
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={Boolean(busyId) || !item.importPath}
                  onClick={() => onIdentify(item)}
                >
                  {reviewing ? 'Identifying…' : item.identifyFailed ? 'Find game' : 'Review'}
                </button>
              ) : null}
              {item.layoutMismatch && onFixLayout ? (
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={Boolean(busyId) || !item.fileId}
                  title={item.expectedInstallPath || 'Move to Title / Version'}
                  onClick={() => onFixLayout(item)}
                >
                  {fixing ? 'Moving…' : 'Fix folder'}
                </button>
              ) : null}
              <button
                className="stop-btn"
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => onAction(item)}
              >
                {item.pendingImport ? 'Skip' : actionLabel}
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
