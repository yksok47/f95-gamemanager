import { useEffect, useState } from 'react'
import type { CatalogPrefix } from '@shared/types'
import { decodeHtmlEntities } from '@shared/engines'
import { FALLBACK_PREFIXES } from '@shared/prefixes'

let cached: CatalogPrefix[] | null = null
let pending: Promise<CatalogPrefix[]> | null = null

function decodePrefixes(prefixes: CatalogPrefix[]): CatalogPrefix[] {
  return prefixes.map((prefix) => ({
    ...prefix,
    name: decodeHtmlEntities(prefix.name).trim()
  }))
}

async function loadPrefixes(): Promise<CatalogPrefix[]> {
  if (cached) return cached
  pending ??= window.api.catalog
    .filters()
    .then((filters) => {
      cached = decodePrefixes(filters.prefixes.length ? filters.prefixes : FALLBACK_PREFIXES)
      return cached
    })
    .catch(() => FALLBACK_PREFIXES)
  return pending
}

export function useCatalogPrefixes(): CatalogPrefix[] {
  const [prefixes, setPrefixes] = useState<CatalogPrefix[]>(cached ?? FALLBACK_PREFIXES)

  useEffect(() => {
    let cancelled = false
    void loadPrefixes().then((next) => {
      if (!cancelled) setPrefixes(next)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return prefixes
}
