import { useEffect, useMemo, useState, type JSX } from 'react'
import type { AppSettings, CatalogTag, FavoriteTag, TagTier } from '@shared/types'
import { P2P_ENV_DEFAULTS } from '@shared/p2p'
import { TAG_TIERS } from '@shared/types'
import { sortFavoriteTags } from '../lib/favorites'
import Switch from '../components/Switch'
import TagBrowser from '../components/TagBrowser'

type SettingsTab = 'general' | 'p2p' | 'tags'

type SettingsPageProps = {
  settings: AppSettings
  onSaveSettings: (next: Partial<AppSettings>) => Promise<void>
}

function tierLabel(tier: TagTier): string {
  return tier[0].toUpperCase() + tier.slice(1)
}

type StatusTone = 'ok' | 'warn' | 'down' | 'idle'

function statusTone(ok: boolean | undefined, busy: boolean): StatusTone {
  if (busy || ok == null) return 'idle'
  return ok ? 'ok' : 'down'
}

function webrtcTone(
  webrtc: { ok?: boolean; holePunch?: boolean } | undefined,
  busy: boolean
): StatusTone {
  if (busy || !webrtc) return 'idle'
  if (webrtc.ok && webrtc.holePunch) return 'ok'
  if (webrtc.ok) return 'warn'
  return 'warn'
}

function webrtcDetail(webrtc: { ok?: boolean; message?: string; holePunch?: boolean } | undefined): string {
  if (!webrtc) return ''
  if (webrtc.ok && webrtc.holePunch) return webrtc.message || 'Hole-punch ready'
  if (webrtc.ok) return webrtc.message || 'Native · set a ws:// tracker to punch holes'
  return webrtc.message || 'Stub · TCP only'
}

function StatusIcon({ tone }: { tone: StatusTone }): JSX.Element {
  if (tone === 'ok') {
    return (
      <svg className="status-icon status-icon-ok" viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 1.4A6.6 6.6 0 1 1 1.4 8 6.6 6.6 0 0 1 8 1.4m-.1 8.8L5.2 7.5l1.1-1.1 1.6 1.6 3-3 1.1 1.1z"
        />
      </svg>
    )
  }
  if (tone === 'warn') {
    return (
      <svg className="status-icon status-icon-warn" viewBox="0 0 16 16" aria-hidden="true">
        <path fill="currentColor" d="M8 1.6 14.6 13H1.4zm0 3.6-.8 4.2h1.6zm0 5.6a.9.9 0 1 0 .9.9.9.9 0 0 0-.9-.9z" />
      </svg>
    )
  }
  if (tone === 'down') {
    return (
      <svg className="status-icon status-icon-down" viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M8 1.4A6.6 6.6 0 1 1 1.4 8 6.6 6.6 0 0 1 8 1.4m2.4 3.4L8 7.2 5.6 4.8 4.8 5.6 7.2 8l-2.4 2.4.8.8L8 8.8l2.4 2.4.8-.8L8.8 8l2.4-2.4z"
        />
      </svg>
    )
  }
  return (
    <svg className="status-icon status-icon-idle" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="5.2" fill="currentColor" />
    </svg>
  )
}

