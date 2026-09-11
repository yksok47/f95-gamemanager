import type { JSX } from 'react'

type SwitchProps = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  label: string
  id?: string
}

export default function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  id
}: SwitchProps): JSX.Element {
  const inputId = id || `switch-${label.replace(/\s+/g, '-').toLowerCase()}`
  return (
    <label className={disabled ? 'ui-switch ui-switch-disabled' : 'ui-switch'} htmlFor={inputId}>
      <input
        id={inputId}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-switch-track" aria-hidden="true">
        <span className="ui-switch-thumb" />
      </span>
      <span className="ui-switch-label">{label}</span>
    </label>
  )
}
