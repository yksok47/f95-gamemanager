import { useEffect, useId, useMemo, useState, type FormEvent, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { VersionPlayStat } from '@shared/types'
import {
  dateInputFromReleasedAt,
  formatPlaytime,
  formatUpdateDate,
  releasedAtFromDateInput,
  usableVersion
} from '@shared/updates'
import { confirm } from './ConfirmDialog'

function versionLookupNames(item: VersionPlayStat): string[] {
  return [item.version, ...(item.aliases || [])].map((name) => name.trim()).filter(Boolean)
}

export default function VersionManagerDialog({
  versions,
  canEdit,
  busy,
  onClose,
  onSetReleasedAt,
  onAddAlias,
  onRemoveAlias,
  onMerge
}: {
  versions: VersionPlayStat[]
  canEdit: boolean
  busy: boolean
  onClose: () => void
  onSetReleasedAt: (version: string, releasedAt: number) => Promise<void> | void
  onAddAlias: (version: string, alias: string) => Promise<void> | void
  onRemoveAlias: (version: string, alias: string) => Promise<void> | void
  onMerge: (canonical: string, sources: string[]) => Promise<void> | void
}): JSX.Element {
  const titleId = useId()
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [keepName, setKeepName] = useState('')

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busy) onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const names = useMemo(() => versions.map((item) => item.version), [versions])

  useEffect(() => {
    setSelected((current) => current.filter((name) => names.includes(name)))
  }, [names])

  useEffect(() => {
    if (selected.includes(keepName)) return
    setKeepName(selected[0] || '')
  }, [keepName, selected])

  function toggleSelected(version: string): void {
    setSelected((current) =>
      current.includes(version) ? current.filter((name) => name !== version) : [...current, version]
    )
  }

  async function submitAlias(version: string, event?: FormEvent): Promise<void> {
    event?.preventDefault()
    const alias = usableVersion(aliasDrafts[version])
    if (!canEdit || busy || !alias || alias === version) return
    const existing = versions.find((item) => versionLookupNames(item).includes(alias))
    if (existing && existing.version !== version) {
      const ok = await confirm({
        title: 'Merge versions',
        message: `Treat ${alias} as another name for ${version}? Play times for those names will be added together.`,
        confirmLabel: 'Merge'
      })
      if (!ok) return
    }
    await onAddAlias(version, alias)
    setAliasDrafts((current) => ({ ...current, [version]: '' }))
  }

  async function mergeSelected(): Promise<void> {
    const keep = usableVersion(keepName)
    const sources = selected.filter((name) => name && name !== keep)
    if (!canEdit || busy || !keep || sources.length < 1 || selected.length < 2) return
    const ok = await confirm({
      title: 'Merge versions',
      message: `Keep ${keep} and treat ${sources.join(', ')} as the same version? Play times will be added together.`,
      confirmLabel: 'Merge'
    })
    if (!ok) return
    await onMerge(keep, sources)
    setSelected([])
  }

  const mergeReady = canEdit && selected.length >= 2 && Boolean(usableVersion(keepName))

  return createPortal(
    <div
      className="app-confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="storage-identify-dialog version-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="storage-identify-head">
          <h2 id={titleId} className="app-confirm-title">
            Manage versions
          </h2>
          <p className="muted">
            Set release dates, add alternative names, and merge names that are actually the same
            build so their play times are counted together.
          </p>
          {canEdit ? null : (
            <p className="muted">Follow this game to save version organisation.</p>
          )}
        </div>

        <ul className="version-manager-list">
          {versions.map((item) => {
            const checked = selected.includes(item.version)
            const draft = aliasDrafts[item.version] ?? ''
            return (
              <li key={item.version || '__unknown__'} className="version-manager-row">
                <label className="version-manager-pick">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!canEdit || busy || !item.version}
                    onChange={() => toggleSelected(item.version)}
                  />
                  <span className="version-manager-name">{item.version || 'Unknown'}</span>
                </label>
                <span className="muted version-manager-playtime">
                  {item.lastPlayedAt || item.playtimeMs ? formatPlaytime(item.playtimeMs) : 'No play time'}
                </span>
                <label className="version-manager-date">
                  <span className="muted">Released</span>
                  <input
                    className="folder-path"
                    type="date"
                    value={dateInputFromReleasedAt(item.releasedAt)}
                    disabled={!canEdit || busy || !item.version}
                    aria-label={`Release date for ${item.version || 'this version'}`}
                    onChange={(event) => {
                      void onSetReleasedAt(item.version, releasedAtFromDateInput(event.target.value))
                    }}
                  />
                  {item.releasedAt ? (
                    <span className="muted">{formatUpdateDate(item.releasedAt)}</span>
                  ) : null}
                </label>
                <div className="version-manager-aliases">
                  <span className="muted">Also known as</span>
                  <div className="version-manager-alias-list">
                    {(item.aliases || []).map((alias) => (
                      <span key={alias} className="version-manager-alias">
                        {alias}
                        {canEdit ? (
                          <button
                            className="version-manager-alias-remove"
                            type="button"
                            aria-label={`Remove alternative name ${alias}`}
                            disabled={busy}
                            onClick={() => void onRemoveAlias(item.version, alias)}
                          >
                            ×
                          </button>
                        ) : null}
                      </span>
                    ))}
                    {canEdit ? (
                      <form
                        className="version-manager-alias-form"
                        onSubmit={(event) => void submitAlias(item.version, event)}
                      >
                        <input
                          className="folder-path"
                          type="text"
                          value={draft}
                          disabled={busy || !item.version}
                          placeholder="Add name"
                          aria-label={`Add alternative name for ${item.version}`}
                          onChange={(event) =>
                            setAliasDrafts((current) => ({
                              ...current,
                              [item.version]: event.target.value
                            }))
                          }
                        />
                        <button
                          className="ghost-btn"
                          type="submit"
                          disabled={busy || !usableVersion(draft) || usableVersion(draft) === item.version}
                        >
                          Add
                        </button>
                      </form>
                    ) : null}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="version-manager-merge">
          <label className="version-manager-keep">
            <span className="muted">Keep name</span>
            <select
              className="folder-path toolbar-select"
              value={keepName}
              disabled={!mergeReady || busy}
              onChange={(event) => setKeepName(event.target.value)}
            >
              {selected.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-btn"
            type="button"
            disabled={!mergeReady || busy}
            onClick={() => void mergeSelected()}
          >
            Merge selected
          </button>
        </div>

        <div className="app-confirm-actions">
          <button className="ghost-btn" type="button" disabled={busy} onClick={onClose} autoFocus>
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
