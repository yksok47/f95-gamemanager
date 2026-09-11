import { useEffect, useState, type JSX } from 'react'
import type { PackageFlagKind, P2pDownloadOptionStub } from '@shared/p2p'

type Props = {
  filename: string
  p2pEnabled: boolean
}

function flagWarning(flags: P2pDownloadOptionStub['flags']): string | null {
  if (!flags.length) return null
  const kinds = [...new Set(flags.map((f) => f.kind))]
  if (kinds.includes('harmful')) return 'Flagged as harmful by seeders — avoid downloading.'
  if (kinds.includes('broken')) return 'Flagged as broken by seeders — file may not work.'
  return 'Flagged by seeders.'
}

export default function P2pDownloadOptions({ filename, p2pEnabled }: Props): JSX.Element {
  const [options, setOptions] = useState<P2pDownloadOptionStub[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flagNote, setFlagNote] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setBusy(true)
      setError(null)
      try {
        const rows = await window.api.p2p.downloadOptions(filename)
        if (!cancelled) setOptions(rows)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'P2P lookup failed')
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [filename])

  async function flag(contentHash: string | null, kind: PackageFlagKind): Promise<void> {
    if (!contentHash) {
      setError('Cannot flag stub entry without contentHash.')
      return
    }
    if (!p2pEnabled) {
      setError('Enable P2P in Settings before flagging.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await window.api.p2p.flag(contentHash, kind, flagNote || undefined)
      const rows = await window.api.p2p.downloadOptions(filename)
      setOptions(rows)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Flag failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p2p-download-options">
      <div className="p2p-download-options-head">
        <strong>P2P</strong>
        <span className="muted">
          {p2pEnabled ? 'Enabled' : 'Off (settings)'} · unique seeder pubkeys
        </span>
      </div>
      {busy ? <p className="muted">Loading P2P options…</p> : null}
      {error ? <p className="error-text">{error}</p> : null}
      <ul className="p2p-option-list">
        {options.map((opt, index) => {
          const warn = flagWarning(opt.flags)
          return (
            <li key={`${opt.contentHash ?? 'stub'}-${index}`} className="p2p-option">
              <div className="p2p-option-main">
                <button className="download-link p2p-link" type="button" disabled title="P2P download stub">
                  P2P · {opt.label}
                </button>
                <span className="muted p2p-share-count" title="Unique seeder accounts (pubkeys)">
                  {opt.uniqueSeederPubkeyCount} sharers
                  {opt.stub ? ' · stub data' : ''}
                </span>
              </div>
              {warn ? <p className="p2p-flag-warning">{warn}</p> : null}
              <div className="p2p-option-actions">
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={!p2pEnabled || !opt.contentHash || busy}
                  onClick={() => void flag(opt.contentHash, 'broken')}
                >
                  Flag broken
                </button>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={!p2pEnabled || !opt.contentHash || busy}
                  onClick={() => void flag(opt.contentHash, 'harmful')}
                >
                  Flag harmful
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      <input
        className="p2p-flag-note"
        value={flagNote}
        onChange={(e) => setFlagNote(e.target.value)}
        placeholder="Optional flag note"
        disabled={!p2pEnabled}
      />
    </div>
  )
}
