import { useEffect, useId, useMemo, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { parseThreadLinks } from '@shared/thread-links'

type ImportLinksDialogProps = {
  onImport: (text: string) => void
  onClose: () => void
}

export default function ImportLinksDialog({ onImport, onClose }: ImportLinksDialogProps): JSX.Element {
  const [text, setText] = useState('')
  const titleId = useId()
  const messageId = useId()
  const count = useMemo(() => parseThreadLinks(text).length, [text])

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function submit(): void {
    if (count) onImport(text)
  }

  return createPortal(
    <div
      className="app-confirm-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="app-confirm-dialog import-links-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <h2 id={titleId} className="app-confirm-title">
          Import thread links
        </h2>
        <p id={messageId} className="app-confirm-message">
          Paste F95zone thread links, one per line or separated by spaces.
        </p>
        <textarea
          className="import-links-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder="https://f95zone.to/threads/game-name.12345/"
          spellCheck={false}
          autoFocus
        />
        <div className="app-confirm-actions">
          <span className="muted import-links-count">
            {count === 1 ? '1 thread' : `${count} threads`}
          </span>
          <button className="ghost-btn" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" type="button" disabled={!count} onClick={submit}>
            Follow
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
