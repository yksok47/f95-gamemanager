import { useEffect, useMemo, useState, type JSX } from 'react'
import type { AppSettings, CatalogTag, FavoriteTag, HatedTag } from '@shared/types'
import { P2P_ENV_DEFAULTS } from '@shared/p2p'
import { TAGS_PER_TIER_LIMIT, TAG_QUERY_LIMIT } from '@shared/types'
import HatedTagsEditor from '../components/HatedTagsEditor'
import RankedTagsEditor from '../components/RankedTagsEditor'
import Switch from '../components/Switch'

type SettingsTab = 'general' | 'p2p' | 'tags' | 'hated'

type SettingsPageProps = {
  settings: AppSettings
  onSaveSettings: (next: Partial<AppSettings>) => Promise<void>
}

type StatusTone = 'ok' | 'down' | 'idle'

function statusTone(ok: boolean | undefined, busy: boolean): StatusTone {
  if (busy || ok == null) return 'idle'
  return ok ? 'ok' : 'down'
}

function statusShortLabel(tone: StatusTone, busy: boolean): string {
  if (busy) return '…'
  if (tone === 'ok') return 'OK'
  if (tone === 'down') return 'ERROR'
  return '—'
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

function AddressStatusButton({
  tone,
  detail,
  busy,
  disabled,
  onRefresh
}: {
  tone: StatusTone
  detail?: string
  busy: boolean
  disabled?: boolean
  onRefresh: () => void
}): JSX.Element {
  const short = statusShortLabel(tone, busy)
  const label = busy ? 'Checking…' : detail || 'Refresh status'
  return (
    <button
      className={`address-status-btn address-status-${tone}`}
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled || busy}
      onClick={onRefresh}
    >
      <StatusIcon tone={tone} />
      <span className="address-status-label">{short}</span>
    </button>
  )
}

