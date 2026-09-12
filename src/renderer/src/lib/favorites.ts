import { TAG_TIER_RANK, type FavoriteTag, type TagTier } from '@shared/types'

export function sortFavoriteTags(tags: FavoriteTag[]): FavoriteTag[] {
  return [...tags].sort(
    (a, b) => TAG_TIER_RANK[b.tier] - TAG_TIER_RANK[a.tier] || a.name.localeCompare(b.name)
  )
}

export function gameHasFavoriteTag(
  tagIds: number[] | undefined,
  favorites: FavoriteTag[]
): boolean {
  return favoriteTagsOnGame(tagIds, favorites).length > 0
}

export function favoriteTagsOnGame(
  tagIds: number[] | undefined,
  favorites: FavoriteTag[]
): FavoriteTag[] {
  if (!tagIds?.length || !favorites.length) return []
  const present = new Set(tagIds)
  return sortFavoriteTags(favorites.filter((tag) => present.has(tag.id)))
}

export function favoriteTierByName(
  name: string,
  favorites: FavoriteTag[]
): TagTier | undefined {
  const needle = name.trim().toLowerCase()
  if (!needle) return undefined
  return favorites.find((tag) => tag.name.toLowerCase() === needle)?.tier
}
