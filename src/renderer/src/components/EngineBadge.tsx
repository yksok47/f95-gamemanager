import type { JSX } from 'react'
import { engineKind, type EngineKind } from '@shared/engines'

type EngineBadgeProps = {
  name: string
}

export function EngineMark({ kind }: { kind: EngineKind }): JSX.Element {
  switch (kind) {
    case 'renpy':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3.6 2.8h5.1c2.2 0 3.7 1.3 3.7 3.3 0 1.5-1 2.6-2.5 3l2.8 4.1h-2.2L8.2 9.4H5.6v4.1H3.6zm2 1.8v3h3c1.1 0 1.8-.6 1.8-1.5S9.7 4.6 8.6 4.6z"
          />
        </svg>
      )
    case 'rpgmaker':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 1.6 14.4 8 8 14.4 1.6 8zm0 2.9L4.5 8 8 11.5 11.5 8z"
          />
        </svg>
      )
    case 'unity':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 1.4 13.6 4.6v6.8L8 14.6 2.4 11.4V4.6zm0 1.9L4.2 5.4v5.2L8 12.7l3.8-2.1V5.4z"
          />
        </svg>
      )
    case 'unreal':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 1.4A6.6 6.6 0 1 1 1.4 8 6.6 6.6 0 0 1 8 1.4m0 1.8A4.8 4.8 0 1 0 12.8 8 4.8 4.8 0 0 0 8 3.2m-.2 1.8h1.5L11 11H9.4L9 9.4H6.9L6.5 11H4.9zm.8 1.8L8 8.4h1.1z"
          />
        </svg>
      )
    case 'godot':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 1.6c1.4 0 2.5.6 3.2 1.6.7 1 1 2.3.8 3.7L11.6 8l.4 1.1c.2 1.4-.1 2.7-.8 3.7C10.5 13.8 9.4 14.4 8 14.4s-2.5-.6-3.2-1.6c-.7-1-1-2.3-.8-3.7L4.4 8l-.4-1.1C3.8 5.5 4.1 4.2 4.8 3.2 5.5 2.2 6.6 1.6 8 1.6M6.2 6.1a1 1 0 1 0 0 2 1 1 0 0 0 0-2m3.6 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2M5.8 10.2c.6.7 1.4 1.1 2.2 1.1s1.6-.4 2.2-1.1H5.8z"
          />
        </svg>
      )
    case 'html':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M5.8 3.2 2.2 8l3.6 4.8H4.2L1.2 8 4.2 3.2zm4.4 0h1.6L14.8 8l-3 4.8H10.2L13.8 8z"
          />
        </svg>
      )
    case 'webgl':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 1.4 14.4 5v6L8 14.6 1.6 11V5zm0 2.2L3.6 5.7v4.6L8 12.4l4.4-2.1V5.7z"
          />
        </svg>
      )
    case 'java':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8.8 1.6c.8.8.8 2-.2 3.2 1.4-.2 2.4.6 2.4 1.8 0 1.4-1.3 2.2-3.2 2.2H6.2C4.6 8.8 3.4 8 3.4 6.8c0-1.1.9-1.9 2.2-2.1C5 3.6 5.8 2.4 8.8 1.6M4.8 10.2h6.4v1.2H4.8zm.8 1.8h4.8v1.2H5.6zM6 13.6h4v.8H6z"
          />
        </svg>
      )
    case 'wolfrpg':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M2 3.2 4.8 6 6.2 3.6 8 5.2 9.8 3.6 11.2 6 14 3.2 13 8.2c-.4 2.2-2.2 4-5 4.6-2.8-.6-4.6-2.4-5-4.6zm6 6.4c.7 0 1.3-.4 1.3-1H6.7c0 .6.6 1 1.3 1z"
          />
        </svg>
      )
    case 'vn':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M2.4 2.8h8.8c.7 0 1.2.5 1.2 1.2v5.2c0 .7-.5 1.2-1.2 1.2H7.2L4 13.6v-3.2H2.4c-.7 0-1.2-.5-1.2-1.2V4c0-.7.5-1.2 1.2-1.2m10.4 3.2h1.6c.7 0 1.2.5 1.2 1.2v4c0 .7-.5 1.2-1.2 1.2h-1.2v2.2l-2.2-2.2H8.8V9.2h4z"
          />
        </svg>
      )
    case 'flash':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path fill="currentColor" d="M9.2 1.4 4.4 8.6h3.1l-1.5 6 6.2-8.4H9.2z" />
        </svg>
      )
    case 'adrift':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 1.6 13.6 7H10v7.4H6V7H2.4zm-4 10.2h8v1.6H4z"
          />
        </svg>
      )
    case 'qsp':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M8 1.4A6.6 6.6 0 1 1 1.4 8 6.6 6.6 0 0 1 8 1.4m0 1.8A4.8 4.8 0 1 0 12.8 8 4.8 4.8 0 0 0 8 3.2m0 1.6A2.8 2.8 0 0 1 10.8 7.4c0 .7-.2 1.3-.6 1.8l1.6 1.6-1.2 1.2-1.6-1.6A2.8 2.8 0 1 1 8 4.8"
          />
        </svg>
      )
    case 'tyrano':
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3.2 3.2h9.6v2.2H9.4v7.4H6.6V5.4H3.2z"
          />
        </svg>
      )
    default:
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            fill="currentColor"
            d="M6.2 1.6h3.6l.6 1.8h2.2v3.6l1.8.6v3.6l-1.8.6v2.2H10.4l-.6 1.8H6.2l-.6-1.8H3.4v-2.2l-1.8-.6V7.6l1.8-.6V3.4h2.2zm1.8 4.2A2.2 2.2 0 1 0 10.2 8 2.2 2.2 0 0 0 8 5.8"
          />
        </svg>
      )
  }
}

export default function EngineBadge({ name }: EngineBadgeProps): JSX.Element | null {
  if (!name) return null
  const kind = engineKind(name)
  return (
    <div className={`engine-badge engine-badge-${kind}`} title={name}>
      <EngineMark kind={kind} />
      <span>{name}</span>
    </div>
  )
}
