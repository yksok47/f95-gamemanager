import type { JSX, MouseEvent } from 'react'
import type { TagTier } from '@shared/types'

export type FilterChipState = 'off' | 'include' | 'exclude'
export type ChipCycleDirection = 'forward' | 'reverse'

type FilterChipProps = {
  label: string
  state: FilterChipState
  onCycle: (direction: ChipCycleDirection) => void
  tone?: TagTier | 'hate'
  locked?: boolean
  lockedTitle?: string
}

export function cycleChipState(
  state: FilterChipState,
  direction: ChipCycleDirection = 'forward'
): FilterChipState {
  if (direction === 'forward') {
    if (state === 'off') return 'include'
    if (state === 'include') return 'exclude'
    return 'off'
  }
  if (state === 'off') return 'exclude'
  if (state === 'exclude') return 'include'
  return 'off'
}

export function cycleDirectionFromEvent(
  event: Pick<MouseEvent, 'type' | 'button'>,
  primary: ChipCycleDirection = 'forward'
): ChipCycleDirection {
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
  locked = false,
  lockedTitle = 'Locked by tag list'
}: FilterChipProps): JSX.Element {
  return (
    <button
      type="button"
      className={['chip', `chip-${state}`, tone ? `chip-${tone}` : '', locked ? 'chip-locked' : '']
        .filter(Boolean)
        .join(' ')}
      onClick={
        locked
          ? undefined
          : (event) => {
              event.preventDefault()
              onCycle(cycleDirectionFromEvent(event))
            }
      }
      onContextMenu={
        locked
          ? undefined
          : (event) => {
              event.preventDefault()
              onCycle(cycleDirectionFromEvent(event))
            }
      }
      disabled={locked}
      aria-disabled={locked || undefined}
      title={
        locked
          ? lockedTitle
          : 'Left-click include, again exclude. Right-click reverses.'
      }
    >
      {state === 'exclude' ? `− ${label}` : state === 'include' ? `+ ${label}` : label}
    </button>
  )
}
