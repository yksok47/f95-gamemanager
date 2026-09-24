import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import type {
  AppSettings,
  CatalogTag,
  CloudSaveAccount,
  CloudSaveGameSummary,
  CloudSaveKeepCount,
  CloudSaveSyncStatus,
  CloudUserDataSyncStatus,
  FavoriteTag,
  HatedTag
} from '@shared/types'
import { CATALOG_PAGE_SIZES, CLOUD_SAVE_KEEP_COUNTS } from '@shared/types'
import { TAGS_PER_TIER_LIMIT, TAG_QUERY_LIMIT } from '@shared/types'
import { formatDateTime } from '@shared/updates'
import HatedTagsEditor from '../components/HatedTagsEditor'
import IgnoredThreadsPanel from '../components/IgnoredThreadsPanel'
import RankedTagsEditor from '../components/RankedTagsEditor'
import AppUpdatePanel from '../components/AppUpdatePanel'
import { confirm } from '../components/ConfirmDialog'
import { notifyCaught } from '../components/ErrorNotifications'
import Switch from '../components/Switch'
import { formatBytes } from '../lib/downloads'
import { useAppUpdate } from '../lib/app-update'

type SettingsTab = 'general' | 'directories' | 'p2p' | 'cloud' | 'tags' | 'hated' | 'ignored'

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
    { id: 'directories', label: 'Directories' },
    { id: 'p2p', label: 'P2P' },
    { id: 'cloud', label: 'Cloud' },
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

        {tab === 'directories' ? (
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
            <h2 className="settings-heading">External libraries</h2>
            <p className="muted settings-lead">
              Additional folders of archives or installed games. They are not used as the
              destination for new downloads or installs. Import from Storage also scans Downloads
              and Installed games above for unidentified files.
            </p>
            <ExternalLibrariesField
              title="Archive libraries"
              hint="Extra folders of zip / 7z / rar files. Import from Storage also covers Downloads above — new downloads still go there."
              dirs={settings.extraArchiveDirs ?? []}
              disabled={saving}
              onAdd={async () => {
                const folder = await window.api.settings.pickFolder(
                  settings.extraArchiveDirs?.[0] || settings.downloadsDir
                )
                if (!folder) return
                if (folder === settings.downloadsDir) return
                if ((settings.extraArchiveDirs ?? []).includes(folder)) return
                await persist({ extraArchiveDirs: [...(settings.extraArchiveDirs ?? []), folder] })
              }}
              onRemove={(dir) =>
                void persist({
                  extraArchiveDirs: (settings.extraArchiveDirs ?? []).filter((item) => item !== dir)
                })
              }
            />
            <ExternalLibrariesField
              title="Installed game libraries"
              hint="Extra folders of already extracted games. Import from Storage also covers Installed games above — new installs still go there."
              dirs={settings.extraLibraryDirs ?? []}
              disabled={saving}
              onAdd={async () => {
                const folder = await window.api.settings.pickFolder(
                  settings.extraLibraryDirs?.[0] || settings.libraryDir
                )
                if (!folder) return
                if (folder === settings.libraryDir) return
                if ((settings.extraLibraryDirs ?? []).includes(folder)) return
                await persist({ extraLibraryDirs: [...(settings.extraLibraryDirs ?? []), folder] })
              }}
              onRemove={(dir) =>
                void persist({
                  extraLibraryDirs: (settings.extraLibraryDirs ?? []).filter((item) => item !== dir)
                })
              }
            />
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
          </div>
        ) : null}

        {tab === 'cloud' ? (
          <CloudSavesPanel
            settings={settings}
            saving={saving}
            persist={persist}
            onOpenThread={onOpenThread}
          />
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

function ExternalLibrariesField({
  title,
  hint,
  dirs,
  disabled,
  onAdd,
  onRemove
}: {
  title: string
  hint: string
  dirs: string[]
  disabled: boolean
  onAdd: () => Promise<void>
  onRemove: (dir: string) => void
}): JSX.Element {
  return (
    <div className="folder-field">
      <span className="filter-label">{title}</span>
      <p className="muted download-meta">{hint}</p>
      {dirs.length ? (
        <ul className="external-library-list">
          {dirs.map((dir) => (
            <li key={dir} className="folder-path-row">
              <input className="folder-path" value={dir} readOnly />
              <button
                className="ghost-btn"
                type="button"
                disabled={disabled}
                onClick={() => onRemove(dir)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted download-meta">None added yet.</p>
      )}
      <button className="ghost-btn" type="button" disabled={disabled} onClick={() => void onAdd()}>
        Add folder
      </button>
    </div>
  )
}

function keepCountLabel(count: CloudSaveKeepCount): string {
  return count === 0 ? 'Unlimited' : String(count)
}

function UserDataSyncPanel({
  enabled,
  signedIn,
  saving,
  persist
}: {
  enabled: boolean
  signedIn: boolean
  saving: boolean
  persist: (next: Partial<AppSettings>) => Promise<void>
}): JSX.Element {
  const [sync, setSync] = useState<CloudUserDataSyncStatus | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void window.api.cloudUserData.status().then((next) => {
      if (!cancelled) setSync(next)
    })
    const stop = window.api.cloudUserData.onStatus((next) => {
      if (!cancelled) setSync(next)
    })
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  async function syncNow(): Promise<void> {
    setBusy(true)
    try {
      setSync(await window.api.cloudUserData.sync())
    } catch (err) {
      notifyCaught(err, 'Could not sync user data.')
    } finally {
      setBusy(false)
    }
  }

  const running = Boolean(sync?.running)
  const canSync = enabled && signedIn && !saving && !running && !busy

  return (
    <>
      <Switch
        checked={enabled}
        disabled={saving}
        onChange={(checked) => void persist({ cloudUserDataEnabled: checked })}
        label="Enable Google Drive user data sync"
      />
      <p className="muted download-meta">
        Optional. When on and signed in, followed games, ratings, notes, playtime, and preferences
        sync through this app’s hidden Drive folder. Library folders, installs, and archives stay on
        this PC. Settings upload right away; playtime uploads about once a minute.
      </p>
      <div className="folder-field">
        <span className="filter-label">User data</span>
        <div className="folder-path-row">
          <button className="ghost-btn" type="button" disabled={!canSync} onClick={() => void syncNow()}>
            {running || busy ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
        {sync?.lastRunAt && !running ? (
          <p className="muted download-meta">
            {sync.lastError
              ? `Last sync failed. ${sync.lastError}`
              : sync.pending
                ? 'Changes are waiting to upload.'
                : `Last synced${sync.lastRevision ? ` (revision ${sync.lastRevision})` : ''}.`}
          </p>
        ) : running ? (
          <p className="muted download-meta">Syncing user data…</p>
        ) : !signedIn ? (
          <p className="muted download-meta">Sign in with Google above to use user data sync.</p>
        ) : null}
      </div>
    </>
  )
}

function CloudSavesPanel({
  settings,
  saving,
  persist,
  onOpenThread
}: {
  settings: AppSettings
  saving: boolean
  persist: (next: Partial<AppSettings>) => Promise<void>
  onOpenThread: (threadId: number, title: string) => void
}): JSX.Element {
  const enabled = Boolean(settings.cloudSavesEnabled)
  const [account, setAccount] = useState<CloudSaveAccount>({ signedIn: false, email: null })
  const [sync, setSync] = useState<CloudSaveSyncStatus | null>(null)
  const [authBusy, setAuthBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [games, setGames] = useState<CloudSaveGameSummary[] | null>(null)
  const [inventoryBusy, setInventoryBusy] = useState(false)
  const [inventoryOpen, setInventoryOpen] = useState(false)
  const [actingId, setActingId] = useState<number | 'all' | null>(null)
  const [filter, setFilter] = useState('')
  const inventoryOpenRef = useRef(false)
  inventoryOpenRef.current = inventoryOpen

  async function loadInventory(): Promise<void> {
    setInventoryBusy(true)
    try {
      setGames(await window.api.cloudSaves.inventory())
    } catch (err) {
      notifyCaught(err, 'Could not list cloud saves.')
      setGames([])
    } finally {
      setInventoryBusy(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    void window.api.cloudSaves.account().then((next) => {
      if (!cancelled) setAccount(next)
    })
    void window.api.cloudSaves.status().then((next) => {
      if (!cancelled) setSync(next)
    })
    const stopAccount = window.api.cloudSaves.onAccount((next) => setAccount(next))
    const stopStatus = window.api.cloudSaves.onStatus((next) => setSync(next))
    const stopInventory = window.api.cloudSaves.onInventory(() => {
      if (!cancelled && inventoryOpenRef.current) void loadInventory()
    })
    return () => {
      cancelled = true
      stopAccount()
      stopStatus()
      stopInventory()
    }
  }, [])

  const syncing = Boolean(sync?.running && sync.phase === 'syncing')
  const signingIn = Boolean(sync?.phase === 'signing-in' || authBusy)
  const canSync = enabled && account.signedIn && !saving && !syncing && !signingIn
  const wasSyncing = useRef(false)
  if (syncing) wasSyncing.current = true

  useEffect(() => {
    if (!account.signedIn) {
      setGames(null)
      return
    }
    if (inventoryOpen) void loadInventory()
  }, [account.signedIn, inventoryOpen])

  useEffect(() => {
    if (syncing) return
    if (wasSyncing.current && account.signedIn && inventoryOpen) {
      wasSyncing.current = false
      void loadInventory()
    }
  }, [syncing, account.signedIn, inventoryOpen, sync?.lastRunAt])

  async function signIn(openBrowser = true): Promise<void> {
    setAuthBusy(true)
    setCopied(false)
    try {
      setAccount(await window.api.cloudSaves.signIn(openBrowser))
    } catch (err) {
      notifyCaught(err, 'Could not sign in to Google Drive.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function waitForSignInUrl(): Promise<string> {
    for (let i = 0; i < 50; i++) {
      const next = await window.api.cloudSaves.status()
      if (next.signInUrl) return next.signInUrl
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('The sign-in link was not ready yet.')
  }

  async function copySignInLink(): Promise<void> {
    try {
      let url = sync?.signInUrl
      if (!url) {
        void signIn(false)
        url = await waitForSignInUrl()
      }
      try {
        await navigator.clipboard.writeText(url)
      } catch {
        const input = document.createElement('textarea')
        input.value = url
        document.body.appendChild(input)
        input.select()
        document.execCommand('copy')
        input.remove()
      }
      setCopied(true)
    } catch (err) {
      notifyCaught(err, 'Could not copy the Google sign-in link.')
    }
  }

  async function signOut(): Promise<void> {
    setAuthBusy(true)
    try {
      setAccount(await window.api.cloudSaves.signOut())
      setGames(null)
    } catch (err) {
      notifyCaught(err, 'Could not sign out of Google Drive.')
    } finally {
      setAuthBusy(false)
    }
  }

  async function syncAll(): Promise<void> {
    try {
      setSync(await window.api.cloudSaves.syncAll())
    } catch (err) {
      notifyCaught(err, 'Could not sync cloud saves.')
    }
  }

  async function stopSync(): Promise<void> {
    try {
      setSync(await window.api.cloudSaves.cancel())
    } catch (err) {
      notifyCaught(err, 'Could not stop cloud sync.')
    }
  }

  async function resyncGame(threadId: number): Promise<void> {
    setActingId(threadId)
    try {
      setSync(await window.api.cloudSaves.syncThread(threadId))
      await loadInventory()
    } catch (err) {
      notifyCaught(err, 'Could not resync that game.')
    } finally {
      setActingId(null)
    }
  }

  async function removeGame(game: CloudSaveGameSummary): Promise<void> {
    if (
      !(await confirm({
        title: 'Remove cloud saves',
        message: `Delete ${game.saveCount} cloud ${game.saveCount === 1 ? 'save' : 'saves'} for ${game.title} from Google Drive? Local files stay on disk.`,
        confirmLabel: 'Remove from cloud',
        danger: true
      }))
    ) {
      return
    }
    setActingId(game.threadId)
    try {
      await window.api.cloudSaves.deleteGame(game.threadId)
      await loadInventory()
    } catch (err) {
      notifyCaught(err, 'Could not remove those cloud saves.')
    } finally {
      setActingId(null)
    }
  }

  async function removeAll(): Promise<void> {
    if (
      !(await confirm({
        title: 'Remove all cloud saves',
        message: 'Delete every game’s saves from Google Drive? Local files stay on disk. This cannot be undone.',
        confirmLabel: 'Remove all',
        danger: true
      }))
    ) {
      return
    }
    setActingId('all')
    try {
      await window.api.cloudSaves.deleteAll()
      await loadInventory()
    } catch (err) {
      notifyCaught(err, 'Could not remove cloud saves.')
    } finally {
      setActingId(null)
    }
  }

  const query = filter.trim().toLowerCase()
  const visibleGames = (games ?? []).filter((game) => {
    if (!query) return true
    return game.title.toLowerCase().includes(query) || String(game.threadId).includes(query)
  })
  const totalSaves = (games ?? []).reduce((sum, game) => sum + game.saveCount, 0)
  const totalBytes = (games ?? []).reduce((sum, game) => sum + game.bytes, 0)
  const inventoryLocked = syncing || signingIn || actingId != null

  return (
    <div className="settings-tab-body">
      <Switch
        checked={enabled}
        disabled={saving}
        onChange={(checked) => void persist({ cloudSavesEnabled: checked })}
        label="Enable Google Drive cloud saves"
      />
      <p className="muted download-meta">
        Optional. When on and signed in, saves upload after you close a game. You can also sync
        every known game from this tab.
      </p>

      <div className="folder-field">
        <span className="filter-label">Google account</span>
        <p className="muted download-meta">
          {account.signedIn
            ? `Signed in as ${account.email || 'Google Drive'}.`
            : 'Sign in to store saves and optional user data in this app’s hidden Drive app-data folder. They will not show up in your normal Drive files.'}
        </p>
        <div className="folder-path-row">
          {account.signedIn ? (
            <button className="ghost-btn" type="button" disabled={signingIn || syncing} onClick={() => void signOut()}>
              Sign out
            </button>
          ) : (
            <>
              <button className="ghost-btn" type="button" disabled={signingIn} onClick={() => void signIn(true)}>
                {signingIn ? 'Waiting for Google…' : 'Sign in with Google'}
              </button>
              <button className="ghost-btn" type="button" onClick={() => void copySignInLink()}>
                {copied ? 'Copied' : 'Copy sign-in link'}
              </button>
            </>
          )}
        </div>
        {signingIn && sync?.signInUrl ? (
          <>
            <p className="muted download-meta">
              Paste this original Google URL into the browser you want. Do not copy the address after
              Google redirects — that page is tied to the first browser and will 400 in another.
            </p>
            <input className="folder-path" value={sync.signInUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
          </>
        ) : null}
      </div>

      <UserDataSyncPanel
        enabled={Boolean(settings.cloudUserDataEnabled)}
        signedIn={account.signedIn}
        saving={saving}
        persist={persist}
      />

      <div className="folder-field">
        <span className="filter-label" id="cloud-keep-count-label">
          Last slot saves per game
        </span>
        <p className="muted download-meta">
          Only the newest numbered saves are kept in Drive. Persistent / config files are always
          included.
        </p>
        <div className="cloud-keep-options" role="radiogroup" aria-labelledby="cloud-keep-count-label">
          {CLOUD_SAVE_KEEP_COUNTS.map((count) => (
            <button
              key={count}
              className={
                settings.cloudSaveKeepCount === count
                  ? 'details-tab details-tab-active'
                  : 'details-tab'
              }
              type="button"
              role="radio"
              aria-checked={settings.cloudSaveKeepCount === count}
              disabled={saving}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (count !== settings.cloudSaveKeepCount) void persist({ cloudSaveKeepCount: count })
              }}
            >
              {keepCountLabel(count)}
            </button>
          ))}
        </div>
      </div>

      <Switch
        checked={settings.cloudSaveIncludeAutoQuick !== false}
        disabled={saving}
        onChange={(checked) => void persist({ cloudSaveIncludeAutoQuick: checked })}
        label="Include auto and quick saves"
      />
      <p className="muted download-meta">
        Auto and quick saves ignore the slot limit above. Turn this off to sync only numbered slots
        plus persistent data.
      </p>

      <div className="folder-field">
        <span className="filter-label">Sync now</span>
        <p className="muted download-meta">
          Uploads and downloads for every identified save folder and RPG Maker backup. Games also
          sync automatically when you close them.
        </p>
        <div className="folder-path-row">
          {syncing ? (
            <button className="stop-btn" type="button" onClick={() => void stopSync()}>
              {sync?.cancelled ? 'Stopping…' : 'Stop'}
            </button>
          ) : (
            <button className="ghost-btn" type="button" disabled={!canSync} onClick={() => void syncAll()}>
              Sync all games
            </button>
          )}
        </div>
        {sync?.running && sync.phase === 'syncing' ? (
          <p className="muted download-meta">
            {sync.currentTitle
              ? `Syncing ${sync.currentTitle} (${sync.gamesDone}/${sync.gamesTotal})`
              : `Syncing ${sync.gamesDone}/${sync.gamesTotal} games`}
          </p>
        ) : null}
        {sync?.lastRunAt && !sync.running ? (
          <p className="muted download-meta">
            {sync.cancelled
              ? 'Last sync was stopped.'
              : `Last sync: ${sync.uploaded} uploaded, ${sync.downloaded} downloaded${sync.lastError ? `. ${sync.lastError}` : '.'}`}
          </p>
        ) : null}
      </div>

      {account.signedIn ? (
        <div className="folder-field">
          <div className="saves-location-head">
            <span className="filter-label">Saves in the cloud</span>
            <div className="cloud-inventory-actions">
              {inventoryOpen && games && games.length ? (
                <span className="muted">
                  {games.length} {games.length === 1 ? 'game' : 'games'} · {totalSaves}{' '}
                  {totalSaves === 1 ? 'save' : 'saves'} · {formatBytes(totalBytes)}
                </span>
              ) : null}
              <button
              className="ghost-btn"
              type="button"
              disabled={!account.signedIn}
              aria-expanded={inventoryOpen}
              onClick={() => setInventoryOpen((current) => !current)}
            >
              {inventoryOpen ? 'Hide' : 'Show'}
            </button>
            </div>
          </div>
          <p className="muted download-meta">
            Games that currently have files in this app’s Drive folder. Hidden until you show the
            list so Drive is not scanned when you open Settings.
          </p>
          {inventoryOpen ? (
            <>
          <div className="folder-path-row">
            <input
              className="folder-path"
              type="search"
              value={filter}
              placeholder="Filter by game"
              disabled={!games?.length}
              onChange={(event) => setFilter(event.target.value)}
            />
            <button
              className="ghost-btn"
              type="button"
              disabled={inventoryLocked || inventoryBusy}
              onClick={() => void loadInventory()}
            >
              {inventoryBusy ? 'Reading…' : 'Refresh'}
            </button>
            {games && games.length ? (
              <button
                className="stop-btn"
                type="button"
                disabled={inventoryLocked}
                onClick={() => void removeAll()}
              >
                Remove all
              </button>
            ) : null}
          </div>
          {inventoryBusy && !games ? (
            <p className="muted download-meta">Reading Google Drive…</p>
          ) : visibleGames.length ? (
            <ul className="cloud-inventory-list">
              {visibleGames.map((game) => {
                const when = formatDateTime(game.updatedAt)
                const busyRow = inventoryLocked || actingId === game.threadId
                return (
                  <li key={game.threadId} className="cloud-inventory-row">
                    <button
                      className="cloud-inventory-main"
                      type="button"
                      onClick={() => onOpenThread(game.threadId, game.title)}
                    >
                      <strong>{game.title}</strong>
                      <span className="muted">
                        {game.saveCount} {game.saveCount === 1 ? 'save' : 'saves'} · {formatBytes(game.bytes)}
                        {when ? ` · ${when}` : ''}
                      </span>
                    </button>
                    <div className="cloud-inventory-actions">
                      <button
                        className="ghost-btn"
                        type="button"
                        disabled={busyRow || !enabled}
                        title={enabled ? 'Sync this game' : 'Turn on cloud saves to resync'}
                        onClick={() => void resyncGame(game.threadId)}
                      >
                        {actingId === game.threadId && syncing ? 'Syncing…' : 'Resync'}
                      </button>
                      <button
                        className="stop-btn"
                        type="button"
                        disabled={busyRow}
                        onClick={() => void removeGame(game)}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="muted download-meta">
              {inventoryBusy
                ? 'Reading Google Drive…'
                : filter.trim()
                  ? 'No cloud games match that filter.'
                  : 'No saves in Google Drive yet.'}
            </p>
          )}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
