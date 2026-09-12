import type { JSX } from 'react'
import type { TagTier } from '@shared/types'

export type FilterChipState = 'off' | 'include' | 'exclude'

type FilterChipProps = {
  label: string
  state: FilterChipState
  onClick: () => void
  tone?: TagTier | 'hate'
  locked?: boolean
  lockedTitle?: string
}

export function nextChipState(state: FilterChipState): FilterChipState {
  if (state === 'off') return 'include'
  if (state === 'include') return 'exclude'
  return 'off'
}

export default function FilterChip({
  label,
  state,
  onClick,
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
      onClick={locked ? undefined : onClick}
      disabled={locked}
      aria-disabled={locked || undefined}
      title={
        locked
          ? lockedTitle
          : 'Click to include, again to exclude, again to clear'
      }
    >
      {state === 'exclude' ? `− ${label}` : state === 'include' ? `+ ${label}` : label}
    </button>
  )
}
