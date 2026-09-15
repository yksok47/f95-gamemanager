import { useMemo, useState, type JSX, type ReactNode } from 'react'
import ToolbarSearch from './ToolbarSearch'

const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']

type NamedTag = {
  id: number
  name: string
}

type TagBrowserProps<T extends NamedTag> = {
  tags: T[]
  query: string
  onQueryChange: (value: string) => void
  excludeIds?: Set<number>
  searchPlaceholder?: string
  renderTag: (tag: T) => ReactNode
}

export function tagInitial(name: string): string {
  const ch = name.trim().charAt(0).toUpperCase()
  return /[A-Z]/.test(ch) ? ch : '#'
}

export default function TagBrowser<T extends NamedTag>({
  tags,
  query,
  onQueryChange,
  excludeIds,
  searchPlaceholder = 'Search all tags',
  renderTag
}: TagBrowserProps<T>): JSX.Element {
  const [letter, setLetter] = useState('A')
  const searching = Boolean(query.trim())

  const letterCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const tag of tags) {
      if (excludeIds?.has(tag.id)) continue
      const key = tagInitial(tag.name)
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [tags, excludeIds])

  const visibleTags = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tags.filter((tag) => {
      if (excludeIds?.has(tag.id)) return false
      if (q) return tag.name.toLowerCase().includes(q)
      return tagInitial(tag.name) === letter
    })
  }, [tags, excludeIds, query, letter])

  return (
    <div className="tag-browser-wrap">
      <ToolbarSearch
        className="tag-search"
        value={query}
        onChange={onQueryChange}
        placeholder={searchPlaceholder}
      />
      <div className="tag-alpha" role="tablist" aria-label="Browse tags by letter">
        {LETTERS.map((item) => {
          const count = letterCounts.get(item) ?? 0
          const active = !searching && letter === item
          return (
            <button
              key={item}
              className={active ? 'tag-alpha-btn is-active' : 'tag-alpha-btn'}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={searching || count === 0}
              title={count ? `${count} tags` : 'No tags'}
              onClick={() => setLetter(item)}
            >
              {item}
            </button>
          )
        })}
      </div>
      <div className="tag-browser">
        {visibleTags.length ? (
          <div className="filter-chips">{visibleTags.map((tag) => renderTag(tag))}</div>
        ) : (
          <p className="muted filter-empty">
            {searching
              ? 'No tags match that search.'
              : 'No tags in this letter. Pick another, or search.'}
          </p>
        )}
      </div>
    </div>
  )
}
