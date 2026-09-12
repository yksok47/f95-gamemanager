import { useEffect, useId, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'

export type ConfirmOptions = {
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive action — uses the red stop button style. */
  danger?: boolean
}

type PendingConfirm = ConfirmOptions & {
  resolve: (ok: boolean) => void
}

let openConfirm: ((pending: PendingConfirm) => void) | null = null
const queue: PendingConfirm[] = []

/** In-app confirm. Falls back to window.confirm only if the host is not mounted yet. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const pending: PendingConfirm = { ...options, resolve }
    if (openConfirm) {
      openConfirm(pending)
      return
    }
    queue.push(pending)
    // Host may mount next tick (e.g. first paint).
    queueMicrotask(() => {
      if (!openConfirm) {
        const idx = queue.indexOf(pending)
        if (idx >= 0) queue.splice(idx, 1)
        resolve(window.confirm(options.message))
      }
    })
  })
}

export function ConfirmHost(): JSX.Element | null {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const titleId = useId()
  const messageId = useId()

  useEffect(() => {
    openConfirm = (next) => {
      setPending((current) => {
        if (current) {
          queue.push(next)
          return current
        }
        return next
      })
    }
    if (queue.length && !pending) {
      setPending(queue.shift() ?? null)
    }
    return () => {
      openConfirm = null
    }
  }, [pending])

  function close(ok: boolean): void {
    pending?.resolve(ok)
    const next = queue.shift() ?? null
    setPending(next)
  }

  useEffect(() => {
    if (!pending) return
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending])

  if (!pending) return null

  const confirmLabel = pending.confirmLabel ?? (pending.danger ? 'Delete' : 'Continue')
  const cancelLabel = pending.cancelLabel ?? 'Cancel'

  return createPortal(
    <div
      className="app-confirm-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close(false)
      }}
    >
      <div
        className="app-confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={pending.title ? titleId : undefined}
        aria-describedby={messageId}
      >
        {pending.title ? (
          <h2 id={titleId} className="app-confirm-title">
            {pending.title}
          </h2>
        ) : null}
        <p id={messageId} className="app-confirm-message">
          {pending.message}
        </p>
        <div className="app-confirm-actions">
          <button className="ghost-btn" type="button" onClick={() => close(false)} autoFocus>
            {cancelLabel}
          </button>
          <button
            className={pending.danger ? 'stop-btn' : 'primary-btn'}
            type="button"
            onClick={() => close(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
