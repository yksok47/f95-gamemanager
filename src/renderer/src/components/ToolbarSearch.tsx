import { useRef, type JSX, type ReactNode } from 'react'
import { ClearIcon } from './ToolbarIcons'

type ToolbarSearchProps = {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  pageSearch?: boolean
  addon?: ReactNode
}

export default function ToolbarSearch({
  value,
  onChange,
  placeholder,
  className = 'toolbar-search',
  pageSearch = className === 'toolbar-search',
  addon
}: ToolbarSearchProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const hasValue = Boolean(value)

  const field = (
    <div className={hasValue ? `${className}-wrap has-clear` : `${className}-wrap`}>
      <input
        ref={inputRef}
        className={className}
        type="search"
        data-page-search={pageSearch ? '' : undefined}
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

  if (!addon) return field

  return <div className="toolbar-search-split">{field}{addon}</div>
}
