import { useRef, useState, type JSX } from 'react'
import appIcon from '../assets/icon.png'
import { MenuPopover } from './MenuPopover'
import { ToolbarSlot } from './ToolbarPortal'

export type AppView = 'catalog' | 'followed' | 'library' | 'downloads' | 'uploads' | 'settings'

type AppNavProps = {
  view: AppView
  username: string | null
  userId: string | null
  followedCount: number
  libraryCount: number
  downloadCount: number
  uploadCount?: number
  showUploads?: boolean
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
  libraryCount,
  downloadCount,
  uploadCount = 0,
  showUploads = false,
  onViewChange,
  onLogout
}: AppNavProps): JSX.Element {
  const [accountOpen, setAccountOpen] = useState(false)
  const avatarRef = useRef<HTMLButtonElement>(null)
  const name = displayName(username, userId)

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
          className={view === 'library' ? 'nav-btn nav-btn-active' : 'nav-btn'}
          type="button"
          onClick={() => onViewChange('library')}
        >
          Library{libraryCount ? ` (${libraryCount})` : ''}
        </button>
        <button
          className={view === 'downloads' ? 'nav-btn nav-btn-active' : 'nav-btn'}
          type="button"
          onClick={() => onViewChange('downloads')}
        >
          Downloads{downloadCount ? ` (${downloadCount})` : ''}
        </button>
        {showUploads ? (
          <button
            className={view === 'uploads' ? 'nav-btn nav-btn-active' : 'nav-btn'}
            type="button"
            onClick={() => onViewChange('uploads')}
          >
            Uploads{uploadCount ? ` (${uploadCount})` : ''}
          </button>
        ) : null}
      </div>
      <ToolbarSlot />
      <div className="app-nav-user">
        <button
          className={view === 'settings' ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
          type="button"
          title="Settings"
          aria-label="Settings"
          onClick={() => onViewChange('settings')}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              fill="currentColor"
              d="M6.5 1.4h3l.28 1.55c.42.14.81.34 1.16.6l1.48-.58 1.5 2.6-1.2.95c.06.3.1.61.1.93s-.04.63-.1.93l1.2.95-1.5 2.6-1.48-.58c-.35.26-.74.46-1.16.6L9.5 14.6h-3l-.28-1.55a5 5 0 0 1-1.16-.6l-1.48.58-1.5-2.6 1.2-.95A4.6 4.6 0 0 1 3.18 8c0-.32.04-.63.1-.93l-1.2-.95 1.5-2.6 1.48.58c.35-.26.74-.46 1.16-.6zm1.5 4.2A2.4 2.4 0 1 0 10.4 8 2.4 2.4 0 0 0 8 5.6"
            />
          </svg>
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
