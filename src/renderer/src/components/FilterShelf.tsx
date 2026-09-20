import { useMemo, useRef, useState, type JSX, type KeyboardEvent } from 'react'
import type { CatalogFilters, FavoriteTag, HatedTag, MatchMode } from '@shared/types'
import { decodeHtmlEntities } from '@shared/engines'
import { sortFavoriteTags } from '../lib/favorites'
import { captureQuickFilterSnapshot, type QuickFilterSnapshot } from '../lib/quick-filters'
import { useQuickFilters } from '../lib/use-quick-filters'
import FilterChip, { type ChipCycleDirection, type FilterChipState } from './FilterChip'
import { ClearIcon } from './ToolbarIcons'
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
  favoriteFilter?: FilterChipState
  hatedFilter?: FilterChipState
  lockedFavoriteIds?: number[]
  lockedHatedIds?: number[]
  includeLimitReached?: boolean
  excludeLimitReached?: boolean
  onTogglePrefix: (id: number, direction?: ChipCycleDirection) => void
  onToggleTag: (id: number, direction?: ChipCycleDirection) => void
  onTagType: (value: MatchMode) => void
  onTagQuery: (value: string) => void
  onCreatorInput: (value: string) => void
  onApplyQuickFilter: (snapshot: QuickFilterSnapshot) => void
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
  favoriteFilter = 'off',
  hatedFilter = 'off',
  lockedFavoriteIds = [],
  lockedHatedIds = [],
  includeLimitReached = false,
  excludeLimitReached = false,
  onTogglePrefix,
  onToggleTag,
  onTagType,
  onTagQuery,
  onCreatorInput,
  onApplyQuickFilter
}: FilterShelfProps): JSX.Element {
  const { quickFilters, createQuickFilter, removeQuickFilter } = useQuickFilters()
  const [draftingQuickFilter, setDraftingQuickFilter] = useState(false)
  const [quickFilterName, setQuickFilterName] = useState('')
  const draftingQuickFilterRef = useRef(false)
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
  const offTagsLocked = includeLimitReached && excludeLimitReached

  function tagLocked(id: number, state: FilterChipState | undefined): boolean {
    if (lockedFavoriteSet.has(id) || lockedHatedSet.has(id)) return true
    return (state ?? 'off') === 'off' && offTagsLocked
  }

  function tagLockedTitle(id: number): string {
    if (lockedFavoriteSet.has(id)) {
      return favoriteFilter === 'exclude' ? 'Locked off by favorite tags' : 'Locked on by favorite tags'
    }
    if (lockedHatedSet.has(id)) {
      return hatedFilter === 'include' ? 'Locked on by hated tags' : 'Locked off by hated tags'
    }
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
  const matchLocked = favoriteFilter !== 'off' || hatedFilter !== 'off'

  function startQuickFilterDraft(): void {
    draftingQuickFilterRef.current = true
    setQuickFilterName('')
    setDraftingQuickFilter(true)
  }

  function cancelQuickFilterDraft(): void {
    draftingQuickFilterRef.current = false
    setDraftingQuickFilter(false)
    setQuickFilterName('')
  }

  function commitQuickFilterDraft(): void {
    if (!draftingQuickFilterRef.current) return
    const name = quickFilterName
    cancelQuickFilterDraft()
    createQuickFilter(
      name,
      captureQuickFilterSnapshot({
        prefixState,
        tagState,
        tagType,
        creator: creatorInput,
        favoritesFilter: favoriteFilter,
        hatedFilter
      })
    )
  }

  function onQuickFilterDraftKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitQuickFilterDraft()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelQuickFilterDraft()
    }
  }

  return (
    <section className="filter-shelf">
      <div className="quick-filters">
        {quickFilters.map((item) => (
          <span key={item.id} className="quick-filter-chip">
            <button type="button" title={item.name} onClick={() => onApplyQuickFilter(item.snapshot)}>
              {item.name}
            </button>
            <button
              type="button"
              className="quick-filter-chip-remove"
              title={`Remove ${item.name}`}
              aria-label={`Remove ${item.name}`}
              onClick={() => removeQuickFilter(item.id)}
            >
              <ClearIcon />
            </button>
          </span>
        ))}
        {draftingQuickFilter ? (
          <span className="quick-filter-chip is-draft">
            <input
              autoFocus
              value={quickFilterName}
              onChange={(event) => setQuickFilterName(event.target.value)}
              onBlur={commitQuickFilterDraft}
              onKeyDown={onQuickFilterDraftKey}
              aria-label="Quick filter name"
              size={Math.max(4, quickFilterName.length + 1)}
            />
          </span>
        ) : (
          <button className="chip" type="button" onClick={startQuickFilterDraft}>
            Add
          </button>
        )}
        {quickFilters.length || draftingQuickFilter ? null : (
          <span className="quick-filters-placeholder">Save the current filters as a named shortcut</span>
        )}
      </div>
      <div className="filter-panel">
        <div className="filter-panel-head">
          <h3 className="filter-panel-title">Basics</h3>
          <p className="filter-panel-hint">
            Left-click a chip to include, again to exclude. Right-click reverses. Middle-click resets.
          </p>
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
                onCycle={(direction) => onTogglePrefix(prefix.id, direction)}
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
                appearance="engine"
                state={prefixState[prefix.id] ?? 'off'}
                onCycle={(direction) => onTogglePrefix(prefix.id, direction)}
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
              {favoriteFilter === 'include'
                ? lockedFavoriteIds.length < favoriteTags.length
                  ? 'Favorites (highest tiers locked on)'
                  : 'Favorites (locked on)'
                : favoriteFilter === 'exclude'
                  ? lockedFavoriteIds.length < favoriteTags.length
                    ? 'Favorites (highest tiers locked off)'
                    : 'Favorites (locked off)'
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
                  onCycle={(direction) => onToggleTag(tag.id, direction)}
                />
              ))}
            </div>
          </div>
        ) : null}
        {sortedHated.length ? (
          <div className="filter-group">
            <span className="filter-group-label">
              {hatedFilter === 'include'
                ? 'Hated (locked on)'
                : hatedFilter === 'exclude'
                  ? 'Hated (locked off)'
                  : 'Hated'}
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
                  onCycle={(direction) => onToggleTag(tag.id, direction)}
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
                  onCycle={(direction) => onToggleTag(tag.id, direction)}
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
              onCycle={(direction) => onToggleTag(tag.id, direction)}
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
