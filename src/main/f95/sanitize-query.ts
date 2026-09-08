/** Redis default stopwords used by F95zone Latest Updates search. */
const REDIS_STOPWORDS = new Set([
  'a',
  'is',
  'the',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'if',
  'in',
  'into',
  'it',
  'no',
  'not',
  'of',
  'on',
  'or',
  'such',
  'that',
  'their',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'was',
  'will',
  'with'
])

const PUNCTUATION = "?&/':;-.+!~(),*"

/**
 * Mirror of F95checker's latest_updates_search_sanitize_query.
 * Latest Updates indexes titles in Redis, which ignores these words and
 * punctuation — sending them makes lookups like "The Big Step" miss.
 */
export function sanitizeCatalogQuery(raw: string): string {
  let query = raw.replace(/[’']s /g, ' ')
  query = query.replace(/[^\x00-\x7F]/g, '?')
  query = query.replace(/\.+ | \.+/g, ' ')
  for (const char of PUNCTUATION) {
    query = query.split(char).join(' ')
  }
  query = query.replace(/\s+/g, ' ').trim()
  const words = query.split(' ').filter((word) => word && !REDIS_STOPWORDS.has(word.toLowerCase()))

  let out = ''
  for (const word of words) {
    const append = `${out ? ' ' : ''}${word}`
    if (out.length + append.length > 30) {
      const clipped = append.slice(0, 30 - out.length)
      if (clipped.length > 3 && !REDIS_STOPWORDS.has(clipped.trim().toLowerCase())) {
        out += clipped
      }
      break
    }
    out += append
  }
  return out
}
