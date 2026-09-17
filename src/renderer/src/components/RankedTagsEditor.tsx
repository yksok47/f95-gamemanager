import { useMemo, useState, type JSX } from 'react'
import { TAGS_PER_TIER_LIMIT, TAG_TIERS, type CatalogTag, type FavoriteTag, type TagTier } from '@shared/types'
import { sortFavoriteTags } from '../lib/favorites'
import TagBrowser from './TagBrowser'
import { notifyError } from './ErrorNotifications'

function tierLabel(tier: TagTier): string {
  return tier[0].toUpperCase() + tier.slice(1)
}

type RankedTagsEditorProps = {
  selected: FavoriteTag[]
  catalogTags: CatalogTag[]
  busy: boolean
  saving: boolean
  hint: string
  removeTitle: string
  blockedIds?: Set<number>
  onChange: (next: FavoriteTag[]) => void
}

export default function RankedTagsEditor({
  selected,
  catalogTags,
  busy,
  saving,
  hint,
  removeTitle,
  blockedIds,
  onChange
}: RankedTagsEditorProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [addAs, setAddAs] = useState<TagTier>('gold')

  const grouped = useMemo(() => {
    const byTier: Record<TagTier, FavoriteTag[]> = { gold: [], silver: [], bronze: [] }
    for (const tag of sortFavoriteTags(selected)) {
      byTier[tag.tier].push(tag)
    }
    return byTier
  }, [selected])

  function assignTag(tag: CatalogTag, tier: TagTier): void {
    const current = selected.filter((item) => item.id !== tag.id)
    if (current.filter((item) => item.tier === tier).length >= TAGS_PER_TIER_LIMIT) {
      notifyError(`${tierLabel(tier)} is full (${TAGS_PER_TIER_LIMIT} tags).`)
      return
    }
    onChange([...current, { id: tag.id, name: tag.name, tier }])
  }

  function removeTag(id: number): void {
    onChange(selected.filter((tag) => tag.id !== id))
  }

  return (
    <div className="settings-tab-body">
      <p className="muted settings-tag-hint">
        {hint}
        {saving ? ' Saving…' : ''}
      </p>
      <div className="favorite-tiers">
        {TAG_TIERS.map((tier) => (
          <div
            key={tier}
            className={`favorite-tier favorite-tier-${tier}${addAs === tier ? ' is-selected' : ''}`}
            role="button"
            tabIndex={0}
            aria-pressed={addAs === tier}
            onClick={() => setAddAs(tier)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                setAddAs(tier)
              }
            }}
          >
            <div className="favorite-tier-head">
              <h2>{tierLabel(tier)}</h2>
              <span className="muted">
                {grouped[tier].length}/{TAGS_PER_TIER_LIMIT}
              </span>
            </div>
            {grouped[tier].length ? (
              <div className="filter-chips">
                {grouped[tier].map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={`chip chip-${tag.tier}`}
                    title={removeTitle}
                    onClick={(event) => {
                      event.stopPropagation()
                      removeTag(tag.id)
                    }}
                  >
                    {tag.name} ×
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted">No {tier} tags yet.</p>
            )}
          </div>
        ))}
      </div>

      {busy ? <p className="muted">Loading tags…</p> : null}

      <TagBrowser
        tags={catalogTags}
        query={query}
        onQueryChange={setQuery}
        renderTag={(tag) => {
          const current = selected.find((item) => item.id === tag.id)
          const blocked = !current && blockedIds?.has(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              className={current ? `chip chip-${current.tier}` : 'chip'}
              title={
                blocked
                  ? `Move to ${tierLabel(addAs)}`
                  : current
                    ? `Move to ${tierLabel(addAs)}`
                    : `Add to ${tierLabel(addAs)}`
              }
              onClick={() => assignTag(tag, addAs)}
            >
              {tag.name}
            </button>
          )
        }}
      />
    </div>
  )
}
