import { type JSX, type ReactNode } from 'react'
import { Spinner } from './Spinner'

export type SavesPanelView = 'saves' | 'cloud' | 'settings'

type SavesPanelTabsProps = {
  view: SavesPanelView
  onViewChange: (view: SavesPanelView) => void
  cloudEnabled: boolean
  localActions?: ReactNode
  cloudActions?: ReactNode
}

export function SavesActionButton({
  label,
  busyLabel,
  title,
  danger = false,
  busy = false,
  disabled = false,
  onClick
}: {
  label: string
  busyLabel?: string
  title?: string
  danger?: boolean
  busy?: boolean
  disabled?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className={danger ? 'ghost-btn saves-toolbar-btn is-danger' : 'ghost-btn saves-toolbar-btn'}
      type="button"
      title={title}
      aria-busy={busy || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {busy ? <Spinner size="sm" /> : null}
      {busy ? busyLabel || label : label}
    </button>
  )
}

function ActionGroup({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="saves-action-group">
      <span className="saves-action-group-label">{label}</span>
      <div className="saves-action-group-btns">{children}</div>
    </div>
  )
}

export default function SavesPanelTabs({
  view,
  onViewChange,
  cloudEnabled,
  localActions,
  cloudActions
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
      {localActions || cloudActions ? (
        <div className="saves-action-groups">
          {localActions ? <ActionGroup label="Local">{localActions}</ActionGroup> : null}
          {cloudActions ? <ActionGroup label="Cloud">{cloudActions}</ActionGroup> : null}
        </div>
      ) : null}
    </div>
  )
}
