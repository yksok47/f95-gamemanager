import type { JSX } from 'react'

type RosterButtonProps = {
  inRoster: boolean
  onToggle: () => void
  className?: string
  variant?: 'compact' | 'modal'
}

function RosterInIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 3.5h14v17.2L12 17.2 5 20.7zm2.4 3h9.2V8.2H7.4zm0 4.1h9.2v1.7H7.4zm0 4.1h5.4v1.7H7.4z"
      />
    </svg>
  )
}

function RosterAddIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 3.5h11v2.4H7.4v13.2H5zm7.2 4.8h9.6v2.1H12.2zm0 4.8h6.3v2.1H12.2zM18.3 4h2.1v3.3H24v2.1h-3.6v3.3h-2.1V9.4H15V7.3h3.3z"
      />
    </svg>
  )
}

function RosterRemoveIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        fill="currentColor"
        d="M5 3.5h11v2.4H7.4v13.2H5zm7.2 4.8h9.6v2.1H12.2zm0 4.8h6.3v2.1H12.2zM15.2 5.2h8.6v2.1h-8.6z"
      />
    </svg>
  )
}

export default function RosterButton({
  inRoster,
  onToggle,
  className,
  variant = 'compact'
}: RosterButtonProps): JSX.Element {
  const actionLabel = inRoster ? 'Remove from roster' : 'Add to roster'
  const classes = [
    'follow-btn',
    'roster-btn',
    inRoster ? 'follow-btn-on roster-btn-on' : '',
    variant === 'modal' ? 'follow-btn-modal' : 'follow-btn-compact',
    className ?? ''
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      className={classes}
      type="button"
      aria-label={actionLabel}
      aria-pressed={inRoster}
      title={actionLabel}
      onClick={onToggle}
    >
      <span className="follow-icon" aria-hidden="true">
        {inRoster ? (
          <>
            <span className="follow-icon-default">
              <RosterInIcon />
            </span>
            <span className="follow-icon-hover">
              <RosterRemoveIcon />
            </span>
          </>
        ) : (
          <>
            <span className="follow-icon-default">
              <RosterAddIcon />
            </span>
            <span className="follow-icon-hover">
              <RosterInIcon />
            </span>
          </>
        )}
      </span>
      <span className="follow-label" aria-hidden="true">
        {inRoster ? (
          <>
            <span className="follow-label-idle">On roster</span>
            <span className="follow-label-hover">Remove</span>
          </>
        ) : (
          <>
            <span className="follow-label-idle">Roster</span>
            <span className="follow-label-hover">Add</span>
          </>
        )}
      </span>
    </button>
  )
}
