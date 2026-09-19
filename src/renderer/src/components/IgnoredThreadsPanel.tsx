import { useEffect, useMemo, useState, type JSX } from 'react'
import type { IgnoredThread } from '@shared/types'
import { notifyCaught } from './ErrorNotifications'
import { RefreshIcon } from './ToolbarIcons'

type IgnoredThreadsPanelProps = {
  onOpenThread: (threadId: number, title: string) => void
  onIgnoredChange?: (threadId: number, ignored: boolean) => void
}

export default function IgnoredThreadsPanel({
  onOpenThread,
  onIgnoredChange
}: IgnoredThreadsPanelProps): JSX.Element {
  const [threads, setThreads] = useState<IgnoredThread[]>([])
  const [busy, setBusy] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      setBusy(true)
      try {
        const next = await window.api.threads.listIgnored()
        if (!cancelled) setThreads(next)
      } catch (err) {
        if (!cancelled) notifyCaught(err, 'Could not load ignored threads.')
      } finally {
        if (!cancelled) setBusy(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [reloadToken])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return threads
    return threads.filter((thread) => thread.title.toLowerCase().includes(needle))
  }, [threads, query])

  async function unignore(thread: IgnoredThread): Promise<void> {
    setPendingId(thread.threadId)
    try {
      await window.api.threads.setIgnored(thread.threadId, false, thread.unignoreHref)
      setThreads((current) => current.filter((item) => item.threadId !== thread.threadId))
      onIgnoredChange?.(thread.threadId, false)
    } catch (err) {
      notifyCaught(err, 'Could not unignore that thread.')
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="settings-tab-body">
      <p className="muted settings-lead">
        Threads you ignore on F95zone stay out of the catalog. Unignore one here to show it again.
      </p>

      <div className="ignored-toolbar">
        <input
          className="folder-path"
          type="search"
          data-page-search=""
          value={query}
          placeholder="Filter ignored threads"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className="ghost-btn icon-btn"
          type="button"
          title="Refresh ignored threads"
          aria-label="Refresh ignored threads"
          disabled={busy}
          onClick={() => setReloadToken((value) => value + 1)}
        >
          <RefreshIcon spinning={busy} />
        </button>
      </div>

      {busy && !threads.length ? <p className="muted">Loading ignored threads…</p> : null}

      {!busy && !threads.length ? (
        <p className="muted">No ignored threads.</p>
      ) : !busy && !filtered.length ? (
        <p className="muted">No ignored threads match that filter.</p>
      ) : (
        <ul className="ignored-rows">
          {filtered.map((thread) => (
            <li key={thread.threadId} className="ignored-row">
              <button
                className="ignored-row-main"
                type="button"
                onClick={() => onOpenThread(thread.threadId, thread.title)}
              >
                <span className="ignored-row-title">{thread.title}</span>
                <span className="muted">Thread {thread.threadId}</span>
              </button>
              <button
                className="ghost-btn"
                type="button"
                disabled={pendingId === thread.threadId}
                onClick={() => void unignore(thread)}
              >
                {pendingId === thread.threadId ? 'Unignoring…' : 'Unignore'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
