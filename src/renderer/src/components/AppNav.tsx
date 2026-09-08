import type { JSX } from 'react'
import { ToolbarSlot } from './ToolbarPortal'

export type AppView = 'catalog' | 'followed' | 'library' | 'downloads' | 'settings'

type AppNavProps = {
  view: AppView
  username: string | null
  userId: string | null
  followedCount: number
  libraryCount: number
  downloadCount: number
  onViewChange: (view: AppView) => void
  onLogout: () => void
}

export default function AppNav({
  view,
  username,
  userId,
  followedCount,
  libraryCount,
  downloadCount,
  onViewChange,
  onLogout
}: AppNavProps): JSX.Element {
  return (
    <header className="top-bar">
      <div className="app-nav-links">
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
      </div>
      <ToolbarSlot />
      <div className="app-nav-user">
        <span className="muted">
          {username ? username : userId ? `User ${userId}` : 'Signed in'}
        </span>
        <button
          className={view === 'settings' ? 'nav-btn nav-btn-active' : 'ghost-btn'}
          type="button"
          title="Settings"
          onClick={() => onViewChange('settings')}
        >
          Settings
        </button>
        <button className="ghost-btn" type="button" onClick={onLogout}>
          Log out
        </button>
      </div>
    </header>
  )
}
