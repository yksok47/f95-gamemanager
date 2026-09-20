import { type JSX, type ReactNode } from 'react'

export type SavesPanelView = 'saves' | 'cloud' | 'settings'

type SavesPanelTabsProps = {
  view: SavesPanelView
  onViewChange: (view: SavesPanelView) => void
  cloudEnabled: boolean
  actions?: ReactNode
}

export default function SavesPanelTabs({
  view,
  onViewChange,
  cloudEnabled,
  actions
}: SavesPanelTabsProps): JSX.Element {
  return (
    <div className="saves-panel-head">
      <div className="match-toggle" role="tablist" aria-label="Saves sections">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'saves'}
          className={view === 'saves' ? 'is-active' : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onViewChange('saves')}
        >
          Saves
        </button>
        {cloudEnabled ? (
          <button
            type="button"
            role="tab"
            aria-selected={view === 'cloud'}
            className={view === 'cloud' ? 'is-active' : undefined}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onViewChange('cloud')}
          >
            Cloud
          </button>
        ) : null}
        <button
          type="button"
          role="tab"
          aria-selected={view === 'settings'}
          className={view === 'settings' ? 'is-active' : undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onViewChange('settings')}
        >
          Settings
        </button>
      </div>
      {actions ? <div className="renpy-actions">{actions}</div> : null}
    </div>
  )
}