function ServiceStatusRow({
  label,
  tone,
  detail
}: {
  label: string
  tone: StatusTone
  detail?: string
}): JSX.Element {
  return (
    <li className={`service-status-row service-status-${tone}`}>
      <StatusIcon tone={tone} />
      <div>
        <strong>{label}</strong>
        {detail ? <p className="muted download-meta">{detail}</p> : null}
      </div>
    </li>
  )
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
  const [userDataPath, setUserDataPath] = useState('')
  const [announceDraft, setAnnounceDraft] = useState(settings.trackerAnnounceUrl)
  const [metadataDraft, setMetadataDraft] = useState(settings.metadataBaseUrl)
  const [webrtcDraft, setWebrtcDraft] = useState(settings.trackerWebRtcUrl)
  const [serviceStatus, setServiceStatus] = useState<{
    metadata?: { ok: boolean; message?: string }
    tracker?: { ok: boolean; message?: string }
    webrtc?: { ok: boolean; message?: string; holePunch?: boolean }
  } | null>(null)
  const [statusBusy, setStatusBusy] = useState(false)

  useEffect(() => {
    void window.api.settings.userDataPath().then(setUserDataPath).catch(() => undefined)
  }, [])

  useEffect(() => {
    setAnnounceDraft(settings.trackerAnnounceUrl)
    setMetadataDraft(settings.metadataBaseUrl)
    setWebrtcDraft(settings.trackerWebRtcUrl)
  }, [settings.trackerAnnounceUrl, settings.metadataBaseUrl, settings.trackerWebRtcUrl])

  useEffect(() => {
    if (tab !== 'p2p') return
    void refreshP2pStatus()
  }, [tab, settings.p2pEnabled, settings.trackerAnnounceUrl, settings.metadataBaseUrl, settings.trackerWebRtcUrl])


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

  const grouped = useMemo(() => {
    const byTier: Record<TagTier, FavoriteTag[]> = { gold: [], silver: [], bronze: [] }
    for (const tag of sortFavoriteTags(favoriteTags)) {
      byTier[tag.tier].push(tag)
    }
    return byTier
  }, [favoriteTags])

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
        webrtc?: { ok: boolean; message?: string; holePunch?: boolean }
      }
      setServiceStatus({ metadata: status.metadata, tracker: status.tracker, webrtc: status.webrtc })
    } catch (err) {
      setServiceStatus({
        metadata: { ok: false, message: err instanceof Error ? err.message : 'status failed' },
        tracker: { ok: false, message: err instanceof Error ? err.message : 'status failed' },
        webrtc: { ok: false, message: err instanceof Error ? err.message : 'status failed' }
      })
    } finally {
      setStatusBusy(false)
    }
  }

  return (
    <div className="settings-page">
      <section className="settings-card">
        <h1>Settings</h1>

        <div className="downloads-p2p-tabs" role="tablist">
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
            <div className="folder-field">
              <span className="filter-label">App data</span>
              <p className="muted download-meta">
                Follow list, settings, and P2P state for this install.
              </p>
              <div className="folder-path-row">
                <input className="folder-path" value={userDataPath} readOnly />
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={!userDataPath}
                  onClick={() => void window.api.settings.openUserData()}
                >
                  Open
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
              <span className="filter-label">WebRTC tracker URL (ws/wss — hole punching)</span>
              <p className="muted download-meta">
                HTTP opentracker cannot punch holes. Point this at a WebSocket tracker you run
                (SDP signaling). Leave empty for TCP-only.
              </p>
              <div className="folder-path-row">
                <input
                  className="folder-path"
                  value={webrtcDraft}
                  disabled={saving}
                  placeholder="ws://your-host:8000"
                  onChange={(event) => setWebrtcDraft(event.target.value)}
                  onBlur={() => {
                    const next = webrtcDraft.trim()
                    setWebrtcDraft(next)
                    if (next !== settings.trackerWebRtcUrl) void persist({ trackerWebRtcUrl: next })
                  }}
                />
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setWebrtcDraft('')
                    if (settings.trackerWebRtcUrl) void persist({ trackerWebRtcUrl: '' })
                  }}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="folder-field">
              <span className="filter-label">Service status</span>
              <ul className="service-status-list">
                <ServiceStatusRow
                  label="Metadata"
                  tone={statusTone(serviceStatus?.metadata?.ok, statusBusy)}
                  detail={serviceStatus?.metadata?.message}
                />
                <ServiceStatusRow
                  label="Tracker"
                  tone={statusTone(serviceStatus?.tracker?.ok, statusBusy)}
                  detail={serviceStatus?.tracker?.message}
                />
                <ServiceStatusRow
                  label="WebRTC"
                  tone={webrtcTone(serviceStatus?.webrtc, statusBusy)}
                  detail={webrtcDetail(serviceStatus?.webrtc)}
                />
              </ul>
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
            <p className="muted settings-tag-hint">
              Click a group to select it, then click tags below to add them.
              {saving ? ' Saving…' : ''}
            </p>
            <div className="favorite-tiers">
              {TAG_TIERS.map((tier) => (
                <div
                  key={tier}
                  className={`favorite-tier favorite-tier-${tier}${addAs === tier ? ' is-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={addAs === tier}
                  onClick={() => setAddAs(tier)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setAddAs(tier)
                    }
                  }}
                >
                  <h2>{tierLabel(tier)}</h2>
                  {grouped[tier].length ? (
                    <div className="filter-chips">
                      {grouped[tier].map((tag) => (
                        <button
                          key={tag.id}
                          type="button"
                          className={`chip chip-${tag.tier}`}
                          title="Remove from favorites"
                          onClick={(event) => {
                            event.stopPropagation()
                            removeTag(tag.id)
                          }}
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

            {busy ? <p className="muted">Loading tags…</p> : null}

            <TagBrowser
              tags={tags}
              query={query}
              onQueryChange={setQuery}
              renderTag={(tag) => {
                const current = favoriteTags.find((item) => item.id === tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    className={current ? `chip chip-${current.tier}` : 'chip'}
                    title={
                      current
                        ? `Move to ${tierLabel(addAs)}`
                        : `Add to ${tierLabel(addAs)}`
                    }
                    onClick={() => assignTag(tag, addAs)}
                  >
                    {tag.name}
                  </button>
                )
              }}
            />
          </div>
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </div>
  )
}
