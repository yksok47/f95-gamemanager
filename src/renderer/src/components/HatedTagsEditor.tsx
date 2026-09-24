import { useMemo, useState, type JSX } from 'react'
import { TAG_QUERY_LIMIT, type CatalogTag, type HatedTag } from '@shared/types'
import TagBrowser from './TagBrowser'
import { notifyError } from './ErrorNotifications'
import { InlineLoading } from './Spinner'

type HatedTagsEditorProps = {
  selected: HatedTag[]
  catalogTags: CatalogTag[]
  busy: boolean
  saving: boolean
  blockedIds?: Set<number>
  onChange: (next: HatedTag[]) => void
}

export default function HatedTagsEditor({
  selected,
  catalogTags,
  busy,
  saving,
  blockedIds,
  onChange
}: HatedTagsEditorProps): JSX.Element {
  const [query, setQuery] = useState('')
  const sorted = useMemo(
    () => [...selected].sort((a, b) => a.name.localeCompare(b.name)),
    [selected]
  )

  function toggleTag(tag: CatalogTag): void {
    if (selected.some((item) => item.id === tag.id)) {
      onChange(selected.filter((item) => item.id !== tag.id))
      return
    }
    if (selected.length >= TAG_QUERY_LIMIT) {
      notifyError(`You can only hate ${TAG_QUERY_LIMIT} tags.`)
      return
    }
    onChange([...selected, { id: tag.id, name: tag.name }])
  }

  return (
    <div className="settings-tab-body">
      <p className="muted settings-tag-hint">
        Click tags to hide games that have them. {sorted.length}/{TAG_QUERY_LIMIT}.
        {saving ? ' Saving…' : ''}
      </p>
      <div className="favorite-tier favorite-tier-hate is-selected hated-tags-panel">
        <div className="favorite-tier-head">
          <h2>Hated</h2>
          <span className="muted">
            {sorted.length}/{TAG_QUERY_LIMIT}
          </span>
        </div>
        {sorted.length ? (
          <div className="filter-chips">
            {sorted.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className="chip chip-hate"
                title="Remove from hated tags"
                onClick={() => toggleTag(tag)}
              >
                {tag.name} ×
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">No hated tags yet.</p>
        )}
      </div>

      {busy ? <InlineLoading label="Loading tags" /> : null}

      <TagBrowser
        tags={catalogTags}
        query={query}
        onQueryChange={setQuery}
        renderTag={(tag) => {
          const current = selected.some((item) => item.id === tag.id)
          const blocked = !current && blockedIds?.has(tag.id)
          return (
            <button
              key={tag.id}
              type="button"
              className={current ? 'chip chip-hate' : 'chip'}
              title={
                blocked
                  ? 'Move from favorites to hated'
                  : current
                    ? 'Remove from hated tags'
                    : 'Add to hated tags'
              }
              onClick={() => toggleTag(tag)}
            >
              {tag.name}
            </button>
          )
        }}
      />
    </div>
  )
}
