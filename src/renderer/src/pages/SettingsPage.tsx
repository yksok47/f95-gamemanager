import { useEffect, useMemo, useState, type JSX } from 'react'
import type { AppSettings, CatalogTag, FavoriteTag, TagTier } from '@shared/types'
import { TAG_TIERS } from '@shared/types'
import { sortFavoriteTags } from '../lib/favorites'

type SettingsPageProps = {
  settings: AppSettings
  onSaveSettings: (next: Partial<AppSettings>) => Promise<void>
}

function tierLabel(tier: TagTier): string {
  return tier[0].toUpperCase() + tier.slice(1)
}

export default function SettingsPage({
  settings,
  onSaveSettings
}: SettingsPageProps): JSX.Element {
  const favoriteTags = settings.favoriteTags
  const [tags, setTags] = useState<CatalogTag[]>([])
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [addAs, setAddAs] = useState<TagTier>('gold')

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      setBusy(true)
      setError(null)
      try {
        const filters = await window.api.catalog.filters()
        if (!cancelled) setTags(filters.tags)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Could not load tags.')
        }
      } finally {
        if (!cancelled) setBusy(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const assignedIds = useMemo(() => new Set(favoriteTags.map((tag) => tag.id)), [favoriteTags])
  const grouped = useMemo(() => {
    const byTier: Record<TagTier, FavoriteTag[]> = { gold: [], silver: [], bronze: [] }
    for (const tag of sortFavoriteTags(favoriteTags)) {
      byTier[tag.tier].push(tag)
    }
    return byTier
  }, [favoriteTags])

  const visibleTags = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q
      ? tags.filter((tag) => tag.name.toLowerCase().includes(q))
      : tags.filter((tag) => !assignedIds.has(tag.id))
    return list.slice(0, 80)
  }, [assignedIds, query, tags])

  async function persist(next: Partial<AppSettings>): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      await onSaveSettings(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings.')
    } finally {
      setSaving(false)
    }
  }

  function assignTag(tag: CatalogTag, tier: TagTier): void {
    const next = favoriteTags.filter((item) => item.id !== tag.id)
    next.push({ id: tag.id, name: tag.name, tier })
    void persist({ favoriteTags: next })
  }

  function removeTag(id: number): void {
    void persist({ favoriteTags: favoriteTags.filter((tag) => tag.id !== id) })
  }

  async function chooseFolder(key: 'downloadsDir' | 'libraryDir'): Promise<void> {
    const folder = await window.api.settings.pickFolder(settings[key])
    if (!folder) return
    await persist({ [key]: folder })
  }

  return (
    <div className="settings-page">
      <section className="settings-card">
        <h1>Settings</h1>

        <h2 className="settings-heading">Folders</h2>
        <p className="muted settings-lead">
          Downloads always go to the downloads folder. Installed games will use the library folder.
        </p>

        <div className="folder-field">
          <span className="filter-label">Downloads</span>
          <div className="folder-path-row">
            <input className="folder-path" value={settings.downloadsDir} readOnly />
            <button className="ghost-btn" type="button" onClick={() => void chooseFolder('downloadsDir')}>
              Browse
            </button>
          </div>
        </div>
        <div className="folder-field">
          <span className="filter-label">Installed games</span>
          <div className="folder-path-row">
            <input className="folder-path" value={settings.libraryDir} readOnly />
            <button className="ghost-btn" type="button" onClick={() => void chooseFolder('libraryDir')}>
              Browse
            </button>
          </div>
        </div>

        <h2 className="settings-heading">P2P / torrenting</h2>
        <p className="muted settings-lead">
          Off by default. When enabled, this app seeds all local packages via WebTorrent in the
          main process and registers share claims with the metadata service. Discover shared
          packages on the P2P page (metadata catalog by hash/name — not F95 download links).
          Never sends F95 credentials. Swarm announce uses TRACKER_ANNOUNCE_URL (opentracker).
        </p>
        <label className="p2p-toggle-row">
          <input
            type="checkbox"
            checked={Boolean(settings.p2pEnabled)}
            disabled={saving}
            onChange={(event) => void persist({ p2pEnabled: event.target.checked })}
          />
          <span>Enable P2P seeding / downloads</span>
        </label>

        <h2 className="settings-heading">Favorite tags</h2>
        <p className="muted settings-lead">
          Pick favorite tags in three tiers. They appear on game tiles, stay colored in details, and
          sit at the top of catalog filters.
        </p>

        <div className="favorite-tiers">
          {TAG_TIERS.map((tier) => (
            <div key={tier} className={`favorite-tier favorite-tier-${tier}`}>
              <h2>{tierLabel(tier)}</h2>
              {grouped[tier].length ? (
                <div className="filter-chips">
                  {grouped[tier].map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      className={`chip chip-${tag.tier}`}
                      title="Remove from favorites"
                      onClick={() => removeTag(tag.id)}
                    >
                      {tag.name} ×
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">No {tier} tags yet.</p>
              )}
            </div>
          ))}
        </div>

        <div className="filter-row settings-add-row">
          <span className="filter-label">Add as</span>
          <select
            className={`toolbar-select rarity-select rarity-select-${addAs}`}
            value={addAs}
            onChange={(event) => setAddAs(event.target.value as TagTier)}
          >
            {TAG_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tierLabel(tier)}
              </option>
            ))}
          </select>
          <input
            className="tag-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a tag"
          />
          {saving ? <span className="muted">Saving…</span> : null}
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {busy ? <p className="muted">Loading tags…</p> : null}

        <div className="filter-chips tag-results">
          {visibleTags.map((tag) => {
            const current = favoriteTags.find((item) => item.id === tag.id)
            return (
              <button
                key={tag.id}
                type="button"
                className={current ? `chip chip-${current.tier}` : 'chip'}
                onClick={() => assignTag(tag, addAs)}
              >
                {tag.name}
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
