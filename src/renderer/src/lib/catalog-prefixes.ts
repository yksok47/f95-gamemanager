import { useEffect, useState } from 'react'
import type { CatalogPrefix, CatalogTag } from '@shared/types'
import { decodeHtmlEntities } from '@shared/engines'
import { FALLBACK_PREFIXES } from '@shared/prefixes'

let cachedPrefixes: CatalogPrefix[] | null = null
let cachedTags: CatalogTag[] | null = null
let pending: Promise<{ prefixes: CatalogPrefix[]; tags: CatalogTag[] }> | null = null

function decodePrefixes(prefixes: CatalogPrefix[]): CatalogPrefix[] {
  return prefixes.map((prefix) => ({
    ...prefix,
    name: decodeHtmlEntities(prefix.name).trim()
  }))
}

function decodeTags(tags: CatalogTag[]): CatalogTag[] {
  return tags.map((tag) => ({
    ...tag,
    name: decodeHtmlEntities(tag.name).trim()
  }))
}

async function loadFilters(): Promise<{ prefixes: CatalogPrefix[]; tags: CatalogTag[] }> {
  if (cachedPrefixes && cachedTags) return { prefixes: cachedPrefixes, tags: cachedTags }
  pending ??= window.api.catalog
    .filters()
    .then((filters) => {
      cachedPrefixes = decodePrefixes(filters.prefixes.length ? filters.prefixes : FALLBACK_PREFIXES)
      cachedTags = decodeTags(filters.tags)
      return { prefixes: cachedPrefixes, tags: cachedTags }
    })
    .catch(() => ({
      prefixes: FALLBACK_PREFIXES,
      tags: cachedTags ?? []
    }))
  return pending
}

export function useCatalogPrefixes(): CatalogPrefix[] {
  const [prefixes, setPrefixes] = useState<CatalogPrefix[]>(cachedPrefixes ?? FALLBACK_PREFIXES)

  useEffect(() => {
    let cancelled = false
    void loadFilters().then((next) => {
      if (!cancelled) setPrefixes(next.prefixes)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return prefixes
}

export function useCatalogTags(): CatalogTag[] {
  const [tags, setTags] = useState<CatalogTag[]>(cachedTags ?? [])

  useEffect(() => {
    let cancelled = false
    void loadFilters().then((next) => {
      if (!cancelled) setTags(next.tags)
    })
    return () => {
      cancelled = true
    }
  }, [])

  return tags
}
