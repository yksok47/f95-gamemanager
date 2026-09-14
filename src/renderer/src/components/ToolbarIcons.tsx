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

export function FullscreenIcon({ active = false }: { active?: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {active ? (
        <path
          fill="currentColor"
          d="M6.2 1.6v4.2H2V4.4h2.8V1.6zm3.6 0h2.4v2.8H14.8v1.4H9.8zm-7.8 8.4h4.2V14.2H4.4v-2.8H2zm7.8 0h4.8v1.4h-2.8v2.8H9.8z"
        />
      ) : (
        <path
          fill="currentColor"
          d="M2 6.2V2h4.2v1.4H3.4v2.8zm7.8-4.2h4.2v4.2h-1.4V3.4H9.8zM2 9.8h1.4v2.8h2.8V14.2H2zm8.4 2.8h2.8V9.8H14.2v4.4h-4.2z"
        />
      )}
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

type PagerIconKind = 'first' | 'prev' | 'next' | 'last'

const PAGER_CHEVRON = 'M5.8 2.7 11.2 8 5.8 13.3'
const PAGER_CHEVRONS = ['M1.7 3.1 6.3 8 1.7 12.9', 'M8.5 3.1 13.1 8 8.5 12.9'] as const

export function PagerIcon({ kind }: { kind: PagerIconKind }): JSX.Element {
  const flip = kind === 'first' || kind === 'prev'
  const doubles = kind === 'first' || kind === 'last'
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={flip ? { transform: 'scaleX(-1)' } : undefined}
    >
      {(doubles ? PAGER_CHEVRONS : [PAGER_CHEVRON]).map((d) => (
        <path
          key={d}
          d={d}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.05"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  )
}
