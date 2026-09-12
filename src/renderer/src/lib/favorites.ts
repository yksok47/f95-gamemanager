import { sortRankedTags } from '@shared/ranked-tags'
import type { FavoriteTag, HatedTag, TagTier } from '@shared/types'

export { selectTagsForQuery } from '@shared/ranked-tags'
export { sortRankedTags as sortFavoriteTags } from '@shared/ranked-tags'

export function gameHasFavoriteTag(
  tagIds: number[] | undefined,
  favorites: Array<{ id: number }>
): boolean {
  if (!tagIds?.length || !favorites.length) return false
  const present = new Set(tagIds)
  return favorites.some((tag) => present.has(tag.id))
}

export function favoriteTagsOnGame(
  tagIds: number[] | undefined,
  favorites: FavoriteTag[]
): FavoriteTag[] {
  if (!tagIds?.length || !favorites.length) return []
  const present = new Set(tagIds)
  return sortRankedTags(favorites.filter((tag) => present.has(tag.id)))
}


export function favoriteTierByName(
  name: string,
  favorites: FavoriteTag[]
): TagTier | undefined {
  const needle = name.trim().toLowerCase()
  if (!needle) return undefined
  return favorites.find((tag) => tag.name.toLowerCase() === needle)?.tier
}

export function hatedTagsOnGame(
  tagIds: number[] | undefined,
  hated: HatedTag[]
): HatedTag[] {
  if (!tagIds?.length || !hated.length) return []
  const present = new Set(tagIds)
  return hated.filter((tag) => present.has(tag.id)).sort((a, b) => a.name.localeCompare(b.name))
}

export function isHatedTagName(name: string, hated: HatedTag[]): boolean {
  const needle = name.trim().toLowerCase()
  if (!needle) return false
  return hated.some((tag) => tag.name.toLowerCase() === needle)
}
