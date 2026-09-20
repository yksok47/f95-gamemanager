import { useEffect, useId, useState, type JSX, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { engineFromPrefixIds } from '@shared/prefixes'
import { notifyCaught } from './ErrorNotifications'
import { SavePeekStrip } from './SavePeek'

export type SaveFolderIdentifyTarget = {
  id: string
  savePath: string
  folderName: string
  mappedTitle?: string
  mappedThreadId?: number
}

export type SaveFolderIdentifyPick = {
  threadId: number
  title: string
  coverUrl: string | null
  creator?: string
  engine?: string
  version?: string
  rating?: number
  likes?: number
  views?: number
  threadUrl?: string
  prefixes?: number[]
  tags?: number[]
  timestamp?: number
  updatedAt?: string
  screens?: string[]
}

export type SaveFolderIdentifyMatch = {
  folderName: string
  savePath: string
}

type SearchHit = SaveFolderIdentifyPick & {
  creator: string
  engine: string
  badge?: string
  matchedSave?: SaveFolderIdentifyMatch | null
}

function folderSearchHint(folderName: string): string {
  return folderName
    .replace(/-\d{8,}$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesNeedle(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase())
}

function pathKey(value: string): string {
  return value.replace(/[\\/]+$/, '').toLowerCase()
}

function folderLabel(value: string): string {
  const trimmed = value.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || trimmed
}

function Cover({ url, title }: { url: string | null; title: string }): JSX.Element {
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

export default function SaveFolderIdentifyDialog({
  target,
  busy,
  matchedSavesByThread,
  onClose,
  onPick,
  onUnmap,
  onOpenGame
}: {
  target: SaveFolderIdentifyTarget
  busy: boolean
  matchedSavesByThread?: Map<number, SaveFolderIdentifyMatch[]>
  onClose: () => void
  onPick: (game: SaveFolderIdentifyPick) => void
  onUnmap?: () => void
  onOpenGame: (game: SaveFolderIdentifyPick) => void
}): JSX.Element {
  const titleId = useId()
  const hint = folderSearchHint(target.folderName)
  const [query, setQuery] = useState(hint)
  const [search, setSearch] = useState(hint)
  const [games, setGames] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(Boolean(hint.trim().length >= 2))
  const [searchError, setSearchError] = useState(false)
  const targetKey = pathKey(target.savePath)

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const needle = search.trim()
    if (needle.length < 2) {
      setGames([])
      setLoading(false)
      setSearchError(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setSearchError(false)

    async function run(): Promise<void> {
      const seen = new Set<number>()
      const local: SearchHit[] = []
      const matchedFromFiles = new Map<number, SaveFolderIdentifyMatch>()

      const sameAsTarget = (item: SaveFolderIdentifyMatch): boolean =>
        pathKey(item.savePath) === targetKey ||
        folderLabel(item.savePath).toLowerCase() === target.folderName.toLowerCase()

      const matchFor = (threadId: number): SaveFolderIdentifyMatch | null => {
        const listed = matchedSavesByThread?.get(threadId) || []
        const other = listed.find((item) => !sameAsTarget(item))
        if (other) return other
        const fromFile = matchedFromFiles.get(threadId)
        if (fromFile && !sameAsTarget(fromFile)) return fromFile
        return null
      }

      const add = (game: SearchHit): void => {
        if (!game.threadId || seen.has(game.threadId)) return
        seen.add(game.threadId)
        local.push({ ...game, matchedSave: game.matchedSave ?? matchFor(game.threadId) })
      }

      const [files, followed] = await Promise.all([
        window.api.library.list().catch(() => []),
        window.api.subscriptions.list().catch(() => [])
      ])
      if (cancelled) return

      for (const file of files) {
        if (!file.renpySaveDirectory) continue
        if (matchedFromFiles.has(file.threadId)) continue
        matchedFromFiles.set(file.threadId, {
          folderName: folderLabel(file.renpySaveDirectory),
          savePath: file.renpySaveDirectory
        })
      }

      for (const file of files) {
        if (!matchesNeedle(`${file.title} ${file.creator || ''}`, needle)) continue
        add({
          threadId: file.threadId,
          title: file.title,
          creator: file.creator || '',
          coverUrl: file.coverUrl ?? null,
          engine: file.engine,
          version: file.version,
          rating: file.rating,
          likes: file.likes,
          views: file.views,
          threadUrl: file.threadUrl,
          prefixes: file.prefixes,
          tags: file.tags,
          timestamp: file.timestamp,
          updatedAt: file.updatedAt,
          screens: file.screens,
          badge: 'Library'
        })
      }
      for (const game of followed) {
        if (!matchesNeedle(`${game.title} ${game.creator || ''}`, needle)) continue
        add({
          threadId: game.threadId,
          title: game.title,
          creator: game.creator || '',
          coverUrl: game.coverUrl ?? null,
          engine: game.engine || engineFromPrefixIds(game.prefixes),
          version: game.version,
          rating: game.rating,
          likes: game.likes,
          views: game.views,
          threadUrl: game.threadUrl,
          prefixes: game.prefixes,
          tags: game.tags,
          timestamp: game.timestamp,
          updatedAt: game.updatedAt,
          screens: game.screens,
          badge: 'Followed'
        })
      }
      if (!cancelled) setGames(local)

      try {
        const page = await window.api.catalog.list({
          search: needle,
          rows: 40,
          page: 1,
          sort: 'likes'
        })
        if (cancelled) return
        const catalog: SearchHit[] = []
        for (const game of page.games) {
          if (seen.has(game.threadId)) continue
          seen.add(game.threadId)
          catalog.push({
            threadId: game.threadId,
            title: game.title,
            creator: game.creator,
            coverUrl: game.coverUrl,
            engine: game.engine || engineFromPrefixIds(game.prefixes),
            version: game.version,
            rating: game.rating,
            likes: game.likes,
            views: game.views,
            threadUrl: game.threadUrl,
            prefixes: game.prefixes,
            tags: game.tags,
            timestamp: game.timestamp,
            updatedAt: game.updatedAt,
            screens: game.screens,
            matchedSave: matchFor(game.threadId)
          })
        }
        setGames([...local, ...catalog])
        setSearchError(false)
      } catch (err) {
        if (cancelled) return
        if (!local.length) {
          setSearchError(true)
          notifyCaught(err, 'Could not search the catalog.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [matchedSavesByThread, search, target.folderName, targetKey])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busy) onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const emptyQuery = search.trim().length < 2

  function pick(game: SearchHit): SaveFolderIdentifyPick {
    return {
      threadId: game.threadId,
      title: game.title,
      coverUrl: game.coverUrl,
      creator: game.creator,
      engine: game.engine,
      version: game.version,
      rating: game.rating,
      likes: game.likes,
      views: game.views,
      threadUrl: game.threadUrl,
      prefixes: game.prefixes,
      tags: game.tags,
      timestamp: game.timestamp,
      updatedAt: game.updatedAt,
      screens: game.screens
    }
  }

  function openGallery(event: MouseEvent, game: SearchHit): void {
    event.preventDefault()
    event.stopPropagation()
    onOpenGame(pick(game))
  }

  return createPortal(
    <div
      className="app-confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="storage-identify-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="storage-identify-head">
          <h2 id={titleId} className="app-confirm-title">
            {target.mappedTitle ? 'Change save mapping' : 'Match save folder'}
          </h2>
          <p className="muted">
            {target.mappedTitle ? (
              <>
                <strong>{target.folderName}</strong> is mapped to{' '}
                <strong>{target.mappedTitle}</strong>. Pick a different game, or unmap it.
              </>
            ) : (
              <>
                Could not identify <strong>{target.folderName}</strong> automatically. Search for the
                game this folder belongs to, or peek at screenshots stored in the saves.
              </>
            )}
          </p>
        </div>
        <SavePeekStrip savePath={target.savePath} />
        <form
          className="storage-identify-search"
          onSubmit={(event) => {
            event.preventDefault()
            setSearch(query.trim())
          }}
        >
          <input
            className="folder-path"
            type="search"
            value={query}
            autoFocus
            placeholder="Search by title or keywords"
            onChange={(event) => setQuery(event.target.value)}
          />
          <button className="ghost-btn" type="submit" disabled={loading || busy}>
            Search
          </button>
        </form>
        <div className="storage-identify-results">
          {emptyQuery ? (
            <p className="muted">Type at least two characters to search.</p>
          ) : loading && !games.length ? (
            <p className="muted">Searching…</p>
          ) : games.length ? (
            <ul className="storage-identify-list">
              {games.map((game) => (
                <li key={game.threadId}>
                  <div className="storage-identify-row-wrap">
                    <button
                      className="storage-identify-row"
                      type="button"
                      disabled={busy}
                      onClick={() => onPick(pick(game))}
                    >
                      <Cover url={game.coverUrl} title={game.title} />
                      <span className="storage-row-copy">
                        <strong>{game.title}</strong>
                        <span className="muted">
                          {[game.creator, game.engine].filter(Boolean).join(' · ')}
                        </span>
                        {(game.badge || game.matchedSave) ? (
                        <span className="storage-status">
                          {game.badge ? (
                            <span
                              className={`storage-status-pill storage-status-${game.badge === 'Library' ? 'library' : 'followed'}`}
                            >
                              {game.badge}
                            </span>
                          ) : null}
                          {game.matchedSave ? (
                            <span
                              className="storage-status-pill storage-status-identified"
                              title={game.matchedSave.savePath}
                            >
                              Has saves: {game.matchedSave.folderName}
                            </span>
                          ) : null}
                        </span>
                        ) : null}
                      </span>
                      <span className="storage-identify-pick">{busy ? 'Saving…' : 'Select'}</span>
                    </button>
                    <button
                      className="ghost-btn storage-identify-gallery"
                      type="button"
                      disabled={busy}
                      title="Open game gallery to compare screenshots"
                      onClick={(event) => openGallery(event, game)}
                    >
                      Gallery
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {searchError
                ? 'Catalog search failed. Try again.'
                : 'No games matched that search. Try different keywords.'}
            </p>
          )}
        </div>
        <div className="app-confirm-actions">
          {target.mappedTitle && onUnmap ? (
            <button className="ghost-btn" type="button" disabled={busy} onClick={onUnmap}>
              Unmap
            </button>
          ) : null}
          <button className="ghost-btn" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
