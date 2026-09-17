import { useEffect, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { ClearIcon } from './ToolbarIcons'

export type ErrorNoticeAction = {
  label: string
  onClick: () => void
}

type ErrorNotice = {
  id: number
  message: string
  action?: ErrorNoticeAction
}

type PendingNotice = Omit<ErrorNotice, 'id'>

let pushNotice: ((notice: PendingNotice) => void) | null = null
const queue: PendingNotice[] = []
let nextId = 1

export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

export function notifyError(message: string, action?: ErrorNoticeAction): void {
  const text = message.trim()
  if (!text) return
  const pending: PendingNotice = { message: text, action }
  if (pushNotice) {
    pushNotice(pending)
    return
  }
  queue.push(pending)
}

export function notifyCaught(
  error: unknown,
  fallback: string,
  action?: ErrorNoticeAction
): void {
  notifyError(errorMessage(error, fallback), action)
}

export function ErrorNotificationHost(): JSX.Element | null {
  const [notices, setNotices] = useState<ErrorNotice[]>([])

  useEffect(() => {
    pushNotice = (pending) => {
      setNotices((current) => {
        const index = current.findIndex((notice) => notice.message === pending.message)
        if (index >= 0) {
          const next = current.slice()
          next[index] = { ...next[index], action: pending.action }
          return next
        }
        return [...current, { ...pending, id: nextId++ }]
      })
    }
    if (queue.length) {
      const waiting = queue.splice(0, queue.length)
      setNotices((current) => {
        const next = current.slice()
        for (const pending of waiting) {
          if (next.some((notice) => notice.message === pending.message)) continue
          next.push({ ...pending, id: nextId++ })
        }
        return next
      })
    }
    return () => {
      pushNotice = null
    }
  }, [])

  function dismiss(id: number): void {
    setNotices((current) => current.filter((notice) => notice.id !== id))
  }

  if (!notices.length) return null

  return createPortal(
    <div className="app-error-notices" aria-live="assertive" aria-relevant="additions">
      {notices.map((notice) => (
        <article key={notice.id} className="app-error-notice" role="alert">
          <div className="app-error-notice-body">
            <p className="app-error-notice-label">Error</p>
            <p className="app-error-notice-message">{notice.message}</p>
            {notice.action ? (
              <button
                className="ghost-btn app-error-notice-action"
                type="button"
                onClick={() => {
                  notice.action?.onClick()
                  dismiss(notice.id)
                }}
              >
                {notice.action.label}
              </button>
            ) : null}
          </div>
          <button
            className="ghost-btn icon-btn app-error-notice-dismiss"
            type="button"
            aria-label="Dismiss error"
            onClick={() => dismiss(notice.id)}
          >
            <ClearIcon />
          </button>
        </article>
      ))}
    </div>,
    document.body
  )
}
