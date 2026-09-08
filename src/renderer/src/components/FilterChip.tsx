import type { JSX } from 'react'
import type { TagTier } from '@shared/types'

export type FilterChipState = 'off' | 'include' | 'exclude'

type FilterChipProps = {
  label: string
  state: FilterChipState
  onClick: () => void
  tone?: TagTier
}

export function nextChipState(state: FilterChipState): FilterChipState {
  if (state === 'off') return 'include'
  if (state === 'include') return 'exclude'
  return 'off'
}

export default function FilterChip({ label, state, onClick, tone }: FilterChipProps): JSX.Element {
  return (
    <button
      type="button"
      className={['chip', `chip-${state}`, tone ? `chip-${tone}` : ''].filter(Boolean).join(' ')}
      onClick={onClick}
      title="Click to include, again to exclude, again to clear"
    >
      {state === 'exclude' ? `− ${label}` : label}
    </button>
  )
}
