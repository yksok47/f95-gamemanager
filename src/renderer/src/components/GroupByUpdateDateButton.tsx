import type { JSX } from 'react'
import { GroupByDateIcon } from './ToolbarIcons'

type GroupByUpdateDateButtonProps = {
  enabled: boolean
  onToggle: () => void
}

export default function GroupByUpdateDateButton({
  enabled,
  onToggle
}: GroupByUpdateDateButtonProps): JSX.Element {
  return (
    <button
      className={enabled ? 'ghost-btn icon-btn nav-btn-active' : 'ghost-btn icon-btn'}
      type="button"
      aria-pressed={enabled}
      title={enabled ? 'Grouped by update date. Turn off to show a single list.' : 'Group games by update date'}
      aria-label="Group by update date"
      onClick={onToggle}
    >
      <GroupByDateIcon />
    </button>
  )
}
