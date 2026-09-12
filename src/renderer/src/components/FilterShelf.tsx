import { useMemo, type JSX } from 'react'
import type { CatalogFilters, FavoriteTag, MatchMode } from '@shared/types'
import { decodeHtmlEntities } from '@shared/engines'
import { sortFavoriteTags } from '../lib/favorites'
import FilterChip, { type FilterChipState } from './FilterChip'
import TagBrowser from './TagBrowser'

type FilterShelfProps = {
  filters: CatalogFilters
  prefixState: Record<number, FilterChipState>
  tagState: Record<number, FilterChipState>
  prefixType: MatchMode
  tagType: MatchMode
  tagQuery: string
  creatorInput: string
  favoriteTags: FavoriteTag[]
  onTogglePrefix: (id: number) => void
  onToggleTag: (id: number) => void
  onPrefixType: (value: MatchMode) => void
  onTagType: (value: MatchMode) => void
  onTagQuery: (value: string) => void
  onCreatorInput: (value: string) => void
}

export default function FilterShelf({
  filters,
  prefixState,
  tagState,
  prefixType,
  tagType,
  tagQuery,
  creatorInput,
  favoriteTags,
  onTogglePrefix,
  onToggleTag,
  onPrefixType,
  onTagType,
  onTagQuery,
  onCreatorInput
}: FilterShelfProps): JSX.Element {
  const statusOptions = filters.prefixes.filter((prefix) => prefix.group === 'status')
  const engineOptions = filters.prefixes.filter((prefix) => prefix.group === 'engine')
  const favoriteTagIds = useMemo(() => new Set(favoriteTags.map((tag) => tag.id)), [favoriteTags])
  const sortedFavorites = useMemo(() => sortFavoriteTags(favoriteTags), [favoriteTags])
  const activeTags = useMemo(
    () => filters.tags.filter((tag) => tagState[tag.id] && !favoriteTagIds.has(tag.id)),
    [filters.tags, tagState, favoriteTagIds]
  )

  return (
    <section className="filter-shelf">
      <div className="filter-panel">
        <div className="filter-panel-head">
          <h3 className="filter-panel-title">Basics</h3>
          <p className="filter-panel-hint">Click a chip to include, again to exclude.</p>
        </div>
        <label className="filter-field">
          <span>Creator</span>
          <input
            className="tag-search"
            value={creatorInput}
            onChange={(event) => onCreatorInput(event.target.value)}
            placeholder="Name or handle"
          />
        </label>
        <div className="filter-group">
          <div className="filter-group-head">
            <span>Status</span>
            <MatchToggle value={prefixType} onChange={onPrefixType} label="Status and engine match" />
          </div>
          <div className="filter-chips">
            {statusOptions.map((prefix) => (
              <FilterChip
                key={prefix.id}
                label={decodeHtmlEntities(prefix.name)}
                state={prefixState[prefix.id] ?? 'off'}
                onClick={() => onTogglePrefix(prefix.id)}
              />
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-group-label">Engine</span>
          <div className="filter-chips">
            {engineOptions.map((prefix) => (
              <FilterChip
                key={prefix.id}
                label={decodeHtmlEntities(prefix.name)}
                state={prefixState[prefix.id] ?? 'off'}
                onClick={() => onTogglePrefix(prefix.id)}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="filter-panel filter-panel-tags">
        <div className="filter-panel-head">
          <h3 className="filter-panel-title">Tags</h3>
          <MatchToggle value={tagType} onChange={onTagType} label="Tag match" />
        </div>
        {sortedFavorites.length ? (
          <div className="filter-group">
            <span className="filter-group-label">Favorites</span>
            <div className="filter-chips">
              {sortedFavorites.map((tag) => (
                <FilterChip
                  key={tag.id}
                  label={tag.name}
                  state={tagState[tag.id] ?? 'off'}
                  tone={tag.tier}
                  onClick={() => onToggleTag(tag.id)}
                />
              ))}
            </div>
          </div>
        ) : null}
        {activeTags.length ? (
          <div className="filter-group">
            <span className="filter-group-label">Selected</span>
            <div className="filter-chips">
              {activeTags.map((tag) => (
                <FilterChip
                  key={tag.id}
                  label={tag.name}
                  state={tagState[tag.id]}
                  onClick={() => onToggleTag(tag.id)}
                />
              ))}
            </div>
          </div>
        ) : null}
        <TagBrowser
          tags={filters.tags}
          query={tagQuery}
          onQueryChange={onTagQuery}
          excludeIds={favoriteTagIds}
          renderTag={(tag) => (
            <FilterChip
              key={tag.id}
              label={tag.name}
              state={tagState[tag.id] ?? 'off'}
              onClick={() => onToggleTag(tag.id)}
            />
          )}
        />
      </div>
    </section>
  )
}

function MatchToggle({
  value,
  onChange,
  label
}: {
  value: MatchMode
  onChange: (value: MatchMode) => void
  label: string
}): JSX.Element {
  return (
    <div className="match-toggle" role="group" aria-label={label}>
      <button
        className={value === 'and' ? 'is-active' : undefined}
        type="button"
        aria-pressed={value === 'and'}
        onClick={() => onChange('and')}
      >
        AND
      </button>
      <button
        className={value === 'or' ? 'is-active' : undefined}
        type="button"
        aria-pressed={value === 'or'}
        onClick={() => onChange('or')}
      >
        OR
      </button>
    </div>
  )
}
