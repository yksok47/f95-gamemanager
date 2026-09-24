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
          d="M4.7 1.5h1.8v5H1.5V4.7h3.2zM9.5 1.5h1.8v3.2h3.2v1.8H9.5zM1.5 9.5h5v5h-1.8V11.3H1.5zM9.5 9.5h5v1.8h-3.2v3.2H9.5z"
        />
      ) : (
        <path
          fill="currentColor"
          d="M1.5 6.5V1.5h5v1.8H3.3V6.5zM9.5 1.5h5v5h-1.8V3.3H9.5zM1.5 9.5h1.8v3.2h3.2v1.8H1.5zM9.5 12.7h3.2V9.5h1.8v5H9.5z"
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

export function ThumbUpIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M1 21h4V9H1zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73z"
      />
    </svg>
  )
}

export function ThumbDownIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2m4 0h4v12h-4z"
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

export function FilingCabinetIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M2.7 1.05h10.6v12.7H2.7zm1.45 1.5h7.7v4.4h-7.7zm0 5.55h7.7v4.4h-7.7zM5.35 3.15h5.3v1.25h-5.3zm1.4 1.7h2.5v.85h-2.5zm-1.4 5.55h5.3v1.25h-5.3zm1.4 1.7h2.5v.85h-2.5zM3.15 13.75h2.35v1.2H3.15zm7.35 0h2.35v1.2h-2.35z"
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
        d="M7.1 1.6h1.8v5.5l2.4-2.4 1.35 1.35L8 10.9 3.35 6.05l1.35-1.35L7.1 7.1zM2.4 12.15h11.2v1.5H2.4z"
      />
    </svg>
  )
}

export function UploadIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.1 14.4h1.8V8.9l2.4 2.4 1.35-1.35L8 5.1 3.35 9.95l1.35 1.35L7.1 8.9zM2.4 2.35h11.2v1.5H2.4z"
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

export function CustomOrderIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M6.2 3.1h8.3v1.7H6.2zm0 4.05h8.3v1.7H6.2zm0 4.05h8.3v1.7H6.2zM3.7 1.6 5.6 4H1.8zm0 12.8L1.8 12h3.8z"
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

export function SavesOnlyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M2.2 2.2h9.3l2.3 2.3v9.3H2.2zm2 2.1v3.4h7.6V4.3zm1.4 4.8v1.5h1.7V9.1zm3.3 0v4.1h3.4V9.1z"
      />
    </svg>
  )
}

export function InstallIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M7.1 1.6h1.8v5.5l2.4-2.4 1.35 1.35L8 10.9 3.35 6.05l1.35-1.35L7.1 7.1zM2.4 9.35v4.3h11.2v-4.3h-1.5v2.8H3.9v-2.8z"
      />
    </svg>
  )
}
