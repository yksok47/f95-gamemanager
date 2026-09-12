import type { JSX } from 'react'

export function ClearIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M4.2 3.1 8 6.9l3.8-3.8 1.1 1.1L9.1 8l3.8 3.8-1.1 1.1L8 9.1l-3.8 3.8-1.1-1.1L6.9 8 3.1 4.2z"
      />
    </svg>
  )
}

export function FilterIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2.2 3.2h11.6l-4.4 5.1v3.3L7 13.2V8.3z"
      />
    </svg>
  )
}

export function RefreshIcon({ spinning = false }: { spinning?: boolean }): JSX.Element {
  return (
    <svg className={spinning ? 'is-spinning' : undefined} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13.4 8A5.4 5.4 0 1 1 8 2.6V1l2.6 2.2L8 5.4V4.2A3.8 3.8 0 1 0 11.8 8h1.6z"
      />
    </svg>
  )
}

export function StarIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="m8 2.2 1.7 3.5 3.8.6-2.7 2.7.6 3.8L8 11l-3.4 1.8.6-3.8-2.7-2.7 3.8-.6z"
      />
    </svg>
  )
}

export function HateIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.4A6.6 6.6 0 1 0 14.6 8 6.6 6.6 0 0 0 8 1.4m3.7 3.1L4.5 11.7A5 5 0 0 1 4.3 4.3 5 5 0 0 1 11.7 4.5"
      />
    </svg>
  )
}

export function HideCompletedIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.4 12.2 2.6 8.4l1.3-1.3 2.5 2.5 5.7-5.7 1.3 1.3z"
      />
    </svg>
  )
}

export function ImportIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.2 2h1.6v6.2l2-2L12 7.4 8 11.4 4 7.4l1.2-1.2 2 2zm-4 8.8h9.6V14H3.2z"
      />
    </svg>
  )
}
