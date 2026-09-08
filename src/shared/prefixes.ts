import type { CatalogPrefix } from './types'
import { decodeHtmlEntities, normalizeEngine } from './engines'

type PrefixNode = {
  id?: unknown
  name?: unknown
  prefixes?: unknown
}

function groupForPrefixName(name: string): CatalogPrefix['group'] {
  const n = name.toLowerCase()
  if (
    /\b(wip|ongoing|completed?|complete|abandoned|on[\s-]?hold|cancelled)\b/.test(n)
  ) {
    return 'status'
  }
  if (
    /\b(ren['’]?py|rpgm|rpg maker|unity|unreal|godot|html|java|webgl|wolf|adrift|flash|qsp|rags|tads|vn|visual novel|tyrano|twine|kirikiri|nscripter|clickteam|construct|gamemaker|ags)\b/.test(
      n
    )
  ) {
    return 'engine'
  }
  return 'other'
}

function groupKindFromName(name: string): CatalogPrefix['group'] | null {
  const n = name.toLowerCase().trim()
  if (n === 'engine' || n === 'engines' || n === 'type' || n === 'types') return 'engine'
  if (n === 'status' || n === 'statuses') return 'status'
  if (n === 'other' || n === 'others') return 'other'
  return null
}

export function classifyPrefix(
  id: number,
  name: string,
  group?: CatalogPrefix['group']
): CatalogPrefix {
  const decoded = decodeHtmlEntities(name).trim()
  return { id, name: decoded, group: group ?? groupForPrefixName(decoded) }
}

/**
 * SAM latest_alpha filter IDs (not XenForo thread prefixes).
 * Used when /sam/latest_alpha/ cannot be parsed.
 */
export const FALLBACK_PREFIXES: CatalogPrefix[] = [
  { id: 13, name: 'Ongoing', group: 'status' },
  { id: 18, name: 'Completed', group: 'status' },
  { id: 3, name: 'Abandoned', group: 'status' },
  { id: 7, name: "Ren'Py", group: 'engine' },
  { id: 4, name: 'HTML', group: 'engine' },
  { id: 31, name: 'Godot', group: 'engine' },
  { id: 19, name: 'Collection', group: 'other' }
]

const SKIP_ENGINE_LABELS = /^(vn|visual novels?)$/i
const ENGINE_NAME_RE =
  /ren['’]?py|rpgm|rpg maker|unity|unreal|godot|html|java|webgl|wolf|adrift|flash|qsp|rags|tads|tyrano|twine|kirikiri|nscripter|clickteam|construct|gamemaker|ags|vn|visual novel/i

function prefixLooksLikeEngine(prefix: CatalogPrefix): boolean {
  if (prefix.group === 'status') return false
  if (prefix.group === 'engine') return true
  return ENGINE_NAME_RE.test(prefix.name)
}

function flattenPrefixGroups(groups: unknown[]): CatalogPrefix[] {
  const out: CatalogPrefix[] = []
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue
    const node = group as PrefixNode
    const groupKind = groupKindFromName(String(node.name ?? ''))
    const items = Array.isArray(node.prefixes) ? node.prefixes : []
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const row = item as PrefixNode
      const id = Number(row.id)
      const name = String(row.name ?? '').trim()
      if (!Number.isFinite(id) || id <= 0 || !name) continue
      out.push(classifyPrefix(id, name, groupKind ?? undefined))
    }
  }
  return out
}

export function prefixesFromUnknown(value: unknown): CatalogPrefix[] {
  if (value == null) return []

  if (Array.isArray(value)) {
    const looksLikeGroups = value.some(
      (item) => item && typeof item === 'object' && Array.isArray((item as PrefixNode).prefixes)
    )
    if (looksLikeGroups) return flattenPrefixGroups(value)
    return value
      .map((item) => {
        if (item && typeof item === 'object' && 'id' in item && 'name' in item) {
          const row = item as PrefixNode
          return classifyPrefix(Number(row.id), String(row.name ?? ''))
        }
        return null
      })
      .filter((item): item is CatalogPrefix => item !== null && Number.isFinite(item.id) && item.id > 0)
  }

  if (typeof value === 'object') {
    const root = value as Record<string, unknown>
    if (Array.isArray(root.games)) {
      const grouped = flattenPrefixGroups(root.games)
      if (grouped.length) return grouped
    }
    const out: CatalogPrefix[] = []
    for (const [key, entry] of Object.entries(root)) {
      const id = Number(key)
      if (!Number.isFinite(id) || id <= 0) continue
      if (typeof entry === 'string' && entry.trim()) {
        out.push(classifyPrefix(id, entry.trim()))
      } else if (entry && typeof entry === 'object' && 'name' in entry) {
        const name = String((entry as { name: unknown }).name ?? '').trim()
        if (name) out.push(classifyPrefix(id, name))
      }
    }
    return out
  }

  return []
}

export function engineFromPrefixIds(
  ids: number[] | undefined,
  catalog: CatalogPrefix[] = FALLBACK_PREFIXES
): string {
  if (!ids?.length) return ''
  const byId = new Map<number, CatalogPrefix>()
  for (const prefix of FALLBACK_PREFIXES) byId.set(prefix.id, prefix)
  for (const prefix of catalog) byId.set(prefix.id, prefix)

  const preferred: string[] = []
  const fallback: string[] = []
  for (const id of ids) {
    const prefix = byId.get(id)
    if (!prefix || !prefixLooksLikeEngine(prefix)) continue
    const name = normalizeEngine(prefix.name)
    if (!name) continue
    if (SKIP_ENGINE_LABELS.test(prefix.name) || name === 'VN') fallback.push(name)
    else preferred.push(name)
  }
  return preferred[0] || fallback[0] || ''
}
