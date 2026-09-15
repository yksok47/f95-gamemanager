import { parseGameTitle } from './parse'
import { sanitizeCatalogQuery } from './sanitize-query'

/**
 * Catalog list filters run through Redis stopwords (e.g. "the") and a 30-char
 * clip. Skip attempts that would sanitize to nothing so we do not fetch the
 * unfiltered latest page and miss the thread.
 */
export function catalogLookupAttempts(
  title: string,
  creator?: string
): Array<{ search?: string; creator?: string }> {
  const parsed = parseGameTitle(title)
  const searchRaw = parsed.title.trim()
  const creatorRaw = (parsed.creator || creator || '').trim()
  const search = sanitizeCatalogQuery(searchRaw)
  const author = sanitizeCatalogQuery(creatorRaw)
  const attempts: Array<{ search?: string; creator?: string }> = []
  if (search && author) attempts.push({ search: searchRaw, creator: creatorRaw })
  if (search) attempts.push({ search: searchRaw })
  if (author) attempts.push({ creator: creatorRaw })
  return attempts
}
