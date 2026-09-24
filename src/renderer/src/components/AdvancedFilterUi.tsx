import { useEffect, type JSX, type MouseEvent, type ReactNode } from 'react'
import type { FavoriteTag, HatedTag } from '@shared/types'
import type { AdvancedFilters } from '../lib/use-advanced-filters'
import { isMiddleClick, triStateMouseProps } from './FilterChip'
import FilterShelf from './FilterShelf'
import { FilterIcon } from './ToolbarIcons'

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
  function clearIfActive(event: MouseEvent): void {
    event.preventDefault()
    if (count) onClear()
  }

  return (
    <button
      className={open ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
      type="button"
      data-filter-toggle=""
      aria-pressed={open}
      title={
        count
          ? `Filters (${count}). Right-click or middle-click to clear.`
          : 'Filters'
      }
      aria-label={count ? `Filters, ${count} active` : 'Filters'}
      onClick={onToggle}
      onMouseDown={(event) => {
        if (isMiddleClick(event)) event.preventDefault()
      }}
      onContextMenu={clearIfActive}
      onAuxClick={(event) => {
        if (!isMiddleClick(event)) return
        clearIfActive(event)
      }}
    >
      <FilterIcon />
      {count ? <span className="icon-btn-badge">{count}</span> : null}
    </button>
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
    function onTopBarPointer(event: PointerEvent): void {
      const target = event.target
      if (!(target instanceof Element)) return
      if (!target.closest('.top-bar')) return
      if (target.closest('[data-filter-toggle]')) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onTopBarPointer)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onTopBarPointer)
    }
  }, [open, onClose])

  if (!open) return null

  function closeFromMouse(event: MouseEvent): void {
    event.preventDefault()
    onClose()
  }

  function isFilterControl(target: EventTarget | null): boolean {
    return (
      target instanceof Element &&
      Boolean(target.closest('button, input, textarea, select, a, .chip, .quick-filter-chip'))
    )
  }

  function closeFromDrawerBackground(event: MouseEvent): void {
    if (isFilterControl(event.target)) return
    closeFromMouse(event)
  }

  return (
    <div className="filter-overlay">
      <button
        className="filter-backdrop"
        type="button"
        aria-label="Close filters"
        {...triStateMouseProps(closeFromMouse)}
      />
      <div
        onMouseDown={(event) => {
          if (isFilterControl(event.target)) return
          if (isMiddleClick(event)) event.preventDefault()
        }}
        onContextMenu={closeFromDrawerBackground}
        onAuxClick={(event) => {
          if (!isMiddleClick(event)) return
          closeFromDrawerBackground(event)
        }}
      >
        {children}
      </div>
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
        onApplyQuickFilter={advanced.applyQuickFilter}
      />
    </FilterOverlay>
  )
}
