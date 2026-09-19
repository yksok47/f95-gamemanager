import { useEffect, useId, useState, type JSX, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { engineFromPrefixIds } from '@shared/prefixes'
import type { LibraryImportCandidate, LibraryImportGameGuess } from '@shared/types'
import type { PackageConsensus, PackageInstallTags, PackageVersionWeight } from '@shared/p2p'
import { notifyCaught } from './ErrorNotifications'
import P2pApproveTagsForm from './P2pApproveTagsForm'
import { formatBytes } from '../lib/downloads'

export type LibraryImportPick = LibraryImportGameGuess

type SearchHit = LibraryImportPick & {
  creator: string
  engine: string
  badge?: string
}

function folderSearchHint(name: string): string {
  return name
    .replace(/\.[a-z0-9]{2,4}$/i, '')
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

function guessToPick(guess: LibraryImportGameGuess): LibraryImportPick {
  return {
    threadId: guess.threadId,
    title: guess.title,
    coverUrl: guess.coverUrl,
    creator: guess.creator,
    engine: guess.engine,
    version: guess.version,
    rating: guess.rating,
    likes: guess.likes,
    views: guess.views,
    threadUrl: guess.threadUrl,
    prefixes: guess.prefixes,
    tags: guess.tags,
    timestamp: guess.timestamp,
    updatedAt: guess.updatedAt,
    screens: guess.screens
  }
}

export default function LibraryImportDialog({
  candidate,
  busy,
  onClose,
  onApprove,
  onOpenGame
}: {
  candidate: LibraryImportCandidate
  busy: boolean
  onClose: () => void
  onApprove: (game: LibraryImportPick, tags: PackageInstallTags) => void
  onOpenGame: (game: LibraryImportPick) => void
}): JSX.Element {
  const titleId = useId()
  const formId = useId()
  const hint = candidate.guessedTitle || folderSearchHint(candidate.filename)
  const [query, setQuery] = useState(hint)
  const [search, setSearch] = useState(hint)
  const [games, setGames] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(Boolean(hint.trim().length >= 2) && !candidate.guess)
  const [searchError, setSearchError] = useState(false)
  const [selected, setSelected] = useState<LibraryImportPick | null>(
    candidate.guess ? guessToPick(candidate.guess) : null
  )
  const [searching, setSearching] = useState(!candidate.guess)
  const [tagsReady, setTagsReady] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(query.trim()), 350)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!searching) return
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
      const add = (game: SearchHit): void => {
        if (!game.threadId || seen.has(game.threadId)) return
        seen.add(game.threadId)
        local.push(game)
      }

      const [files, followed] = await Promise.all([
        window.api.library.list().catch(() => []),
        window.api.subscriptions.list().catch(() => [])
      ])
      if (cancelled) return

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
            screens: game.screens
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
  }, [search, searching])

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
  const fallbackConsensus: PackageConsensus = {
    os: candidate.packageTags.os,
    contentKind: candidate.packageTags.contentKind,
    version: candidate.packageTags.version || selected?.version || '',
    versionId: 0
  }
  const versions: PackageVersionWeight[] = []
  const addVersion = (name?: string): void => {
    const next = (name || '').trim()
    if (!next || versions.some((item) => item.name === next)) return
    versions.push({ id: versions.length + 1, name: next, weight: versions.length ? 1 : 10 })
  }
  addVersion(candidate.packageTags.version)
  addVersion(selected?.version)

  function pick(game: SearchHit): LibraryImportPick {
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

  function openGallery(event: MouseEvent, game: SearchHit | LibraryImportPick): void {
    event.preventDefault()
    event.stopPropagation()
    onOpenGame(game)
  }

  const kindLabel = candidate.kind === 'archive' ? 'archive' : 'installed game'

  return createPortal(
    <div
      className="app-confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="storage-identify-dialog storage-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="storage-identify-head">
          <h2 id={titleId} className="app-confirm-title">
            Review {kindLabel}
          </h2>
          <p className="muted">
            Guessed from <strong>{candidate.filename}</strong>. Confirm the game, OS, version, and
            file type, then approve to add it to your library.
          </p>
        </div>

        {selected ? (
          <div className="storage-import-selected">
            <Cover url={selected.coverUrl} title={selected.title} />
            <div className="storage-row-copy">
              <strong>{selected.title}</strong>
              <span className="muted">
                {[selected.creator, selected.engine].filter(Boolean).join(' · ')}
              </span>
            </div>
            <button
              className="ghost-btn"
              type="button"
              disabled={busy}
              onClick={() => setSearching((value) => !value)}
            >
              {searching ? 'Hide search' : 'Change'}
            </button>
            <button
              className="ghost-btn"
              type="button"
              disabled={busy}
              onClick={(event) => openGallery(event, selected)}
            >
              Gallery
            </button>
          </div>
        ) : (
          <p className="muted">No game guessed. Search below, then review the tags.</p>
        )}

        {searching || !selected ? (
          <>
            <form
              className="storage-identify-search"
              onSubmit={(event) => {
                event.preventDefault()
                setSearch(query.trim())
                setSearching(true)
              }}
            >
              <input
                className="folder-path"
                type="search"
                value={query}
                autoFocus={!selected}
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
                          onClick={() => {
                            setSelected(pick(game))
                            setSearching(false)
                          }}
                        >
                          <Cover url={game.coverUrl} title={game.title} />
                          <span className="storage-row-copy">
                            <strong>{game.title}</strong>
                            <span className="muted">
                              {[game.creator, game.engine].filter(Boolean).join(' · ')}
                            </span>
                            {game.badge ? (
                              <span className="storage-status">
                                <span
                                  className={`storage-status-pill storage-status-${game.badge === 'Library' ? 'library' : 'followed'}`}
                                >
                                  {game.badge}
                                </span>
                              </span>
                            ) : null}
                          </span>
                          <span className="storage-identify-pick">Select</span>
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
          </>
        ) : null}

        <P2pApproveTagsForm
          key={`${candidate.id}:${selected?.threadId || 0}`}
          formId={formId}
          fallbackConsensus={fallbackConsensus}
          versions={versions}
          statsPrefix={`${formatBytes(candidate.bytes)} · ${candidate.filename}`}
          onReadyChange={setTagsReady}
          onSubmit={(tags) => {
            if (!selected) return
            onApprove(selected, tags)
          }}
        />

        <div className="app-confirm-actions">
          <button className="ghost-btn" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary-btn"
            type="submit"
            form={formId}
            disabled={busy || !selected || !tagsReady}
            title={!selected ? 'Pick a game first' : undefined}
          >
            {busy ? 'Saving…' : 'Approve'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
