import type { JSX } from 'react'
import type { ContentKind, OsKind } from '@shared/types'

/** Shared 24×24 stroke icon shell — consistent optical weight across content kinds. */
function StrokeIcon({ children }: { children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <svg
      className="p2p-tag-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

/** Filled mark shell for OS / brand glyphs. */
function MarkIcon({ children }: { children: JSX.Element | JSX.Element[] }): JSX.Element {
  return (
    <svg className="p2p-tag-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  )
}

export function KindIcon({ kind }: { kind: ContentKind }): JSX.Element {
  switch (kind) {
    case 'game':
      return (
        <StrokeIcon>
          <path d="M6.5 10.5h11a3.5 3.5 0 0 1 0 7h-2.2l-1.3 1.5H10l-1.3-1.5H6.5a3.5 3.5 0 0 1 0-7Z" />
          <path d="M8.5 14h2M9.5 13v2" />
          <circle cx="15.25" cy="13.5" r="0.75" fill="currentColor" stroke="none" />
          <circle cx="17.25" cy="15.25" r="0.75" fill="currentColor" stroke="none" />
        </StrokeIcon>
      )
    case 'update':
      return (
        <StrokeIcon>
          <path d="M20 12a8 8 0 0 0-14.3-4.9" />
          <path d="M4 4.5v4h4" />
          <path d="M4 12a8 8 0 0 0 14.3 4.9" />
          <path d="M20 19.5v-4h-4" />
        </StrokeIcon>
      )
    case 'patch':
      return (
        <StrokeIcon>
          <path d="M8.5 15.5 15.5 8.5a2.5 2.5 0 0 1 3.5 3.5l-7 7a2.5 2.5 0 0 1-3.5-3.5Z" />
          <path d="M10.2 10.2 13.8 13.8" />
          <path d="m9 15 1.2-1.2M14.8 9.2 16 8" />
          <circle cx="12" cy="12" r="0.7" fill="currentColor" stroke="none" />
        </StrokeIcon>
      )
    case 'uncensor':
      return (
        <StrokeIcon>
          <path d="M2.5 12s3.5-6.5 9.5-6.5S21.5 12 21.5 12s-3.5 6.5-9.5 6.5S2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="2.75" />
        </StrokeIcon>
      )
    case 'mod':
      return (
        <StrokeIcon>
          <path d="M10 4.5h4v2.2a1.8 1.8 0 1 0 0 3.6V12h2.2a1.8 1.8 0 1 0 3.6 0H22v4a2 2 0 0 1-2 2h-4v-2.2a1.8 1.8 0 1 0-3.6 0V18H8a2 2 0 0 1-2-2v-4h2.2a1.8 1.8 0 1 0 0-3.6H8V6.5a2 2 0 0 1 2-2Z" />
        </StrokeIcon>
      )
    case 'translation':
      return (
        <StrokeIcon>
          <path d="M4.5 5.5h9" />
          <path d="M9 5.5v2.5" />
          <path d="M6.2 15.5 9 8l2.8 7.5" />
          <path d="M7.1 13h3.8" />
          <path d="M14 11.5h6.2" />
          <path d="M14 15h6.2" />
          <path d="M15.8 11.5c0 3.5 2.2 5.5 4.4 6.5" />
        </StrokeIcon>
      )
    case 'walkthrough':
      return (
        <StrokeIcon>
          <path d="M9 4.5 3.5 6.5v13l5.5-2 5.5 2 5.5-2v-13L14.5 6.5 9 4.5Z" />
          <path d="M9 4.5v13" />
          <path d="M14.5 6.5v13" />
        </StrokeIcon>
      )
    case 'cheat':
      return (
        <StrokeIcon>
          <path d="M12 3.5v3.2M12 17.3v3.2M3.5 12h3.2M17.3 12h3.2" />
          <path d="m6.2 6.2 2.2 2.2M15.6 15.6l2.2 2.2M17.8 6.2l-2.2 2.2M8.4 15.6l-2.2 2.2" />
          <circle cx="12" cy="12" r="2.4" />
        </StrokeIcon>
      )
    case 'crack':
      return (
        <StrokeIcon>
          <circle cx="8" cy="10" r="3.5" />
          <path d="M11.2 10H20v2.2h-2.2V15H15.6v-2.8h-1.5" />
        </StrokeIcon>
      )
    case 'save':
      return (
        <StrokeIcon>
          <path d="M5 4.5h11.5L19.5 7.5v12H5v-15Z" />
          <path d="M8 4.5v4.5h7V4.5" />
          <path d="M8 19.5v-5h8v5" />
          <path d="M10 16.5h2" />
        </StrokeIcon>
      )
    case 'dlc':
      return (
        <StrokeIcon>
          <path d="M12 3.5 20 7.5v9l-8 4-8-4v-9l8-4Z" />
          <path d="M12 12.5v8" />
          <path d="m4.2 7.7 7.8 4.8 7.8-4.8" />
          <path d="M12 3.5v5.5" />
        </StrokeIcon>
      )
    case 'extra':
      return (
        <StrokeIcon>
          <path d="M4.5 10.5h15v9h-15v-9Z" />
          <path d="M3.5 10.5h17v-3h-17v3Z" />
          <path d="M12 7.5v12" />
          <path d="M12 7.5c-2.2 0-3.5-1.6-3.5-3S9.8 3 12 5.2C14.2 3 15.5 3.2 15.5 4.5s-1.3 3-3.5 3Z" />
        </StrokeIcon>
      )
    default:
      return (
        <StrokeIcon>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" />
        </StrokeIcon>
      )
  }
}

export function OsIcon({ os }: { os: OsKind }): JSX.Element {
  switch (os) {
    case 'win':
      return (
        <MarkIcon>
          <path d="M3 4.5h8v7H3v-7Zm10 0h8v7h-8v-7ZM3 13.5h8v7H3v-7Zm10 0h8v7h-8v-7Z" />
        </MarkIcon>
      )
    case 'linux':
      return (
        <MarkIcon>
          <path
            fillRule="evenodd"
            d="M12 2c2.3 0 4 2 3.8 4.3 0 .7-.2 1.3-.4 1.8l1.7 2.9c.8 1.3.3 2.7-.8 3.3l-.15 2.2c0 1.1-.7 1.9-1.7 2.2v.4c0 1.7-1.3 3-3.05 3s-3.05-1.3-3.05-3v-.4c-1-.3-1.7-1.1-1.7-2.2l-.15-2.2c-1.1-.6-1.6-2-.8-3.3l1.7-2.9c-.2-.5-.4-1.1-.4-1.8C8 4 9.7 2 12 2Zm-1.8 6.2-.9 1.8a.7.7 0 0 0 .35.9l.85.35v1.9h3v-1.9l.85-.35a.7.7 0 0 0 .35-.9l-.9-1.8c-.45.25-1 .4-1.8.4-.8 0-1.35-.15-1.8-.4ZM10.2 5.4a.85.85 0 1 0 0 1.7.85.85 0 0 0 0-1.7Zm3.6 0a.85.85 0 1 0 0 1.7.85.85 0 0 0 0-1.7ZM9.4 18.9h5.2c.5 0 .85.5.7 1-.4 1.3-1.7 2.2-3.3 2.2s-2.9-.9-3.3-2.2c-.15-.5.2-1 .7-1Z"
          />
        </MarkIcon>
      )
    case 'mac':
      return (
        <MarkIcon>
          <path d="M18.7 17.05c-.42 1-.88 1.92-1.46 2.76-.78 1.12-1.42 1.9-2.3 1.9-.88 0-1.17-.57-2.45-.57-1.28 0-1.6.55-2.48.57-.86 0-1.52-.82-2.3-1.94C6.4 18.1 5.4 14.7 6.7 12.4c.72-1.28 1.98-2.1 3.24-2.1.9 0 1.84.66 2.45.66.6 0 1.72-.8 2.96-.68.5.02 1.92.2 2.83 1.52-.07.04-1.69.99-1.67 2.95.02 2.34 2.05 3.11 2.2 3.2ZM15.9 5.9c.54-.66 0-1.55-.5-2.2-.6-.77-1.62-1.36-2.48-1.37-.1.9.35 1.82.88 2.4.58.65 1.55 1.15 2.1 1.17Z" />
        </MarkIcon>
      )
    case 'android':
      return (
        <MarkIcon>
          <path d="M17.25 9H6.75A1.75 1.75 0 0 0 5 10.75v6.5c0 .97.78 1.75 1.75 1.75H7.5V22h1.75v-3h5.5v3H16.5v-3h.75c.97 0 1.75-.78 1.75-1.75v-6.5A1.75 1.75 0 0 0 17.25 9ZM8.2 5.85 6.9 4.15l1.1-.9 1.45 1.85a5.4 5.4 0 0 1 4.1 0L15 3.25l1.1.9-1.3 1.7A4.9 4.9 0 0 1 17 9H7a4.9 4.9 0 0 1 1.2-3.15ZM9 7a.85.85 0 1 0 0 1.7A.85.85 0 0 0 9 7Zm6 0a.85.85 0 1 0 0 1.7A.85.85 0 0 0 15 7ZM4.25 11H2.8c-.55 0-1 .45-1 1v4.25c0 .55.45 1 1 1h1.45V11Zm17 0h-1.45v6.25H21.2c.55 0 1-.45 1-1V12c0-.55-.45-1-1-1Z" />
        </MarkIcon>
      )
    case 'ios':
      return (
        <MarkIcon>
          <path
            fillRule="evenodd"
            d="M8.25 2h7.5A2.75 2.75 0 0 1 18.5 4.75v14.5A2.75 2.75 0 0 1 15.75 22h-7.5A2.75 2.75 0 0 1 5.5 19.25V4.75A2.75 2.75 0 0 1 8.25 2Zm0 1.5c-.69 0-1.25.56-1.25 1.25v14.5c0 .69.56 1.25 1.25 1.25h7.5c.69 0 1.25-.56 1.25-1.25V4.75c0-.69-.56-1.25-1.25-1.25h-7.5Zm2.5 15.25a.75.75 0 0 0 0 1.5h2.5a.75.75 0 0 0 0-1.5h-2.5Z"
          />
        </MarkIcon>
      )
    case 'web':
      return (
        <StrokeIcon>
          <circle cx="12" cy="12" r="8.25" />
          <path d="M3.75 12h16.5" />
          <path d="M12 3.75c2.3 2.35 3.5 5.1 3.5 8.25s-1.2 5.9-3.5 8.25" />
          <path d="M12 3.75C9.7 6.1 8.5 8.85 8.5 12s1.2 5.9 3.5 8.25" />
        </StrokeIcon>
      )
    case 'html':
      return (
        <StrokeIcon>
          <path d="m8 6.5-5 5.5L8 17.5" />
          <path d="m16 6.5 5 5.5-5 5.5" />
          <path d="m13.4 5-2.8 14" />
        </StrokeIcon>
      )
    case 'joiplay':
      return (
        <StrokeIcon>
          <rect x="3.5" y="7.25" width="17" height="10.5" rx="3.25" />
          <path d="M7.75 12.5h3M9.25 11v3" />
          <circle cx="15.1" cy="11.4" r="1" fill="currentColor" stroke="none" />
          <circle cx="17.25" cy="13.6" r="1" fill="currentColor" stroke="none" />
        </StrokeIcon>
      )
    default:
      return (
        <StrokeIcon>
          <circle cx="12" cy="12" r="8.25" />
        </StrokeIcon>
      )
  }
}
