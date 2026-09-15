import { useRef, type JSX } from 'react'
import { ClearIcon } from './ToolbarIcons'

type ToolbarSearchProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export default function ToolbarSearch({
  value,
  onChange,
  placeholder,
  className = 'toolbar-search'
}: ToolbarSearchProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const hasValue = Boolean(value)

  return (
    <div className={hasValue ? `${className}-wrap has-clear` : `${className}-wrap`}>
      <input
        ref={inputRef}
        className={className}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {hasValue ? (
        <button
          className="search-clear-btn"
          type="button"
          title="Clear search"
          aria-label="Clear search"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
        >
          <ClearIcon />
        </button>
      ) : null}
    </div>
  )
}
