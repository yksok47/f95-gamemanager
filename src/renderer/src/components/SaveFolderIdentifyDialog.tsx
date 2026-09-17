import { useEffect, useId, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { engineFromPrefixIds } from '@shared/prefixes'
import { notifyCaught } from './ErrorNotifications'

export type SaveFolderIdentifyTarget = {
  id: string
  savePath: string
  folderName: string
}

export type SaveFolderIdentifyPick = {
  threadId: number
  title: string
  coverUrl: string | null
}

type SearchHit = SaveFolderIdentifyPick & {
  creator: string
  engine: string
  badge?: string
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
  onClose,
  onPick
}: {
  target: SaveFolderIdentifyTarget
  busy: boolean
  onClose: () => void
  onPick: (game: SaveFolderIdentifyPick) => void
}): JSX.Element {
  const titleId = useId()
  const hint = folderSearchHint(target.folderName)
  const [query, setQuery] = useState(hint)
  const [search, setSearch] = useState(hint)
  const [games, setGames] = useState<SearchHit[]>([])
  const [loading, setLoading] = useState(Boolean(hint.trim().length >= 2))
  const [searchError, setSearchError] = useState(false)

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
            engine: game.engine || engineFromPrefixIds(game.prefixes)
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
  }, [search])

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
            Match save folder
          </h2>
          <p className="muted">
            Could not identify <strong>{target.folderName}</strong> automatically. Search for the game
            this folder belongs to.
          </p>
        </div>
        <form
          className="storage-identify-search"
          onSubmit={(event) => {
            event.preventDefault()
            setSearch(query.trim())
          }}
        >
          <input
            className="folder-path"
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
                  <button
                    className="storage-identify-row"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      onPick({
                        threadId: game.threadId,
                        title: game.title,
                        coverUrl: game.coverUrl
                      })
                    }
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
                    <span className="storage-identify-pick">{busy ? 'Saving…' : 'Select'}</span>
                  </button>
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
          <button className="ghost-btn" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
