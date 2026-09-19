import type { JSX } from 'react'

export function ClearIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.05 2 8 6.95 12.95 2 14 3.05 9.05 8 14 12.95 12.95 14 8 9.05 3.05 14 2 12.95 6.95 8 2 3.05z"
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
          d="M6.25 1.4v4.55H1.7V4.15h2.75V1.4zm3.5 0h2.75v2.75H15.3v1.8H9.75zM1.7 9.85h4.55v4.75H4.45v-2.95H1.7zm8.05 0H15.3v1.8h-2.8v2.95H9.75z"
        />
      ) : (
        <path
          fill="currentColor"
          d="M1.7 6.35V1.4h4.95v1.8H3.5v3.15zm8.05-4.95H14.7v4.95h-1.8V3.2H9.75zM1.7 9.65h1.8v3.15h3.15v1.8H1.7zm9.2 3.15h3.15V9.65h1.8v4.95H9.75z"
        />
      )}
    </svg>
  )
}

export function FilterIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M1.5 2h13l-4.7 5.7v4.4L6.2 14.3V7.7z" />
    </svg>
  )
}

export function RefreshIcon({ spinning = false }: { spinning?: boolean }): JSX.Element {
  return (
    <svg className={spinning ? 'is-spinning' : undefined} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.4A6.6 6.6 0 1 0 13.95 5.35a1.05 1.05 0 0 0-1.89.92A4.5 4.5 0 1 1 8 3.5z"
      />
      <path
        fill="currentColor"
        d="M8 1.15V.35c0-.38.44-.58.73-.33l2.9 2.22c.28.21.28.62 0 .83L8.73 5.3A.45.45 0 0 1 8 4.96z"
      />
    </svg>
  )
}

export function StarIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.15 9.86 5.7l4.9.42-3.74 3.22 1.12 4.8L8 11.72l-4.14 2.42 1.12-4.8L1.24 6.12l4.9-.42z"
      />
    </svg>
  )
}

export function HateIcon(): JSX.Element {
  return (
    <svg viewBox="1 2.4 22 21" aria-hidden="true">
      <path
        fill="currentColor"
        d="M15 3H6c-.83 0-1.54.5-1.84 1.22L1.14 11.27c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57c-.02.1-.03.2-.03.31 0 .41.17.79.44 1.06L9.83 23l6.58-6.59c.37-.36.59-.86.59-1.41V5c0-1.1-.9-2-2-2m4 0h4v12h-4z"
      />
    </svg>
  )
}

export function HideCompletedIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.35 8.2 6.2 12 13.6 3.85"
      />
    </svg>
  )
}

export function ArchiveIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2.2 2.35h11.6v2.7H2.2zm.9 3.5h9.8v7.8H3.1zm3.2 2.15v1.4h3.4v-1.4z"
      />
    </svg>
  )
}

export function ImportIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.1 1.45h1.8v6.45l2.4-2.4 1.35 1.35L8 11.7 3.35 7.05l1.35-1.35 2.4 2.4zm-4.7 9.3h11.2v3.05H2.4z"
      />
    </svg>
  )
}

export function DownloadIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.1 1.45h1.8v6.45l2.4-2.4 1.35 1.35L8 11.7 3.35 7.05l1.35-1.35 2.4 2.4zm-4.7 9.3h11.2v2.15H2.4z"
      />
    </svg>
  )
}

export function UploadIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 4.3 12.65 8.95l-1.35 1.35-2.4-2.4v6.45H7.1V7.9l-2.4 2.4-1.35-1.35zm-5.6-2.85h11.2v2.15H2.4z"
      />
    </svg>
  )
}

export function StorageIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1.7 3.45c0-1.05 2.8-1.85 6.3-1.85s6.3.8 6.3 1.85v1.2c0 1.05-2.8 1.85-6.3 1.85s-6.3-.8-6.3-1.85zm0 3.35v1.45c0 1.05 2.8 1.85 6.3 1.85s6.3-.8 6.3-1.85V6.8c-1 .7-3.4 1.15-6.3 1.15s-5.3-.45-6.3-1.15zm0 3.55v2.2c0 1.05 2.8 1.85 6.3 1.85s6.3-.8 6.3-1.85v-2.2c-1 .7-3.4 1.15-6.3 1.15s-5.3-.45-6.3-1.15z"
      />
    </svg>
  )
}

export function SettingsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M6.25 1.35h3.5l.32 1.72c.46.16.88.4 1.26.7l1.64-.64 1.75 3.03-1.34 1.05c.07.35.11.72.11 1.09s-.04.74-.11 1.09l1.34 1.05-1.75 3.03-1.64-.64c-.38.3-.8.54-1.26.7l-.32 1.72h-3.5l-.32-1.72a5.3 5.3 0 0 1-1.26-.7l-1.64.64-1.75-3.03 1.34-1.05A5.1 5.1 0 0 1 2.72 8c0-.37.04-.74.11-1.09L1.49 5.86l1.75-3.03 1.64.64c.38-.3.8-.54 1.26-.7zm1.75 4.45A2.2 2.2 0 1 0 10.2 8a2.2 2.2 0 0 0-2.2-2.2"
      />
    </svg>
  )
}

type PagerIconKind = 'first' | 'prev' | 'next' | 'last'

const PAGER_CHEVRON = 'M4.6 2 12.2 8 4.6 14 2.9 12.3 8.5 8 2.9 3.7z'
const PAGER_CHEVRONS = [
  'M1.35 2.15 6.6 8 1.35 13.85 0 12.25 4.2 8 0 3.75z',
  'M8.4 2.15 13.65 8 8.4 13.85 7.05 12.25 11.25 8 7.05 3.75z'
] as const

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
        <path key={d} d={d} fill="currentColor" />
      ))}
    </svg>
  )
}

export function CatalogIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1.6 1.6h5.6v5.6H1.6zm7.2 0h5.6v5.6H8.8zM1.6 8.8h5.6v5.6H1.6zm7.2 0h5.6v5.6H8.8z"
      />
    </svg>
  )
}

export function FollowedIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M3.4 1.5h9.2v13L8 11.7 3.4 14.5z" />
    </svg>
  )
}

export function UpdatesIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.35A4.35 4.35 0 0 1 12.35 5.7v2.35l1.45 1.45v1.05H2.2v-1.05L3.65 8.05V5.7A4.35 4.35 0 0 1 8 1.35M6.35 13.4a1.65 1.65 0 0 0 3.3 0z"
      />
    </svg>
  )
}

export function RosterIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.2 1.8h7.2v1.6H4.8v10.2H3.2zm4.8 3.4h6.4v1.5H8zm0 3.2h5.2v1.5H8zm0 3.2h3.6v1.5H8z"
      />
    </svg>
  )
}

export function LibraryIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2.2 2.1h2.2v11.8H2.2zm3.4 0h2.2v11.8H5.6zm3.5 0 4.7 1.1v9.6l-4.7 1.1z"
      />
    </svg>
  )
}
