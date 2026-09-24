import type { MatchMode } from '@shared/types'
import type { FilterChipState } from '../components/FilterChip'

export type AdvancedFilterSelection = {
  prefixState: Record<number, FilterChipState>
  tagState: Record<number, FilterChipState>
  tagType: MatchMode
  tagQuery: string
  creatorInput: string
  creator: string
  favoritesFilter: FilterChipState
  hatedFilter: FilterChipState
}

function emptySelection(): AdvancedFilterSelection {
  return {
    prefixState: {},
    tagState: {},
    tagType: 'or',
    tagQuery: '',
    creatorInput: '',
    creator: '',
    favoritesFilter: 'off',
    hatedFilter: 'off'
  }
}

let selection = emptySelection()
const listeners = new Set<() => void>()

export function subscribeAdvancedFilterSelection(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getAdvancedFilterSelection(): AdvancedFilterSelection {
  return selection
}

export function updateAdvancedFilterSelection(
  updater: (current: AdvancedFilterSelection) => AdvancedFilterSelection
): void {
  const next = updater(selection)
  if (next === selection) return
  selection = next
  for (const listener of listeners) listener()
}
