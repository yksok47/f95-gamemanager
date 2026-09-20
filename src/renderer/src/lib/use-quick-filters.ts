import { useCallback, useEffect, useState } from 'react'
import { MAX_QUICK_FILTERS } from '@shared/quick-filters'
import {
  captureQuickFilterSnapshot,
  clearLegacyQuickFilters,
  loadLegacyQuickFilters,
  type QuickFilter,
  type QuickFilterSnapshot
} from './quick-filters'

export function useQuickFilters(): {
  quickFilters: QuickFilter[]
  createQuickFilter: (name: string, snapshot: QuickFilterSnapshot) => boolean
  removeQuickFilter: (id: string) => void
} {
  const [quickFilters, setQuickFilters] = useState<QuickFilter[]>(loadLegacyQuickFilters)

  useEffect(() => {
    let cancelled = false

    void window.api.settings.get().then(async (settings) => {
      if (cancelled) return
      const stored = settings.quickFilters ?? []
      if (stored.length) {
        setQuickFilters(stored)
        clearLegacyQuickFilters()
        return
      }
      const legacy = loadLegacyQuickFilters()
      if (!legacy.length) return
      setQuickFilters(legacy)
      try {
        await window.api.settings.save({ quickFilters: legacy })
        if (!cancelled) clearLegacyQuickFilters()
      } catch {
        /* keep showing the in-memory list if persist fails */
      }
    })

    const stop = window.api.settings.onChange((settings) => {
      setQuickFilters(settings.quickFilters ?? [])
    })

    return () => {
      cancelled = true
      stop()
    }
  }, [])

  const persist = useCallback((next: QuickFilter[]) => {
    const stored = next.slice(0, MAX_QUICK_FILTERS)
    setQuickFilters(stored)
    clearLegacyQuickFilters()
    void window.api.settings.save({ quickFilters: stored }).catch(() => {
      /* settings:changed / next load will restore the last persisted list */
    })
  }, [])

  const createQuickFilter = useCallback(
    (name: string, snapshot: QuickFilterSnapshot): boolean => {
      const trimmed = name.trim()
      if (!trimmed || quickFilters.length >= MAX_QUICK_FILTERS) return false
      persist([
        ...quickFilters,
        {
          id: crypto.randomUUID(),
          name: trimmed,
          snapshot: captureQuickFilterSnapshot(snapshot)
        }
      ])
      return true
    },
    [persist, quickFilters]
  )

  const removeQuickFilter = useCallback(
    (id: string) => {
      persist(quickFilters.filter((item) => item.id !== id))
    },
    [persist, quickFilters]
  )

  return { quickFilters, createQuickFilter, removeQuickFilter }
}
