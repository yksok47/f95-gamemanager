import { useEffect, useMemo, useState, type JSX } from 'react'
import type { AppSettings, CatalogTag, FavoriteTag, HatedTag } from '@shared/types'
import { CATALOG_PAGE_SIZES } from '@shared/types'
import { TAGS_PER_TIER_LIMIT, TAG_QUERY_LIMIT } from '@shared/types'
import HatedTagsEditor from '../components/HatedTagsEditor'
import IgnoredThreadsPanel from '../components/IgnoredThreadsPanel'
import RankedTagsEditor from '../components/RankedTagsEditor'
import AppUpdatePanel from '../components/AppUpdatePanel'
import { notifyCaught } from '../components/ErrorNotifications'
import Switch from '../components/Switch'
import { useAppUpdate } from '../lib/app-update'

type SettingsTab = 'general' | 'p2p' | 'tags' | 'hated' | 'ignored'

type SettingsPageProps = {
  settings: AppSettings
  onSaveSettings: (next: Partial<AppSettings>) => Promise<void>
  onOpenThread: (threadId: number, title: string) => void
  onIgnoredChange?: (threadId: number, ignored: boolean) => void
}

export default function SettingsPage({
  settings,
  onSaveSettings,
  onOpenThread,
  onIgnoredChange
}: SettingsPageProps): JSX.Element {
  const favoriteTags = settings.favoriteTags
  const hatedTags = settings.hatedTags ?? []
  const [tab, setTab] = useState<SettingsTab>('general')
  const [tags, setTags] = useState<CatalogTag[]>([])
  const [busy, setBusy] = useState(true)
  const [saving, setSaving] = useState(false)
  const [userDataPath, setUserDataPath] = useState('')
  const [uploadLimitDraft, setUploadLimitDraft] = useState(String(settings.p2pUploadLimitKBps || ''))
  const [catalogPageSizeDraft, setCatalogPageSizeDraft] = useState(settings.catalogPageSize)
  const appUpdate = useAppUpdate()

  useEffect(() => {
    void window.api.settings.userDataPath().then(setUserDataPath).catch(() => undefined)
  }, [])

  useEffect(() => {
    setUploadLimitDraft(settings.p2pUploadLimitKBps > 0 ? String(settings.p2pUploadLimitKBps) : '')
  }, [settings.p2pUploadLimitKBps])

  useEffect(() => {
    setCatalogPageSizeDraft(settings.catalogPageSize)
  }, [settings.catalogPageSize])


  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      setBusy(true)
      try {
        const filters = await window.api.catalog.filters()
        if (!cancelled) setTags(filters.tags)
      } catch (err) {
        if (!cancelled) notifyCaught(err, 'Could not load tags.')
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
    try {
      await onSaveSettings(next)
    } catch (err) {
      notifyCaught(err, 'Could not save settings.')
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
    { id: 'hated', label: 'Hated tags' },
    { id: 'ignored', label: 'Ignored' }
  ]

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
            <AppUpdatePanel status={appUpdate} />
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
              <div className="settings-slider-head">
                <span className="filter-label" id="catalog-page-size-label">
                  Catalog page size
                </span>
                <span className="settings-slider-value" aria-live="polite">
                  {catalogPageSizeDraft}
                </span>
              </div>
              <p className="muted download-meta">
                How many titles to load at once when browsing the catalog.
              </p>
              <div className="settings-slider-control">
                <input
                  className="settings-slider"
                  type="range"
                  min={0}
                  max={CATALOG_PAGE_SIZES.length - 1}
                  step={1}
                  value={Math.max(0, CATALOG_PAGE_SIZES.indexOf(catalogPageSizeDraft))}
                  disabled={saving}
                  aria-labelledby="catalog-page-size-label"
                  aria-valuemin={CATALOG_PAGE_SIZES[0]}
                  aria-valuemax={CATALOG_PAGE_SIZES[CATALOG_PAGE_SIZES.length - 1]}
                  aria-valuenow={catalogPageSizeDraft}
                  aria-valuetext={`${catalogPageSizeDraft} titles`}
                  onChange={(event) => {
                    const next = CATALOG_PAGE_SIZES[Number(event.target.value)]
                    if (next) setCatalogPageSizeDraft(next)
                  }}
                  onPointerUp={(event) => {
                    const next = CATALOG_PAGE_SIZES[Number(event.currentTarget.value)]
                    if (next && next !== settings.catalogPageSize) {
                      void persist({ catalogPageSize: next })
                    }
                  }}
                  onKeyUp={(event) => {
                    const next = CATALOG_PAGE_SIZES[Number(event.currentTarget.value)]
                    if (next && next !== settings.catalogPageSize) {
                      void persist({ catalogPageSize: next })
                    }
                  }}
                />
                <div className="settings-slider-scale" aria-hidden="true">
                  {CATALOG_PAGE_SIZES.map((size) => (
                    <span
                      key={size}
                      className={
                        size === catalogPageSizeDraft
                          ? 'settings-slider-mark is-active'
                          : 'settings-slider-mark'
                      }
                    >
                      {size}
                    </span>
                  ))}
                </div>
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

        {tab === 'ignored' ? (
          <IgnoredThreadsPanel onOpenThread={onOpenThread} onIgnoredChange={onIgnoredChange} />
        ) : null}
      </section>
    </div>
  )
}
