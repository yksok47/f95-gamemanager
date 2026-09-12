import {
  TAG_QUERY_LIMIT,
  TAG_TIER_RANK,
  TAGS_PER_TIER_LIMIT,
  type FavoriteTag,
  type TagTier
} from './types'

export function sortRankedTags(tags: FavoriteTag[]): FavoriteTag[] {
  return [...tags].sort(
    (a, b) => TAG_TIER_RANK[b.tier] - TAG_TIER_RANK[a.tier] || a.name.localeCompare(b.name)
  )
}

export function capTagsPerTier(
  tags: FavoriteTag[],
  limit = TAGS_PER_TIER_LIMIT
): FavoriteTag[] {
  const used: Record<TagTier, number> = { gold: 0, silver: 0, bronze: 0 }
  const next: FavoriteTag[] = []
  for (const tag of sortRankedTags(tags)) {
    if (used[tag.tier] >= limit) continue
    used[tag.tier] += 1
    next.push(tag)
  }
  return next
}

/** Drop lower tiers until the list fits the catalog tag query limit. */
export function selectTagsForQuery(
  tags: FavoriteTag[],
  limit = TAG_QUERY_LIMIT
): FavoriteTag[] {
  if (tags.length <= limit) return sortRankedTags(tags)
  const gold = tags.filter((tag) => tag.tier === 'gold')
  const silver = tags.filter((tag) => tag.tier === 'silver')
  if (gold.length + silver.length <= limit) return sortRankedTags([...gold, ...silver])
  return sortRankedTags(gold)
}

export function rankedTagIds(tags: FavoriteTag[]): number[] {
  return tags.map((tag) => tag.id)
}
