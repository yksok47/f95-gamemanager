import { useCallback, useEffect, useState, type JSX } from 'react'
import { isContentHash, normalizeInfoHash } from '@shared/content-address'
import type {
  PackageFlag,
  PackageListQuery,
  PackageListSort,
  PackageMetadata,
  P2pTransferProgress
} from '@shared/p2p'

type P2pPageProps = {
  p2pEnabled: boolean
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

export default function P2pPage({ p2pEnabled }: P2pPageProps): JSX.Element {
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

  const load = useCallback(async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const raw = q.trim()
      const query: PackageListQuery = {
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
      setError(err instanceof Error ? err.message : 'Failed to load P2P catalog')
    } finally {
      setBusy(false)
    }
  }, [q, sort, includeFlagged, limit, offset])

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
              Browse packages others have shared via the metadata tracker. Discovery uses content
              hashes and info hashes only — not F95 download links. Seeding stays opt-in in Settings
              ({p2pEnabled ? 'enabled' : 'currently off'}).
            </p>
          </div>
          <div className="downloads-page-actions">
            <button className="ghost-btn" type="button" disabled={busy} onClick={() => void load()}>
              Refresh
            </button>
          </div>
        </div>

        <div className="p2p-discovery-controls">
          <input
            className="p2p-discovery-search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search game name or package name…"
            aria-label="Search P2P packages"
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

        {busy ? <p className="muted">Loading shared packages…</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {actionError ? <p className="error-text">{actionError}</p> : null}
        {!busy && items.length === 0 && !error ? (
          <p className="muted">
            No shared packages found. Try another search, or browse with no filter when seeders
            have registered packages.
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
                      {pkg.f95ThreadId != null ? <span>thread {pkg.f95ThreadId}</span> : null}
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
