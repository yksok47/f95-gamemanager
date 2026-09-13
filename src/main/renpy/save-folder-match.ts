import { cleanThreadTitle } from '../f95/parse'

export function normalizeSaveKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/** Split a title into tokens used for Ren'Py-style save-folder acronyms. */
export function titleTokens(title: string): string[] {
  const cleaned = cleanThreadTitle(title) || title
  return cleaned
    .replace(/[_.:]+/g, ' ')
    .split(/[^a-zA-Z0-9]+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

/**
 * Build candidate acronyms from a game title.
 * "My Bimbo Dream: Kingpin" → mbdk
 * "My Bimbo Dream S2" → mbds2
 */
export function titleAcronyms(title: string): string[] {
  const tokens = titleTokens(title)
  if (!tokens.length) return []

  const letterOrDigit = (token: string): string => {
    if (/^\d+$/.test(token)) return token.toLowerCase()
    // Keep digit suffixes on tokens like "S2"
    const mixed = token.match(/^([A-Za-z]+)(\d+)$/)
    if (mixed) return `${mixed[1][0]}${mixed[2]}`.toLowerCase()
    return token[0].toLowerCase()
  }

  const acros = new Set<string>()
  const full = tokens.map(letterOrDigit).join('')
  if (full) acros.add(normalizeSaveKey(full))

  // Also try without leading "The"/"A"/"An" only — keep "My" (MBD* folders include it).
  const withoutArticles = tokens.filter((token) => !/^(the|a|an)$/i.test(token))
  if (withoutArticles.length !== tokens.length) {
    const next = withoutArticles.map(letterOrDigit).join('')
    if (next) acros.add(normalizeSaveKey(next))
  }

  return [...acros].filter((acro) => acro.length >= 2)
}

/** Leading letter/digit run before a timestamp suffix, e.g. MBDK-1749650324 → mbdk */
export function folderAcronymKey(folderName: string): string {
  const trimmed = folderName.trim()
  // Ren'Py often uses "ACRONYM-timestamp" with an 8+ digit suffix
  const stamped = trimmed.match(/^(.*)-(\d{8,})$/)
  if (stamped) return normalizeSaveKey(stamped[1])
  const key = normalizeSaveKey(folderName)
  return key.replace(/\d{8,}$/, '') || key
}

function acronymBoundaryMatch(folderKey: string, acro: string): boolean {
  if (!acro || acro.length < 2) return false
  if (!folderKey.startsWith(acro)) return false
  const rest = folderKey.slice(acro.length)
  return rest === '' || /^\d/.test(rest)
}

export function scoreSaveFolder(folderName: string, title: string): number {
  const needle = normalizeSaveKey(cleanThreadTitle(title) || title)
  if (needle.length < 3) return 0
  const key = normalizeSaveKey(folderName)
  if (!key) return 0

  let score = 0
  const folderAcro = folderAcronymKey(folderName)

  for (const acro of titleAcronyms(title)) {
    if (acro.length < 3) continue
    if (acronymBoundaryMatch(key, acro)) {
      // Classic Ren'Py pattern: ACRONYM-timestamp
      score = Math.max(score, 100 + acro.length * 2)
    } else if (folderAcro === acro) {
      score = Math.max(score, 90 + acro.length * 2)
    } else if (folderAcro.startsWith(acro) && acro.length >= 4) {
      score = Math.max(score, 50 + acro.length)
    }
  }

  const n = needle.slice(0, 16)
  const k = key.slice(0, 16)
  if (n.length >= 4 && (key.includes(n) || needle.includes(k))) {
    const overlap = Math.min(n.length, k.length)
    score = Math.max(score, 40 + overlap)
  }

  // Soft boost when folder acronym letters all appear in order in the title key
  if (folderAcro.length >= 3 && folderAcro.length <= 12) {
    let at = 0
    let hits = 0
    for (const ch of folderAcro) {
      const found = needle.indexOf(ch, at)
      if (found < 0) break
      hits += 1
      at = found + 1
    }
    if (hits === folderAcro.length) {
      score = Math.max(score, 35 + folderAcro.length)
    }
  }

  return score
}

/**
 * Pick the best Ren'Py save folder name for a title from candidate directory names.
 * Returns null when there is no clear winner.
 */
export function matchRenpySaveFolder(title: string, folderNames: string[]): string | null {
  if (!title.trim() || !folderNames.length) return null

  const scored = folderNames
    .map((name) => ({ name, score: scoreSaveFolder(name, title) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

  if (!scored.length) return null

  const best = scored[0]
  const tied = scored.filter((item) => item.score === best.score)
  if (tied.length === 1) return best.name

  // Prefer longer acronym-style names among ties (MBDK over MBD)
  tied.sort((a, b) => folderAcronymKey(b.name).length - folderAcronymKey(a.name).length)
  if (folderAcronymKey(tied[0].name).length > folderAcronymKey(tied[1].name).length) {
    return tied[0].name
  }

  return null
}
