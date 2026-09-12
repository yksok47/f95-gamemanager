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
  if (webrtc.ok) return webrtc.message || 'Native · set a ws:// tracker'
  return webrtc.message || 'Native WebRTC unavailable'
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
    setMetadataDraft(settings.metadataBaseUrl)
    setWebrtcDraft(settings.trackerWebRtcUrl)
    setUploadLimitDraft(settings.p2pUploadLimitKBps > 0 ? String(settings.p2pUploadLimitKBps) : '')
  }, [settings.metadataBaseUrl, settings.trackerWebRtcUrl, settings.p2pUploadLimitKBps])

  useEffect(() => {
    if (tab !== 'p2p') return
    void refreshP2pStatus()
  }, [tab, settings.p2pEnabled, settings.metadataBaseUrl, settings.trackerWebRtcUrl])


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
