import type { JSX } from 'react'

type FollowButtonProps = {
  subscribed: boolean
  onToggle: () => void
  className?: string
  variant?: 'compact' | 'modal'
}

function EyeOpenIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

function EyeSlashIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a16.8 16.8 0 0 1-2.2 3.3M6.1 6.1C3.9 7.6 2 12 2 12a16.7 16.7 0 0 0 5.9 5.9M12 19c-.7 0-1.4-.1-2-.3"
      />
    </svg>
  )
}

export default function FollowButton({
  subscribed,
  onToggle,
  className,
  variant = 'compact'
}: FollowButtonProps): JSX.Element {
  const actionLabel = subscribed ? 'Unfollow' : 'Follow'
  const classes = [
    'follow-btn',
    subscribed ? 'follow-btn-on' : '',
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
      aria-pressed={subscribed}
      title={actionLabel}
      onClick={onToggle}
    >
      <span className="follow-icon" aria-hidden="true">
        {subscribed ? (
          <>
            <span className="follow-icon-default">
              <EyeOpenIcon />
            </span>
            <span className="follow-icon-hover">
              <EyeSlashIcon />
            </span>
          </>
        ) : (
          <EyeOpenIcon />
        )}
      </span>
      <span className="follow-label" aria-hidden="true">
        {subscribed ? (
          <>
            <span className="follow-label-idle">Following</span>
            <span className="follow-label-hover">Unfollow</span>
          </>
        ) : (
          <span className="follow-label-idle">Follow</span>
        )}
      </span>
    </button>
  )
}
