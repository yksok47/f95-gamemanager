import type { JSX, MouseEvent } from 'react'
import { engineKind, normalizeEngine } from '@shared/engines'
import type { FilterChipState, TagTier } from '@shared/types'
import { EngineMark } from './EngineBadge'

export type { FilterChipState }
export type ChipCycleDirection = 'forward' | 'reverse' | 'reset'

type FilterChipProps = {
  label: string
  state: FilterChipState
  onCycle: (direction: ChipCycleDirection) => void
  tone?: TagTier | 'hate'
  appearance?: 'default' | 'engine'
  locked?: boolean
  lockedTitle?: string
}

export function cycleChipState(
  state: FilterChipState,
  direction: ChipCycleDirection = 'forward'
): FilterChipState {
  if (direction === 'reset') return 'off'
  if (direction === 'forward') {
    if (state === 'off') return 'include'
    if (state === 'include') return 'exclude'
    return 'off'
  }
  if (state === 'off') return 'exclude'
  if (state === 'exclude') return 'include'
  return 'off'
}

export function isMiddleClick(event: Pick<MouseEvent, 'button'>): boolean {
  return event.button === 1
}

export function cycleDirectionFromEvent(
  event: Pick<MouseEvent, 'type' | 'button'>,
  primary: ChipCycleDirection = 'forward'
): ChipCycleDirection {
  if (isMiddleClick(event)) return 'reset'
  const reverseClick = event.type === 'contextmenu' || event.button === 2
  if (primary === 'forward') return reverseClick ? 'reverse' : 'forward'
  return reverseClick ? 'forward' : 'reverse'
}

export function onTriStateMouse(
  event: MouseEvent,
  setState: (update: (state: FilterChipState) => FilterChipState) => void,
  primary: ChipCycleDirection = 'forward'
): void {
  event.preventDefault()
  const direction = cycleDirectionFromEvent(event, primary)
  setState((state) => cycleChipState(state, direction))
}

export function triStateMouseProps(
  onActivate: (event: MouseEvent) => void
): {
  onMouseDown: (event: MouseEvent) => void
  onClick: (event: MouseEvent) => void
  onContextMenu: (event: MouseEvent) => void
  onAuxClick: (event: MouseEvent) => void
} {
  return {
    onMouseDown: (event) => {
      if (isMiddleClick(event)) event.preventDefault()
    },
    onClick: onActivate,
    onContextMenu: onActivate,
    onAuxClick: (event) => {
      if (!isMiddleClick(event)) return
      event.preventDefault()
      onActivate(event)
    }
  }
}

export function matchesTriState(isMatch: boolean, state: FilterChipState): boolean {
  if (state === 'include') return isMatch
  if (state === 'exclude') return !isMatch
  return true
}

export function toolbarTriStateClass(state: FilterChipState): string {
  if (state === 'include') return 'ghost-btn icon-btn nav-btn-active'
  if (state === 'exclude') return 'ghost-btn icon-btn nav-btn-exclude'
  return 'ghost-btn icon-btn'
}

export function favoriteToolbarTitle(state: FilterChipState, hasTags: boolean): string {
  if (!hasTags) return 'Add favorite tags in Settings'
  if (state === 'include') return 'Showing only favorite tags'
  if (state === 'exclude') return 'Hiding games with favorite tags'
  return 'Showing all tags'
}

export function hatedToolbarTitle(state: FilterChipState, hasTags: boolean): string {
  if (!hasTags) return 'Add hated tags in Settings'
  if (state === 'include') return 'Showing only hated tags'
  if (state === 'exclude') return 'Hiding games with hated tags'
  return 'Not filtering hated tags'
}

export function archivedToolbarTitle(state: FilterChipState): string {
  if (state === 'include') return 'Showing only archived games'
  if (state === 'exclude') return 'Hiding archived games'
  return 'Showing archived and unarchived games'
}

export default function FilterChip({
  label,
  state,
  onCycle,
  tone,
  appearance = 'default',
  locked = false,
  lockedTitle = 'Locked by tag list'
}: FilterChipProps): JSX.Element {
  const engine = appearance === 'engine'
  const kind = engine ? engineKind(label) : null
  const text = kind ? normalizeEngine(label) || label : label
  const signed = state === 'exclude' ? `− ${text}` : state === 'include' ? `+ ${text}` : text

  return (
    <button
      type="button"
      className={[
        'chip',
        `chip-${state}`,
        tone ? `chip-${tone}` : '',
        locked ? 'chip-locked' : '',
        kind ? `engine-badge engine-badge-${kind}` : ''
      ]
        .filter(Boolean)
        .join(' ')}
      {...(locked
        ? {}
        : triStateMouseProps((event) => {
            event.preventDefault()
            onCycle(cycleDirectionFromEvent(event))
          }))}
      disabled={locked}
      aria-disabled={locked || undefined}
      title={
        locked
          ? lockedTitle
          : 'Left-click include, again exclude. Right-click reverses. Middle-click resets.'
      }
    >
      {kind ? (
        <>
          <EngineMark kind={kind} />
          <span>{signed}</span>
        </>
      ) : (
        signed
      )}
    </button>
  )
}
