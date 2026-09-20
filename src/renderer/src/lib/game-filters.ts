import type { MatchMode } from '@shared/types'
import type { FilterChipState } from '../components/FilterChip'

export type LocalFilterGame = {
  prefixes?: number[]
  tags?: number[]
  creator?: string
}

export type LocalFilterQuery = {
  includePrefixes: number[]
  excludePrefixes: number[]
  includeTags: number[]
  excludeTags: number[]
  tagType: MatchMode
  creator: string
}

export function selectedChipIds(
  state: Record<number, FilterChipState>,
  which: Exclude<FilterChipState, 'off'>
): number[] {
  return Object.entries(state)
    .filter(([, value]) => value === which)
    .map(([id]) => Number(id))
}

function hasAll(ids: ReadonlySet<number>, needed: number[]): boolean {
  return needed.every((id) => ids.has(id))
}

function hasAny(ids: ReadonlySet<number>, needed: number[]): boolean {
  return needed.some((id) => ids.has(id))
}

/** Client-side catalog-style prefix/tag/creator matching. Prefix includes are AND. */
export function matchesLocalFilters(game: LocalFilterGame, query: LocalFilterQuery): boolean {
  if (query.creator) {
    const creator = (game.creator ?? '').toLowerCase()
    if (!creator.includes(query.creator.toLowerCase())) return false
  }

  const prefixes = new Set(game.prefixes ?? [])
  if (query.includePrefixes.length && !hasAll(prefixes, query.includePrefixes)) return false
  if (query.excludePrefixes.length && hasAny(prefixes, query.excludePrefixes)) return false

  const tags = new Set(game.tags ?? [])
  if (query.includeTags.length) {
    const matched =
      query.tagType === 'and' ? hasAll(tags, query.includeTags) : hasAny(tags, query.includeTags)
    if (!matched) return false
  }
  if (query.excludeTags.length && hasAny(tags, query.excludeTags)) return false

  return true
}
