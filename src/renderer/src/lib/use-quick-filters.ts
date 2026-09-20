import { useCallback, useState } from 'react'
import {
  captureQuickFilterSnapshot,
  loadQuickFilters,
  saveQuickFilters,
  type QuickFilter,
  type QuickFilterSnapshot
} from './quick-filters'

export function useQuickFilters(): {
  quickFilters: QuickFilter[]
  createQuickFilter: (name: string, snapshot: QuickFilterSnapshot) => boolean
  removeQuickFilter: (id: string) => void
} {
  const [quickFilters, setQuickFilters] = useState<QuickFilter[]>(loadQuickFilters)

  const persist = useCallback((next: QuickFilter[]) => {
    setQuickFilters(next)
    saveQuickFilters(next)
  }, [])

  const createQuickFilter = useCallback(
    (name: string, snapshot: QuickFilterSnapshot): boolean => {
      const trimmed = name.trim()
      if (!trimmed) return false
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
