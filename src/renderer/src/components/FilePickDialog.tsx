import { useEffect, useId, useRef, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { ChooseDownloadFileRequest, ConnectorFileChoice } from '@shared/connector-files'
import { osLabelList } from '@shared/connector-files'
import { formatBytes } from '../lib/downloads'

function fileMeta(file: ConnectorFileChoice): string {
  const parts: string[] = []
  if (file.os.length) parts.push(osLabelList(file.os))
  if (file.size && file.size > 0) parts.push(formatBytes(file.size))
  return parts.join(' · ')
}

const queue: ChooseDownloadFileRequest[] = []

export function FilePickHost(): JSX.Element | null {
  const [request, setRequest] = useState<ChooseDownloadFileRequest | null>(null)
  const [selected, setSelected] = useState(0)
  const requestRef = useRef(request)
  requestRef.current = request
  const titleId = useId()
  const listId = useId()

  useEffect(() => {
    return window.api.downloads.onChooseFile((next) => {
      setRequest((current) => {
        if (current) {
          queue.push(next)
          return current
        }
        setSelected(0)
        return next
      })
    })
  }, [])

  function close(index: number | null): void {
    if (!request) return
    const id = request.id
    const next = queue.shift() ?? null
    setRequest(next)
    setSelected(0)
    void window.api.downloads.chooseFile(id, index)
  }

  useEffect(() => {
    if (!request) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        close(null)
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        close(selected)
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSelected((index) => Math.min((request?.files.length ?? 1) - 1, index + 1))
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSelected((index) => Math.max(0, index - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, selected])

  useEffect(() => {
    return () => {
      const current = requestRef.current
      if (current) void window.api.downloads.chooseFile(current.id, null)
      while (queue.length) {
        const leftover = queue.shift()
        if (leftover) void window.api.downloads.chooseFile(leftover.id, null)
      }
    }
  }, [])

  if (!request) return null

  return createPortal(
    <div
      className="app-confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close(null)
      }}
    >
      <div
        className="app-confirm-dialog app-file-pick-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId} className="app-confirm-title">
          Choose a file
        </h2>
        <p className="app-confirm-message">
          This link has more than one file, and the right OS build is not clear from the names.
        </p>
        <div id={listId} className="app-file-pick-list" role="listbox" aria-labelledby={titleId}>
          {request.files.map((file, index) => {
            const meta = fileMeta(file)
            return (
              <button
                key={`${file.name}-${index}`}
                className={index === selected ? 'app-file-pick-item is-selected' : 'app-file-pick-item'}
                type="button"
                role="option"
                aria-selected={index === selected}
                onClick={() => setSelected(index)}
                onDoubleClick={() => close(index)}
              >
                <span className="app-file-pick-name">{file.name}</span>
                {meta ? <span className="app-file-pick-meta">{meta}</span> : null}
              </button>
            )
          })}
        </div>
        <div className="app-confirm-actions">
          <button className="ghost-btn" type="button" onClick={() => close(null)}>
            Cancel
          </button>
          <button className="primary-btn" type="button" onClick={() => close(selected)} autoFocus>
            Download
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
