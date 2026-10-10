import { useEffect, useState, type JSX } from 'react'
import {
  DEFAULT_DOWNLOAD_PROVIDER_ORDER,
  DOWNLOAD_PROVIDERS,
  downloadProviderLabel,
  isConnectedProvider,
  type DownloadProviderId
} from '@shared/download-providers'

const PROVIDER_HOSTS = new Map<string, readonly string[]>(
  DOWNLOAD_PROVIDERS.map((provider) => [provider.id, provider.hosts])
)

type DownloadProvidersEditorProps = {
  order: DownloadProviderId[]
  disabled?: boolean
  onChange: (next: DownloadProviderId[]) => void
}

export default function DownloadProvidersEditor({
  order,
  disabled = false,
  onChange
}: DownloadProvidersEditorProps): JSX.Element {
  // Local copy so a reorder shows immediately instead of snapping back until the save lands.
  const [draft, setDraft] = useState(order)
  const [dragId, setDragId] = useState<DownloadProviderId | null>(null)
  const [overId, setOverId] = useState<DownloadProviderId | null>(null)

  useEffect(() => {
    setDraft(order)
  }, [order])

  const isDefault = draft.join() === DEFAULT_DOWNLOAD_PROVIDER_ORDER.join()

  function commit(next: DownloadProviderId[]): void {
    setDraft(next)
    onChange(next)
  }

  function move(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || to >= draft.length) return
    const next = [...draft]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    commit(next)
  }

  function endDrag(): void {
    setDragId(null)
    setOverId(null)
  }

  return (
    <div className="provider-editor">
      <ol className="provider-list">
        {draft.map((id, index) => {
          const label = downloadProviderLabel(id)
          const className = [
            'provider-row',
            dragId === id ? 'is-dragging' : '',
            overId === id && dragId !== id ? 'is-drop-target' : ''
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <li
              key={id}
              className={className}
              draggable={!disabled}
              onDragStart={(event) => {
                setDragId(id)
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(event) => {
                if (!dragId) return
                event.preventDefault()
                setOverId(id)
              }}
              onDrop={(event) => {
                event.preventDefault()
                if (dragId) move(draft.indexOf(dragId), index)
                endDrag()
              }}
              onDragEnd={endDrag}
            >
              <span className="provider-grip" aria-hidden="true">
                ⋮⋮
              </span>
              <span className="provider-rank">{index + 1}</span>
              <span className="provider-name">
                {label}
                <span className="provider-hosts">{PROVIDER_HOSTS.get(id)?.join(', ')}</span>
              </span>
              {isConnectedProvider(id) ? (
                <span
                  className="download-tag download-tag-accent"
                  title="Has a download connector — starts the file in the app without opening the host site"
                >
                  Connector
                </span>
              ) : null}
              <span className="provider-actions">
                <button
                  className="ghost-btn provider-move"
                  type="button"
                  aria-label={`Move ${label} up`}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  className="ghost-btn provider-move"
                  type="button"
                  aria-label={`Move ${label} down`}
                  disabled={disabled || index === draft.length - 1}
                  onClick={() => move(index, index + 1)}
                >
                  ↓
                </button>
              </span>
            </li>
          )
        })}
      </ol>
      <button
        className="ghost-btn"
        type="button"
        disabled={disabled || isDefault}
        onClick={() => commit([...DEFAULT_DOWNLOAD_PROVIDER_ORDER])}
      >
        Reset to default order
      </button>
    </div>
  )
}
