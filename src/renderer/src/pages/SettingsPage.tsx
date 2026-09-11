import { useEffect, useMemo, useState, type JSX } from 'react'
import type { AppSettings, CatalogTag, FavoriteTag, TagTier } from '@shared/types'
import { P2P_ENV_DEFAULTS } from '@shared/p2p'
import { TAG_TIERS } from '@shared/types'
import { sortFavoriteTags } from '../lib/favorites'
import Switch from '../components/Switch'

type SettingsTab = 'general' | 'p2p' | 'tags'

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
  const [tab, setTab] = useState<SettingsTab>('general')
  const [tags, setTags] = useState<CatalogTag[]>([])
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [addAs, setAddAs] = useState<TagTier>('gold')
  const [announceDraft, setAnnounceDraft] = useState(settings.trackerAnnounceUrl)
  const [metadataDraft, setMetadataDraft] = useState(settings.metadataBaseUrl)
  const [serviceStatus, setServiceStatus] = useState<{
    metadata?: { ok: boolean; message?: string }
    tracker?: { ok: boolean; message?: string }
  } | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)

  useEffect(() => {
    setAnnounceDraft(settings.trackerAnnounceUrl)
    setMetadataDraft(settings.metadataBaseUrl)
  }, [settings.trackerAnnounceUrl, settings.metadataBaseUrl])

  useEffect(() => {
    if (tab !== 'p2p') return
    void refreshP2pStatus()
  }, [tab, settings.p2pEnabled, settings.trackerAnnounceUrl, settings.metadataBaseUrl])


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

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'p2p', label: 'P2P' },
    { id: 'tags', label: 'Favorite tags' }
  ]

  async function refreshP2pStatus(): Promise<void> {
    setStatusBusy(true)
    try {
      const status = (await window.api.p2p.status()) as {
        metadata?: { ok: boolean; message?: string }
        tracker?: { ok: boolean; message?: string }
      }
      setServiceStatus({ metadata: status.metadata, tracker: status.tracker })
    } catch (err) {
      setServiceStatus({
        metadata: { ok: false, message: err instanceof Error ? err.message : 'status failed' },
        tracker: { ok: false, message: err instanceof Error ? err.message : 'status failed' }
      })
    } finally {
      setStatusBusy(false)
    }
  }

  return (
    <div className="settings-page">
      <section className="settings-card">
        <h1>Settings</h1>

        <div className="details-tabs settings-tabs" role="tablist">
          {tabs.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'details-tab details-tab-active' : 'details-tab'}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'general' ? (
          <div className="settings-tab-body">
            <div className="folder-field">
              <span className="filter-label">Downloads</span>
              <div className="folder-path-row">
                <input className="folder-path" value={settings.downloadsDir} readOnly />
                <button
                  className="ghost-btn"
                  type="button"
                  onClick={() => void chooseFolder('downloadsDir')}
                >
                  Browse
                </button>
              </div>
            </div>
            <div className="folder-field">
              <span className="filter-label">Installed games</span>
              <div className="folder-path-row">
                <input className="folder-path" value={settings.libraryDir} readOnly />
                <button
                  className="ghost-btn"
                  type="button"
                  onClick={() => void chooseFolder('libraryDir')}
                >
                  Browse
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'p2p' ? (
          <div className="settings-tab-body">
            <div className="p2p-safety-banner" role="alert">
              <strong>Warning:</strong> P2P is inherently untrusted. Anyone can share archives —
              including malware. Treat every download as dangerous until you have reviewed the
              file yourself. Downloads land in an <code>untrusted</code> folder first; only Approve
              moves them into your library.
            </div>
            <Switch
              checked={Boolean(settings.p2pEnabled)}
              disabled={saving}
              onChange={(checked) => void persist({ p2pEnabled: checked })}
              label="Enable P2P"
            />

            <div className="folder-field">
              <span className="filter-label">Tracker announce URL</span>
              <div className="folder-path-row">
                <input
                  className="folder-path"
                  value={announceDraft}
                  disabled={saving}
                  placeholder={P2P_ENV_DEFAULTS.TRACKER_ANNOUNCE_URL}
                  onChange={(event) => setAnnounceDraft(event.target.value)}
                  onBlur={() => {
                    const next = announceDraft.trim() || P2P_ENV_DEFAULTS.TRACKER_ANNOUNCE_URL
                    setAnnounceDraft(next)
                    if (next !== settings.trackerAnnounceUrl) void persist({ trackerAnnounceUrl: next })
                  }}
                />
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setAnnounceDraft(P2P_ENV_DEFAULTS.TRACKER_ANNOUNCE_URL)
                    void persist({ trackerAnnounceUrl: P2P_ENV_DEFAULTS.TRACKER_ANNOUNCE_URL })
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
            <div className="folder-field">
              <span className="filter-label">Metadata base URL</span>
              <div className="folder-path-row">
                <input
                  className="folder-path"
                  value={metadataDraft}
                  disabled={saving}
                  placeholder={P2P_ENV_DEFAULTS.METADATA_BASE_URL}
                  onChange={(event) => setMetadataDraft(event.target.value)}
                  onBlur={() => {
                    const next = metadataDraft.trim() || P2P_ENV_DEFAULTS.METADATA_BASE_URL
                    setMetadataDraft(next)
                    if (next !== settings.metadataBaseUrl) void persist({ metadataBaseUrl: next })
                  }}
                />
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setMetadataDraft(P2P_ENV_DEFAULTS.METADATA_BASE_URL)
                    void persist({ metadataBaseUrl: P2P_ENV_DEFAULTS.METADATA_BASE_URL })
                  }}
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="folder-field">
              <span className="filter-label">Service status</span>
              <p className="muted download-meta">
                {[
                  `Metadata: ${serviceStatus?.metadata?.ok ? 'ok' : 'down'}${serviceStatus?.metadata?.message ? ` (${serviceStatus.metadata.message})` : ''}`,
                  `Tracker: ${serviceStatus?.tracker?.ok ? 'ok' : 'down'}${serviceStatus?.tracker?.message ? ` (${serviceStatus.tracker.message})` : ''}`
                ].join(' · ')}
              </p>
              <button
                className="ghost-btn"
                type="button"
                disabled={statusBusy || saving || !settings.p2pEnabled}
                onClick={() => void refreshP2pStatus()}
              >
                {statusBusy ? 'Checking…' : 'Refresh status'}
              </button>
            </div>
          </div>
        ) : null}

        {tab === 'tags' ? (
          <div className="settings-tab-body">
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
          </div>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </div>
  )
}
