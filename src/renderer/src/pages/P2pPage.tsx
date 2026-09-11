import { useCallback, useEffect, useMemo, useState, type JSX } from 'react'
import { isContentHash, normalizeInfoHash } from '@shared/content-address'
import { P2P_ENV_DEFAULTS } from '@shared/p2p'
import type {
  PackageFlag,
  PackageListQuery,
  PackageListSort,
  PackageMetadata,
  P2pTransferProgress
} from '@shared/p2p'

export type P2pGameOption = {
  threadId: number
  title: string
}

type P2pPageProps = {
  p2pEnabled: boolean
  games: P2pGameOption[]
  /** From currently open game details when navigating to P2P */
  initialThreadId?: number | null
}

function flagKinds(flags: PackageFlag[]): Array<'broken' | 'harmful'> {
  return [...new Set(flags.map((f) => f.kind))]
}

function flagWarning(flags: PackageFlag[]): string | null {
  const kinds = flagKinds(flags)
  if (kinds.includes('harmful')) return 'Flagged as harmful by seeders — avoid downloading.'
  if (kinds.includes('broken')) return 'Flagged as broken by seeders — file may not work.'
  return null
}

function shortHash(value: string | null | undefined): string {
  if (!value) return '—'
  return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value
}

function formatBytes(n?: number): string {
  if (!n || n <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v < 10 && i > 0 ? v.toFixed(1) : Math.round(v)} ${units[i]}`
}

export default function P2pPage({
  p2pEnabled,
  games,
  initialThreadId = null
}: P2pPageProps): JSX.Element {
  const sortedGames = useMemo(
    () => [...games].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })),
    [games]
  )

  const [threadId, setThreadId] = useState<number | null>(() => {
    if (initialThreadId != null && Number.isFinite(initialThreadId) && initialThreadId > 0) {
      return initialThreadId
    }
    return null
  })
  const [gamePickerQuery, setGamePickerQuery] = useState('')
  const [q, setQ] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [sort, setSort] = useState<PackageListSort>('popularity')
  const [includeFlagged, setIncludeFlagged] = useState(true)
  const [items, setItems] = useState<PackageMetadata[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [limit] = useState(50)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingHash, setPendingHash] = useState<string | null>(null)
  const [flagNote, setFlagNote] = useState('')
  const [transfers, setTransfers] = useState<P2pTransferProgress[]>([])

  useEffect(() => {
    if (initialThreadId != null && Number.isFinite(initialThreadId) && initialThreadId > 0) {
      setThreadId(initialThreadId)
    }
  }, [initialThreadId])

  const selectedGame = useMemo(
    () => (threadId == null ? null : sortedGames.find((g) => g.threadId === threadId) ?? null),
    [sortedGames, threadId]
  )

  const selectedTitle =
    selectedGame?.title ||
    (threadId != null ? `Thread ${threadId}` : null)

  const filteredGames = useMemo(() => {
    const needle = gamePickerQuery.trim().toLowerCase()
    if (!needle) return sortedGames
    return sortedGames.filter(
      (g) =>
        g.title.toLowerCase().includes(needle) || String(g.threadId).includes(needle)
    )
  }, [gamePickerQuery, sortedGames])

  const load = useCallback(async (): Promise<void> => {
    if (threadId == null) {
      setItems([])
      setTotal(0)
      setError(null)
      setBusy(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const raw = q.trim()
      const query: PackageListQuery = {
        f95ThreadId: threadId,
        sort,
        includeFlagged,
        limit,
        offset
      }
      const info = normalizeInfoHash(raw)
      if (isContentHash(raw)) {
        query.contentHash = raw.toLowerCase()
      } else if (info) {
        query.infoHash = info
      } else if (raw) {
        query.q = raw
      }
      const page = await window.api.p2p.listPackages(query)
      setItems(page.items)
      setTotal(page.total)
    } catch (err) {
      setItems([])
      setTotal(0)
      setError(err instanceof Error ? err.message : 'Failed to load P2P packages for this thread')
    } finally {
      setBusy(false)
    }
  }, [threadId, q, sort, includeFlagged, limit, offset])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0)
      setQ(searchInput.trim())
    }, 350)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  useEffect(() => {
    let cancelled = false
    void window.api.p2p.progress().then((rows) => {
      if (!cancelled) setTransfers(rows)
    })
    const stop = window.api.p2p.onProgress((rows) => {
      setTransfers(rows)
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  function selectGame(next: number): void {
    setThreadId(next)
    setOffset(0)
    setSearchInput('')
    setQ('')
    setActionError(null)
    setError(null)
  }

  function clearGame(): void {
    setThreadId(null)
    setItems([])
    setTotal(0)
    setOffset(0)
    setSearchInput('')
    setQ('')
    setError(null)
    setActionError(null)
  }

  async function download(pkg: PackageMetadata): Promise<void> {
    if (!p2pEnabled) {
      setActionError('Enable P2P in Settings before downloading.')
      return
    }
    const kinds = flagKinds(pkg.flags)
    if (kinds.includes('harmful')) {
      const ok = window.confirm(
        'This package is flagged as harmful by seeders. Download anyway?'
      )
      if (!ok) return
    } else if (kinds.includes('broken')) {
      const ok = window.confirm(
        'This package is flagged as broken by seeders. Download anyway?'
      )
      if (!ok) return
    }
    setPendingHash(pkg.contentHash)
    setActionError(null)
    try {
      await window.api.p2p.downloadByHash(pkg.contentHash)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'P2P download failed')
    } finally {
      setPendingHash(null)
    }
  }

  async function flag(pkg: PackageMetadata, kind: 'broken' | 'harmful'): Promise<void> {
    if (!p2pEnabled) {
      setActionError('Enable P2P in Settings before flagging.')
      return
    }
    setPendingHash(pkg.contentHash)
    setActionError(null)
    try {
      await window.api.p2p.flag(pkg.contentHash, kind, flagNote || undefined)
      await load()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Flag failed')
    } finally {
      setPendingHash(null)
    }
  }

  const pageStart = total === 0 ? 0 : offset + 1
  const pageEnd = Math.min(offset + items.length, total)

  return (
    <div className="settings-page">
      <section className="settings-card">
        <div className="downloads-page-header">
          <div>
            <h1>P2P</h1>
            <p className="muted settings-lead">
              Discover shared packages for one game thread at a time (metadata catalog by{' '}
              <code>f95ThreadId</code>). Not shown on F95 download-link rows. Popularity is unique
              seeder accounts. Seeding stays opt-in in Settings ({p2pEnabled ? 'enabled' : 'currently off'}
              ). Defaults: announce {P2P_ENV_DEFAULTS.TRACKER_ANNOUNCE_URL}, metadata{' '}
              {P2P_ENV_DEFAULTS.METADATA_BASE_URL}.
            </p>
          </div>
          <div className="downloads-page-actions">
            {threadId != null ? (
              <button className="ghost-btn" type="button" onClick={clearGame}>
                Change game
              </button>
            ) : null}
            <button
              className="ghost-btn"
              type="button"
              disabled={busy || threadId == null}
              onClick={() => void load()}
            >
              Refresh
            </button>
          </div>
        </div>

        {threadId == null ? (
          <div className="p2p-thread-picker">
            <h2 className="settings-heading">Pick a game first</h2>
            <p className="muted settings-lead">
              P2P discovery is scoped to a single F95 thread. Open a game elsewhere then come here,
              or choose from followed games below.
            </p>
            <input
              className="p2p-discovery-search"
              value={gamePickerQuery}
              onChange={(e) => setGamePickerQuery(e.target.value)}
              placeholder="Filter followed games…"
              aria-label="Filter games for P2P"
            />
            {sortedGames.length === 0 ? (
              <p className="muted">No followed games yet — follow a game, then return here.</p>
            ) : (
              <ul className="p2p-thread-picker-list">
                {filteredGames.map((g) => (
                  <li key={g.threadId}>
                    <button
                      type="button"
                      className="p2p-thread-picker-item"
                      onClick={() => selectGame(g.threadId)}
                    >
                      <strong>{g.title}</strong>
                      <span className="muted">thread {g.threadId}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {filteredGames.length === 0 && sortedGames.length > 0 ? (
              <p className="muted">No games match that filter.</p>
            ) : null}
          </div>
        ) : (
          <>
            <div className="p2p-thread-scope">
              <span className="filter-label">Thread scope</span>
              <strong>{selectedTitle}</strong>
              <span className="muted">f95ThreadId {threadId}</span>
            </div>

            <div className="p2p-discovery-controls">
              <input
                className="p2p-discovery-search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search within this thread (name or hash)…"
                aria-label="Search packages within thread"
              />
              <label className="p2p-discovery-sort">
                <span className="muted">Sort</span>
                <select
                  value={sort}
                  onChange={(e) => {
                    setOffset(0)
                    setSort(e.target.value as PackageListSort)
                  }}
                >
                  <option value="popularity">Popularity</option>
                  <option value="updated">Updated</option>
                </select>
              </label>
              <label className="p2p-toggle-row p2p-discovery-flagged">
                <input
                  type="checkbox"
                  checked={includeFlagged}
                  onChange={(e) => {
                    setOffset(0)
                    setIncludeFlagged(e.target.checked)
                  }}
                />
                <span>Include flagged</span>
              </label>
            </div>

            {busy ? <p className="muted">Loading shared packages for this thread…</p> : null}
            {error ? <p className="error-text">{error}</p> : null}
            {actionError ? <p className="error-text">{actionError}</p> : null}
            {!busy && items.length === 0 && !error ? (
              <p className="muted">
                No shared packages for this thread yet. Seeders must register packages with this{' '}
                <code>f95ThreadId</code>.
              </p>
            ) : null}

            <ul className="p2p-discovery-list">
              {items.map((pkg) => {
                const warn = flagWarning(pkg.flags)
                const active = pendingHash === pkg.contentHash
                return (
                  <li key={pkg.contentHash} className="p2p-discovery-item">
                    <div className="p2p-discovery-main">
                      <div>
                        <strong>{pkg.gameName || pkg.normalizedName || 'Untitled package'}</strong>
                        {pkg.normalizedName && pkg.normalizedName !== pkg.gameName ? (
                          <div className="muted p2p-discovery-sub">{pkg.normalizedName}</div>
                        ) : null}
                        <div className="muted p2p-discovery-meta">
                          <span title={pkg.contentHash}>content {shortHash(pkg.contentHash)}</span>
                          <span title={pkg.infoHash || undefined}>info {shortHash(pkg.infoHash)}</span>
                          {formatBytes(pkg.sizeBytes) ? <span>{formatBytes(pkg.sizeBytes)}</span> : null}
                        </div>
                      </div>
                      <div className="p2p-discovery-stats">
                        <span className="p2p-share-count" title="Unique seeder accounts (pubkeys)">
                          {pkg.uniqueSeederPubkeyCount} sharers
                        </span>
                        <button
                          className="download-link"
                          type="button"
                          disabled={!p2pEnabled || active || !pkg.infoHash}
                          title={
                            !p2pEnabled
                              ? 'Enable P2P in Settings'
                              : !pkg.infoHash
                                ? 'Missing infoHash'
                                : 'Download via P2P by hash'
                          }
                          onClick={() => void download(pkg)}
                        >
                          {active ? 'Starting…' : 'P2P download'}
                        </button>
                      </div>
                    </div>
                    {warn ? <p className="p2p-flag-warning">{warn}</p> : null}
                    <div className="p2p-option-actions">
                      <button
                        className="ghost-btn"
                        type="button"
                        disabled={!p2pEnabled || active}
                        onClick={() => void flag(pkg, 'broken')}
                      >
                        Flag broken
                      </button>
                      <button
                        className="ghost-btn"
                        type="button"
                        disabled={!p2pEnabled || active}
                        onClick={() => void flag(pkg, 'harmful')}
                      >
                        Flag harmful
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>

            <div className="p2p-discovery-footer">
              <input
                className="p2p-flag-note"
                value={flagNote}
                onChange={(e) => setFlagNote(e.target.value)}
                placeholder="Optional flag note"
                disabled={!p2pEnabled}
              />
              <div className="p2p-discovery-pager">
                <span className="muted">
                  {total ? `${pageStart}–${pageEnd} of ${total}` : '0 packages'}
                </span>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={busy || offset <= 0}
                  onClick={() => setOffset((v) => Math.max(0, v - limit))}
                >
                  Prev
                </button>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={busy || offset + limit >= total}
                  onClick={() => setOffset((v) => v + limit)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}

        {transfers.length ? (
          <div className="p2p-transfers">
            <h2 className="settings-heading">Active P2P transfers</h2>
            <ul className="p2p-transfer-list">
              {transfers.map((t) => (
                <li key={t.id} className="muted">
                  {t.state} · {Math.round((t.progress || 0) * 100)}% · peers {t.numPeers}
                  {t.contentHash ? ` · ${shortHash(t.contentHash)}` : ''}
                  {t.error ? ` · ${t.error}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  )
}
