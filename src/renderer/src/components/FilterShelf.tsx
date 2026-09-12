import { useMemo, type JSX } from 'react'
import type { CatalogFilters, FavoriteTag, HatedTag, MatchMode } from '@shared/types'
import { decodeHtmlEntities } from '@shared/engines'
import { sortFavoriteTags } from '../lib/favorites'
import FilterChip, { type FilterChipState } from './FilterChip'
import TagBrowser from './TagBrowser'

type FilterShelfProps = {
  filters: CatalogFilters
  prefixState: Record<number, FilterChipState>
  tagState: Record<number, FilterChipState>
  tagType: MatchMode
  tagQuery: string
  creatorInput: string
  favoriteTags: FavoriteTag[]
  hatedTags: HatedTag[]
  favoritesOnly?: boolean
  hatedActive?: boolean
  lockedFavoriteIds?: number[]
  lockedHatedIds?: number[]
  includeLimitReached?: boolean
  excludeLimitReached?: boolean
  onTogglePrefix: (id: number) => void
  onToggleTag: (id: number) => void
  onTagType: (value: MatchMode) => void
  onTagQuery: (value: string) => void
  onCreatorInput: (value: string) => void
}

export default function FilterShelf({
  filters,
  prefixState,
  tagState,
  tagType,
  tagQuery,
  creatorInput,
  favoriteTags,
  hatedTags,
  favoritesOnly = false,
  hatedActive = false,
  lockedFavoriteIds = [],
  lockedHatedIds = [],
  includeLimitReached = false,
  excludeLimitReached = false,
  onTogglePrefix,
  onToggleTag,
  onTagType,
  onTagQuery,
  onCreatorInput
}: FilterShelfProps): JSX.Element {
  const statusOptions = filters.prefixes.filter((prefix) => prefix.group === 'status')
  const engineOptions = filters.prefixes.filter((prefix) => prefix.group === 'engine')
  const favoriteTagIds = useMemo(() => new Set(favoriteTags.map((tag) => tag.id)), [favoriteTags])
  const hatedTagIds = useMemo(() => new Set(hatedTags.map((tag) => tag.id)), [hatedTags])
  const lockedFavoriteSet = useMemo(() => new Set(lockedFavoriteIds), [lockedFavoriteIds])
  const lockedHatedSet = useMemo(() => new Set(lockedHatedIds), [lockedHatedIds])
  const reservedIds = useMemo(
    () => new Set([...favoriteTagIds, ...hatedTagIds]),
    [favoriteTagIds, hatedTagIds]
  )
  const sortedFavorites = useMemo(() => sortFavoriteTags(favoriteTags), [favoriteTags])
  const sortedHated = useMemo(
    () => [...hatedTags].sort((a, b) => a.name.localeCompare(b.name)),
    [hatedTags]
  )
  const offTagsLocked = includeLimitReached || excludeLimitReached

  function tagLocked(id: number, state: FilterChipState | undefined): boolean {
    if (lockedFavoriteSet.has(id) || lockedHatedSet.has(id)) return true
    return (state ?? 'off') === 'off' && offTagsLocked
  }

  function tagLockedTitle(id: number): string {
    if (lockedFavoriteSet.has(id)) return 'Locked on by favorite tags'
    if (lockedHatedSet.has(id)) return 'Locked off by hated tags'
    if (includeLimitReached && excludeLimitReached) {
      return 'Include and exclude limits reached'
    }
    if (includeLimitReached) return 'Include limit reached (10 tags)'
    return 'Exclude limit reached (10 tags)'
  }
  const activeTags = useMemo(
    () => filters.tags.filter((tag) => tagState[tag.id] && !reservedIds.has(tag.id)),
    [filters.tags, tagState, reservedIds]
  )
  const matchLocked = favoritesOnly || hatedActive

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
          <span className="filter-group-label">Status</span>
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
          <MatchToggle
            value={matchLocked ? 'or' : tagType}
            onChange={onTagType}
            disabled={matchLocked}
            label="Tag match"
          />
        </div>
        {sortedFavorites.length ? (
          <div className="filter-group">
            <span className="filter-group-label">
              {favoritesOnly
                ? lockedFavoriteIds.length < favoriteTags.length
                  ? 'Favorites (highest tiers locked on)'
                  : 'Favorites (locked on)'
                : 'Favorites'}
            </span>
            <div className="filter-chips">
              {sortedFavorites.map((tag) => (
                <FilterChip
                  key={tag.id}
                  label={tag.name}
                  state={tagState[tag.id] ?? 'off'}
                  tone={tag.tier}
                  locked={tagLocked(tag.id, tagState[tag.id])}
                  lockedTitle={tagLockedTitle(tag.id)}
                  onClick={() => onToggleTag(tag.id)}
                />
              ))}
            </div>
          </div>
        ) : null}
        {sortedHated.length ? (
          <div className="filter-group">
            <span className="filter-group-label">
              {hatedActive ? 'Hated (locked off)' : 'Hated'}
            </span>
            <div className="filter-chips">
              {sortedHated.map((tag) => (
                <FilterChip
                  key={tag.id}
                  label={tag.name}
                  state={tagState[tag.id] ?? 'off'}
                  tone="hate"
                  locked={tagLocked(tag.id, tagState[tag.id])}
                  lockedTitle={tagLockedTitle(tag.id)}
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
                  locked={tagLocked(tag.id, tagState[tag.id])}
                  lockedTitle={tagLockedTitle(tag.id)}
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
          excludeIds={reservedIds}
          renderTag={(tag) => (
            <FilterChip
              key={tag.id}
              label={tag.name}
              state={tagState[tag.id] ?? 'off'}
              locked={tagLocked(tag.id, tagState[tag.id])}
              lockedTitle={tagLockedTitle(tag.id)}
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
  label,
  disabled = false
}: {
  value: MatchMode
  onChange: (value: MatchMode) => void
  label: string
  disabled?: boolean
}): JSX.Element {
  return (
    <div className="match-toggle" role="group" aria-label={label}>
      <button
        className={value === 'and' ? 'is-active' : undefined}
        type="button"
        aria-pressed={value === 'and'}
        disabled={disabled}
        onClick={() => onChange('and')}
      >
        AND
      </button>
      <button
        className={value === 'or' ? 'is-active' : undefined}
        type="button"
        aria-pressed={value === 'or'}
        disabled={disabled}
        onClick={() => onChange('or')}
      >
        OR
      </button>
    </div>
  )
}
