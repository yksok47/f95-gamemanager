import { useEffect, type JSX, type ReactNode } from 'react'
import type { FavoriteTag, HatedTag } from '@shared/types'
import type { AdvancedFilters } from '../lib/use-advanced-filters'
import FilterShelf from './FilterShelf'
import { ClearIcon, FilterIcon } from './ToolbarIcons'

export function FilterToolbarSplit({
  open,
  count,
  onToggle,
  onClear
}: {
  open: boolean
  count: number
  onToggle: () => void
  onClear: () => void
}): JSX.Element {
  return (
    <div
      className={['filter-split', open ? 'is-open' : '', count ? 'is-split' : '']
        .filter(Boolean)
        .join(' ')}
    >
      <button
        className={open ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
        type="button"
        aria-pressed={open}
        title={count ? `Filters (${count})` : 'Filters'}
        aria-label={count ? `Filters, ${count} active` : 'Filters'}
        onClick={onToggle}
      >
        <FilterIcon />
      </button>
      {count ? (
        <button
          className="ghost-btn icon-btn filter-split-clear"
          type="button"
          title="Clear filters"
          aria-label="Clear filters"
          onClick={onClear}
        >
          <span className="filter-split-count">{count}</span>
          <span className="filter-split-x">
            <ClearIcon />
          </span>
        </button>
      ) : null}
    </div>
  )
}

export function FilterOverlay({
  open,
  onClose,
  children
}: {
  open: boolean
  onClose: () => void
  children: ReactNode
}): JSX.Element | null {
  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="filter-overlay">
      <button
        className="filter-backdrop"
        type="button"
        aria-label="Close filters"
        onClick={onClose}
      />
      {children}
    </div>
  )
}

export function LocalAdvancedFilters({
  advanced,
  favoriteTags,
  hatedTags
}: {
  advanced: AdvancedFilters
  favoriteTags: FavoriteTag[]
  hatedTags: HatedTag[]
}): JSX.Element | null {
  return (
    <FilterOverlay open={advanced.filtersOpen} onClose={advanced.closeFilters}>
      <FilterShelf
        filters={advanced.filters}
        prefixState={advanced.prefixState}
        tagState={advanced.tagState}
        tagType={advanced.tagType}
        tagQuery={advanced.tagQuery}
        creatorInput={advanced.creatorInput}
        favoriteTags={favoriteTags}
        hatedTags={hatedTags}
        favoriteFilter={advanced.favoritesFilter}
        hatedFilter={advanced.hatedFilter}
        lockedFavoriteIds={advanced.lockedFavoriteIds}
        lockedHatedIds={advanced.lockedHatedIds}
        onTogglePrefix={advanced.togglePrefix}
        onToggleTag={advanced.toggleTag}
        onTagType={advanced.setTagType}
        onTagQuery={advanced.setTagQuery}
        onCreatorInput={advanced.setCreatorInput}
      />
    </FilterOverlay>
  )
}
