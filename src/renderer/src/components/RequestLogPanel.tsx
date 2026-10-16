import { useEffect, useMemo, useState, type JSX } from 'react'
import type {
  RequestLogBody,
  RequestLogDetail,
  RequestLogEntry,
  RequestLogHeader,
  RequestLogService
} from '@shared/types'
import { formatDateTime } from '@shared/updates'
import { formatBytes } from '../lib/downloads'
import { notifyCaught } from './ErrorNotifications'

type ServiceFilter = 'all' | 'f95zone' | 'metadata'

const SERVICE_LABELS: Record<RequestLogService, string> = {
  f95zone: 'F95zone',
  metadata: 'Metadata',
  tracker: 'Tracker'
}

const FILTERS: { id: ServiceFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'f95zone', label: 'F95zone' },
  { id: 'metadata', label: 'Metadata service' }
]

function matchesFilter(entry: RequestLogEntry, filter: ServiceFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'f95zone') return entry.service === 'f95zone'
  return entry.service === 'metadata' || entry.service === 'tracker'
}

function formatDuration(ms: number | undefined): string {
  if (ms == null) return '—'
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`
}

function statusText(entry: RequestLogEntry): string {
  const label = entry.ok ? 'OK' : 'Failed'
  return entry.status != null ? `${label} ${entry.status}` : label
}

function copyText(text: string): void {
  void navigator.clipboard
    .writeText(text)
    .catch((error) => notifyCaught(error, 'Could not copy to the clipboard.'))
}

function HeaderList({ headers }: { headers: RequestLogHeader[] }): JSX.Element {
  if (!headers.length) return <p className="muted request-log-empty">No headers recorded.</p>
  return (
    <dl className="request-log-headers">
      {headers.map((header, index) => (
        <div key={`${header.name}-${index}`} className="request-log-header">
          <dt>{header.name}</dt>
          <dd>{header.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function BodyView({ body }: { body: RequestLogBody | null }): JSX.Element {
  if (!body) return <p className="muted request-log-empty">No body.</p>
  return (
    <div className="request-log-body">
      <div className="request-log-body-meta">
        <span className="muted">
          {formatBytes(body.size)}
          {body.truncated ? ' · showing the start only' : ''}
        </span>
        <button className="ghost-btn" type="button" onClick={() => copyText(body.text)}>
          Copy
        </button>
      </div>
      <pre className="request-log-pre">{body.text || ' '}</pre>
    </div>
  )
}

function RequestDetailView({ id }: { id: number }): JSX.Element {
  const [detail, setDetail] = useState<RequestLogDetail | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    void window.api.requestLog
      .detail(id)
      .then((next) => {
        if (!cancelled) setDetail(next)
      })
      .catch((error) => {
        if (!cancelled) setDetail(null)
        notifyCaught(error, 'Could not load the request details.')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  if (detail === undefined) return <p className="muted request-log-detail">Loading…</p>
  if (!detail) {
    return (
      <p className="muted request-log-detail">
        Details for this request are no longer available. Only recent requests from this session
        keep their full contents.
      </p>
    )
  }

  return (
    <div className="request-log-detail">
      <dl className="request-log-summary-grid">
        <dt>URL</dt>
        <dd className="request-log-mono">{detail.url}</dd>
        <dt>Service</dt>
        <dd>{SERVICE_LABELS[detail.service]}</dd>
        <dt>Status</dt>
        <dd className={detail.ok ? 'address-status-ok' : 'address-status-down'}>{statusText(detail)}</dd>
        <dt>Duration</dt>
        <dd>{formatDuration(detail.durationMs)}</dd>
        {detail.error ? (
          <>
            <dt>Error</dt>
            <dd className="address-status-down">{detail.error}</dd>
          </>
        ) : null}
      </dl>
      {detail.note ? <p className="muted request-log-note">{detail.note}</p> : null}

      <section className="request-log-section">
        <h3>Request</h3>
        <h4>Headers</h4>
        <HeaderList headers={detail.requestHeaders} />
        <h4>Body</h4>
        <BodyView body={detail.requestBody} />
      </section>

      <section className="request-log-section">
        <h3>Response</h3>
        <h4>Headers</h4>
        <HeaderList headers={detail.responseHeaders} />
        <h4>Body</h4>
        <BodyView body={detail.responseBody} />
      </section>
    </div>
  )
}

export default function RequestLogPanel(): JSX.Element {
  const [entries, setEntries] = useState<RequestLogEntry[]>([])
  const [filter, setFilter] = useState<ServiceFilter>('all')
  const [openId, setOpenId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.requestLog.list().then((next) => {
      if (!cancelled) setEntries(next)
    })
    const stop = window.api.requestLog.onChange((next) => {
      if (!cancelled) setEntries(next)
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  const counts = useMemo(() => {
    const out: Record<ServiceFilter, number> = { all: 0, f95zone: 0, metadata: 0 }
    for (const entry of entries) {
      for (const item of FILTERS) if (matchesFilter(entry, item.id)) out[item.id]++
    }
    return out
  }, [entries])

  const visible = useMemo(() => entries.filter((entry) => matchesFilter(entry, filter)), [entries, filter])

  return (
    <div className="settings-tab-body">
      <p className="muted settings-lead">
        Every request the app sends to F95zone and to the game metadata service while it runs.
        Open a request to see exactly what was sent and what came back. Passwords, form tokens
        and cookies are hidden, and images and other static files are left out. Full details are
        kept in memory only and are gone when the app restarts.
      </p>
      <div className="cloud-keep-options" role="radiogroup" aria-label="Service">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            className={filter === item.id ? 'details-tab details-tab-active' : 'details-tab'}
            type="button"
            role="radio"
            aria-checked={filter === item.id}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setFilter(item.id)}
          >
            {item.label} ({counts[item.id]})
          </button>
        ))}
      </div>
      <div className="ignored-toolbar">
        <span className="muted">
          {visible.length
            ? `${visible.length} ${visible.length === 1 ? 'request' : 'requests'}`
            : 'No requests yet.'}
        </span>
        <button
          className="ghost-btn"
          type="button"
          disabled={!entries.length}
          onClick={() => {
            setOpenId(null)
            void window.api.requestLog.clear()
          }}
        >
          Clear
        </button>
      </div>
      {visible.length ? (
        <ul className="request-log">
          {visible.map((entry) => {
            const open = openId === entry.id
            return (
              <li key={entry.id} className={open ? 'request-log-item request-log-item-open' : 'request-log-item'}>
                <button
                  className="request-log-row"
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : entry.id)}
                >
                  <span className="request-log-time">
                    {formatDateTime(entry.at, { milliseconds: true })}
                  </span>
                  <span className={`request-log-service request-log-service-${entry.service}`}>
                    {SERVICE_LABELS[entry.service]}
                  </span>
                  <span className="request-log-method">{entry.method}</span>
                  <span className="request-log-url" title={entry.url}>
                    {entry.url}
                  </span>
                  <span className={entry.ok ? 'address-status-ok' : 'address-status-down'}>
                    {statusText(entry)}
                  </span>
                </button>
                {open ? <RequestDetailView id={entry.id} /> : null}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
