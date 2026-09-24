import type { JSX } from 'react'
import { useDelayedBusy } from '../lib/delayed-busy'

export type SpinnerSize = 'sm' | 'md' | 'lg'

export function Spinner({
  size = 'md',
  label,
  className
}: {
  size?: SpinnerSize
  label?: string
  className?: string
}): JSX.Element {
  const labeled = Boolean(label)
  return (
    <span
      className={['app-spinner', `app-spinner-${size}`, className].filter(Boolean).join(' ')}
      role={labeled ? 'status' : undefined}
      aria-label={label}
      aria-hidden={labeled ? undefined : true}
    >
      <span className="app-spinner-ring" />
    </span>
  )
}

export function PageLoading({
  busy = true,
  label = 'Loading'
}: {
  busy?: boolean
  label?: string
}): JSX.Element {
  const shown = useDelayedBusy(busy)
  return (
    <div className="page-loading" role="status" aria-live="polite" aria-busy={busy || undefined} aria-label={label}>
      {shown ? <Spinner size="lg" /> : null}
    </div>
  )
}

export function InlineLoading({
  busy = true,
  label = 'Loading'
}: {
  busy?: boolean
  label?: string
}): JSX.Element {
  const shown = useDelayedBusy(busy)
  return (
    <div className="inline-loading" role="status" aria-live="polite" aria-busy={busy || undefined} aria-label={label}>
      {shown ? <Spinner size="md" /> : null}
    </div>
  )
}

export function DelayedMount({
  busy,
  children
}: {
  busy: boolean
  children: JSX.Element
}): JSX.Element | null {
  const shown = useDelayedBusy(busy)
  if (!shown) return null
  return children
}
