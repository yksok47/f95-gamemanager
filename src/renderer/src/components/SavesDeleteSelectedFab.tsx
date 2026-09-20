import { type JSX } from 'react'
import { createPortal } from 'react-dom'

type SavesDeleteSelectedFabProps = {
  count: number
  disabled?: boolean
  host: Element | null
  onDelete: () => void
}

export default function SavesDeleteSelectedFab({
  count,
  disabled,
  host,
  onDelete
}: SavesDeleteSelectedFabProps): JSX.Element | null {
  if (count <= 0) return null
  const button = (
    <button
      className="stop-btn saves-delete-selected-fab"
      type="button"
      disabled={disabled}
      onClick={onDelete}
    >
      {count === 1 ? 'Delete selected' : `Delete ${count} selected`}
    </button>
  )
  return host ? createPortal(button, host) : button
}
