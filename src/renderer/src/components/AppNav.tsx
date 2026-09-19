import { useEffect, useRef, useState, type JSX } from 'react'
import appIcon from '../assets/icon.png'
import { MenuPopover } from './MenuPopover'
import { ToolbarSlot } from './ToolbarPortal'
import { DownloadIcon, FullscreenIcon, SettingsIcon, StorageIcon, UploadIcon } from './ToolbarIcons'

export type AppView = 'catalog' | 'followed' | 'updates' | 'roster' | 'library' | 'storage' | 'downloads' | 'uploads' | 'settings'

type AppNavProps = {
  view: AppView
  username: string | null
  userId: string | null
  followedCount: number
  updatesCount: number
  rosterCount: number
  libraryCount: number
  downloadCount: number
  uploadCount?: number
  showUploads?: boolean
  appUpdateAvailable?: boolean
  appUpdateVersion?: string | null
  onViewChange: (view: AppView) => void
  onLogout: () => void
}

function displayName(username: string | null, userId: string | null): string {
  if (username) return username
  if (userId) return `User ${userId}`
  return 'Signed in'
}

function avatarInitials(username: string | null, userId: string | null): string {
  const source = (username || userId || '?').trim()
  const parts = source.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
  }
  return (parts[0] ?? '?').slice(0, 2).toUpperCase()
}

export default function AppNav({
  view,
  username,
  userId,
  followedCount,
  updatesCount,
  rosterCount,
  libraryCount,
  downloadCount,
  uploadCount = 0,
  showUploads = false,
  appUpdateAvailable = false,
  appUpdateVersion = null,
  onViewChange,
  onLogout
}: AppNavProps): JSX.Element {
  const [accountOpen, setAccountOpen] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const avatarRef = useRef<HTMLButtonElement>(null)
  const name = displayName(username, userId)

  useEffect(() => {
    void window.api.window.isFullScreen().then(setFullscreen)
    return window.api.window.onFullScreenChange(setFullscreen)
  }, [])

  return (
    <header className="top-bar">
      <div className="app-nav-links">
        <img className="app-nav-icon" src={appIcon} alt="" width={28} height={28} />
        <button
          className={view === 'catalog' ? 'nav-btn nav-btn-active' : 'nav-btn'}
          type="button"
          onClick={() => onViewChange('catalog')}
        >
          Catalog
        </button>
        <button
          className={view === 'followed' ? 'nav-btn nav-btn-active' : 'nav-btn'}
          type="button"
          onClick={() => onViewChange('followed')}
        >
          Followed{followedCount ? ` (${followedCount})` : ''}
        </button>
        <button
          className={view === 'updates' ? 'nav-btn nav-btn-active' : 'nav-btn'}
          type="button"
          onClick={() => onViewChange('updates')}
        >
          Updates{updatesCount ? ` (${updatesCount})` : ''}
        </button>
        <button
          className={view === 'roster' ? 'nav-btn nav-btn-active' : 'nav-btn'}
          type="button"
          onClick={() => onViewChange('roster')}
        >
          Roster{rosterCount ? ` (${rosterCount})` : ''}
        </button>
        <button
          className={view === 'library' ? 'nav-btn nav-btn-active' : 'nav-btn'}
          type="button"
          onClick={() => onViewChange('library')}
        >
          Library{libraryCount ? ` (${libraryCount})` : ''}
        </button>
      </div>
      <ToolbarSlot />
      <div className="app-nav-user">
        <button
          className={view === 'storage' ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
          type="button"
          title="Storage"
          aria-label="Storage"
          onClick={() => onViewChange('storage')}
        >
          <StorageIcon />
        </button>
        <button
          className={view === 'downloads' ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
          type="button"
          title="Downloads"
          aria-label={downloadCount ? `Downloads (${downloadCount})` : 'Downloads'}
          onClick={() => onViewChange('downloads')}
        >
          <DownloadIcon />
          {downloadCount ? <span className="icon-btn-badge">{downloadCount}</span> : null}
        </button>
        {showUploads ? (
          <button
            className={view === 'uploads' ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
            type="button"
            title="Uploads"
            aria-label={uploadCount ? `Uploads (${uploadCount})` : 'Uploads'}
            onClick={() => onViewChange('uploads')}
          >
            <UploadIcon />
            {uploadCount ? <span className="icon-btn-badge">{uploadCount}</span> : null}
          </button>
        ) : null}
        <button
          className={fullscreen ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
          type="button"
          title={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
          aria-pressed={fullscreen}
          onClick={() => {
            void window.api.window.toggleFullScreen().then(setFullscreen)
          }}
        >
          <FullscreenIcon active={fullscreen} />
        </button>
        <button
          className={view === 'settings' ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
          type="button"
          title={
            appUpdateAvailable
              ? appUpdateVersion
                ? `Settings — version ${appUpdateVersion} is available`
                : 'Settings — update available'
              : 'Settings'
          }
          aria-label={
            appUpdateAvailable
              ? appUpdateVersion
                ? `Settings, update ${appUpdateVersion} available`
                : 'Settings, update available'
              : 'Settings'
          }
          onClick={() => onViewChange('settings')}
        >
          <SettingsIcon />
          {appUpdateAvailable ? (
            <span className="icon-btn-badge icon-btn-badge-update" aria-hidden="true">
              <svg viewBox="0 0 16 16">
                <path
                  fill="currentColor"
                  d="M8 1.4c.4 0 .75.35.75.75v7.1l2.2-2.2 1.05 1.05L8 12.1 3.99 8.1l1.06-1.05 2.2 2.2V2.15c0-.4.35-.75.75-.75M3.2 13.1h9.6v1.5H3.2z"
                />
              </svg>
            </span>
          ) : null}
        </button>
        <button
          ref={avatarRef}
          className={accountOpen ? 'user-avatar is-open' : 'user-avatar'}
          type="button"
          title={name}
          aria-label="Account"
          aria-haspopup="menu"
          aria-expanded={accountOpen}
          onClick={() => setAccountOpen((open) => !open)}
        >
          {avatarInitials(username, userId)}
        </button>
        {accountOpen && avatarRef.current ? (
          <MenuPopover
            anchor={avatarRef.current}
            header={name}
            items={[
              {
                id: 'logout',
                label: 'Log out',
                onClick: onLogout
              }
            ]}
            onClose={() => setAccountOpen(false)}
          />
        ) : null}
      </div>
    </header>
  )
}