export default function SettingsPage({
  settings,
  onSaveSettings
}: SettingsPageProps): JSX.Element {
  const favoriteTags = settings.favoriteTags
  const hatedTags = settings.hatedTags ?? []
  const [tab, setTab] = useState<SettingsTab>('general')
  const [tags, setTags] = useState<CatalogTag[]>([])
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [userDataPath, setUserDataPath] = useState('')
  const [metadataDraft, setMetadataDraft] = useState(settings.metadataBaseUrl)
  const [webrtcDraft, setWebrtcDraft] = useState(settings.trackerWebRtcUrl)
  const [uploadLimitDraft, setUploadLimitDraft] = useState(String(settings.p2pUploadLimitKBps || ''))
  const [trackerStatus, setTrackerStatus] = useState<{ ok: boolean; message?: string } | null>(null)
  const [metadataStatus, setMetadataStatus] = useState<{ ok: boolean; message?: string } | null>(
    null
  )
  const [statusBusy, setStatusBusy] = useState(false)
  const [metadataStatusBusy, setMetadataStatusBusy] = useState(false)

  useEffect(() => {
    void window.api.settings.userDataPath().then(setUserDataPath).catch(() => undefined)
  }, [])

  useEffect(() => {
    setMetadataDraft(settings.metadataBaseUrl)
    setWebrtcDraft(settings.trackerWebRtcUrl)
    setUploadLimitDraft(settings.p2pUploadLimitKBps > 0 ? String(settings.p2pUploadLimitKBps) : '')
  }, [settings.metadataBaseUrl, settings.trackerWebRtcUrl, settings.p2pUploadLimitKBps])

  useEffect(() => {
    if (tab !== 'p2p') return
    void refreshP2pStatus()
  }, [tab, settings.p2pEnabled, settings.trackerWebRtcUrl])

  useEffect(() => {
    if (tab !== 'general') return
    void refreshMetadataStatus()
  }, [tab, settings.metadataApiEnabled, settings.metadataBaseUrl])


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

  const favoriteIds = useMemo(() => new Set(favoriteTags.map((tag) => tag.id)), [favoriteTags])
  const hatedIds = useMemo(() => new Set(hatedTags.map((tag) => tag.id)), [hatedTags])

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

  function saveFavorites(next: FavoriteTag[]): void {
    void persist({
      favoriteTags: next,
      hatedTags: hatedTags.filter((tag) => !next.some((item) => item.id === tag.id))
    })
  }

  function saveHated(next: HatedTag[]): void {
    void persist({
      hatedTags: next,
      favoriteTags: favoriteTags.filter((tag) => !next.some((item) => item.id === tag.id))
    })
  }

  async function chooseFolder(key: 'downloadsDir' | 'libraryDir'): Promise<void> {
    const folder = await window.api.settings.pickFolder(settings[key])
    if (!folder) return
    await persist({ [key]: folder })
  }

  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'general', label: 'General' },
    { id: 'p2p', label: 'P2P' },
    { id: 'tags', label: 'Favorite tags' },
    { id: 'hated', label: 'Hated tags' }
  ]

  async function refreshP2pStatus(): Promise<void> {
    setStatusBusy(true)
    try {
      const status = (await window.api.p2p.status()) as {
        tracker?: { ok: boolean; message?: string }
      }
      setTrackerStatus(status.tracker ?? { ok: false, message: 'no status' })
    } catch (err) {
      setTrackerStatus({
        ok: false,
        message: err instanceof Error ? err.message : 'status failed'
      })
    } finally {
      setStatusBusy(false)
    }
  }

  async function refreshMetadataStatus(): Promise<void> {
    setMetadataStatusBusy(true)
    try {
      const status = (await window.api.p2p.status()) as {
        metadata?: { ok: boolean; message?: string }
      }
      setMetadataStatus(status.metadata ?? { ok: false, message: 'no status' })
    } catch (err) {
      setMetadataStatus({
        ok: false,
        message: err instanceof Error ? err.message : 'status failed'
      })
    } finally {
      setMetadataStatusBusy(false)
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

            <Switch
              checked={settings.metadataApiEnabled !== false}
              disabled={saving}
              onChange={(checked) => void persist({ metadataApiEnabled: checked })}
              label="Enable metadata API"
            />
            <p className="muted download-meta">
              Catalog discovery, share-claims, and package flags. Off by choice still leaves P2P
              torrenting available when enabled separately.
            </p>

            <div className="folder-field">
              <span className="filter-label">Metadata base URL</span>
              <div className="folder-path-row">
                <div className="folder-path-with-status">
                  <input
                    className="folder-path"
                    value={metadataDraft}
                    disabled={saving || settings.metadataApiEnabled === false}
                    placeholder={P2P_ENV_DEFAULTS.METADATA_BASE_URL}
                    onChange={(event) => setMetadataDraft(event.target.value)}
                    onBlur={() => {
                      const next = metadataDraft.trim() || P2P_ENV_DEFAULTS.METADATA_BASE_URL
                      setMetadataDraft(next)
                      if (next !== settings.metadataBaseUrl) void persist({ metadataBaseUrl: next })
                    }}
                  />
                  <AddressStatusButton
                    tone={statusTone(metadataStatus?.ok, metadataStatusBusy)}
                    detail={metadataStatus?.message}
                    busy={metadataStatusBusy}
                    disabled={saving || settings.metadataApiEnabled === false}
                    onRefresh={() => void refreshMetadataStatus()}
                  />
                </div>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={saving || settings.metadataApiEnabled === false}
                  onClick={() => {
                    setMetadataDraft(P2P_ENV_DEFAULTS.METADATA_BASE_URL)
                    void persist({ metadataBaseUrl: P2P_ENV_DEFAULTS.METADATA_BASE_URL })
                  }}
                >
                  Reset
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
              <span className="filter-label">Upload speed limit</span>
              <p className="muted download-meta">
                Caps seeding so P2P does not fill your uplink. Leave empty for unlimited.
              </p>
              <div className="folder-path-row">
                <input
                  className="folder-path"
                  type="number"
                  min={0}
                  step={64}
                  inputMode="numeric"
                  value={uploadLimitDraft}
                  disabled={saving}
                  placeholder="Unlimited"
                  onChange={(event) => setUploadLimitDraft(event.target.value)}
                  onBlur={() => {
                    const parsed = Number(uploadLimitDraft)
                    const next = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0
                    setUploadLimitDraft(next > 0 ? String(next) : '')
                    if (next !== settings.p2pUploadLimitKBps) void persist({ p2pUploadLimitKBps: next })
                  }}
                />
                <span className="muted download-meta">KB/s</span>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={saving || settings.p2pUploadLimitKBps === 0}
                  onClick={() => {
                    setUploadLimitDraft('')
                    void persist({ p2pUploadLimitKBps: 0 })
                  }}
                >
                  Unlimited
                </button>
              </div>
            </div>

            <div className="folder-field">
              <span className="filter-label">Tracker URL</span>
              <p className="muted download-meta">
                WebSocket tracker for peer discovery and hole-punch. Archive bytes stay
                peer-to-peer.
              </p>
              <div className="folder-path-row">
                <div className="folder-path-with-status">
                  <input
                    className="folder-path"
                    value={webrtcDraft}
                    disabled={saving}
                    placeholder={P2P_ENV_DEFAULTS.TRACKER_WEBRTC_URL}
                    onChange={(event) => setWebrtcDraft(event.target.value)}
                    onBlur={() => {
                      const raw = webrtcDraft.trim()
                      const next =
                        raw.startsWith('ws://') || raw.startsWith('wss://')
                          ? raw
                          : P2P_ENV_DEFAULTS.TRACKER_WEBRTC_URL
                      setWebrtcDraft(next)
                      if (next !== settings.trackerWebRtcUrl) void persist({ trackerWebRtcUrl: next })
                    }}
                  />
                  <AddressStatusButton
                    tone={statusTone(trackerStatus?.ok, statusBusy)}
                    detail={trackerStatus?.message}
                    busy={statusBusy}
                    disabled={saving || !settings.p2pEnabled}
                    onRefresh={() => void refreshP2pStatus()}
                  />
                </div>
                <button
                  className="ghost-btn"
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setWebrtcDraft(P2P_ENV_DEFAULTS.TRACKER_WEBRTC_URL)
                    void persist({ trackerWebRtcUrl: P2P_ENV_DEFAULTS.TRACKER_WEBRTC_URL })
                  }}
                >
                  Reset
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {tab === 'tags' ? (
          <RankedTagsEditor
            selected={favoriteTags}
            catalogTags={tags}
            busy={busy}
            saving={saving}
            hint={`Click a group, then click tags to add them. ${TAGS_PER_TIER_LIMIT} tags per group. The catalog can only apply ${TAG_QUERY_LIMIT} includes at once, so the star keeps gold first, then silver.`}
            removeTitle="Remove from favorites"
            blockedIds={hatedIds}
            onChange={saveFavorites}
          />
        ) : null}

        {tab === 'hated' ? (
          <HatedTagsEditor
            selected={hatedTags}
            catalogTags={tags}
            busy={busy}
            saving={saving}
            blockedIds={favoriteIds}
            onChange={saveHated}
          />
        ) : null}

        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </div>
  )
}
