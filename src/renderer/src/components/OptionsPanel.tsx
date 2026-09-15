import type { JSX } from 'react'
import type { GameLibraryFile, RenpyToolId } from '@shared/types'
import Switch from './Switch'
import { useRenpySession } from '../lib/renpy'

type OptionsPanelProps = {
  files: GameLibraryFile[]
}

const OPTIONS: Array<{ id: RenpyToolId; label: string; hint: string }> = [
  { id: 'fullscreen', label: 'Fullscreen', hint: 'Start the game in fullscreen mode' },
  { id: 'console', label: 'Developer console', hint: 'Shift+O console, Shift+D developer menu' },
  { id: 'quick', label: 'Quick save / load', hint: 'F5 save, F9 load' },
  { id: 'skip', label: 'Skip unseen text', hint: 'Tab and Ctrl skip everything' },
  { id: 'rollback', label: 'Rollback', hint: 'Scroll wheel and Page Up go back' },
  { id: 'transitions', label: 'Skip transitions', hint: 'Skip scene transitions while advancing' },
  { id: 'after-choices', label: 'Skip after choices', hint: 'Keep skipping after a menu choice' }
]

export default function OptionsPanel({ files }: OptionsPanelProps): JSX.Element {
  const { installed, activeId, setFileId, info, error, busy, running, withInfo } = useRenpySession(files, {
    installedOnly: true
  })
  const useGlobal = Boolean(info?.optionsGlobal)
  const optionsLocked = useGlobal

  function toggle(id: RenpyToolId, enabled: boolean): void {
    if (!activeId || optionsLocked) return
    void withInfo(() => window.api.renpy.setTool(activeId, id, enabled))
  }

  function setAll(enabled: boolean): void {
    if (!activeId || optionsLocked) return
    void withInfo(() => window.api.renpy.setAllOptions(activeId, enabled))
  }

  function setGlobal(enabled: boolean): void {
    if (!activeId) return
    void withInfo(() => window.api.renpy.setOptionsGlobal(activeId, enabled))
  }

  if (!installed.length) {
    return (
      <p className="muted">
        Install a Ren&apos;Py build from the Files tab to read and change these options.
      </p>
    )
  }

  return (
    <div className="renpy-panel">
      {installed.length > 1 ? (
        <label className="renpy-version">
          <span className="muted">Version</span>
          <select className="toolbar-select" value={activeId} onChange={(event) => setFileId(event.target.value)}>
            {installed.map((file) => (
              <option key={file.id} value={file.id}>
                {file.version || 'Unknown'} · {file.filename}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <section className="renpy-section">
        <div className="renpy-section-head">
          <h2>Runtime options</h2>
          <div className="renpy-actions">
            <button
              className="ghost-btn"
              type="button"
              disabled={busy || running}
              onClick={() => void withInfo(() => window.api.renpy.info(activeId, false))}
            >
              Refresh
            </button>
            <button
              className="ghost-btn"
              type="button"
              disabled={busy || running || optionsLocked}
              onClick={() => setAll(true)}
            >
              Enable all
            </button>
            <button
              className="ghost-btn"
              type="button"
              disabled={busy || running || optionsLocked}
              onClick={() => setAll(false)}
            >
              Disable all
            </button>
          </div>
        </div>
        <div className="renpy-global-option">
          <Switch
            label="Use these settings for all Ren'Py games"
            checked={useGlobal}
            disabled={busy || running || !activeId}
            onChange={setGlobal}
          />
          <p className="muted library-file-meta">
            {useGlobal
              ? 'These settings apply to every Ren\'Py game. Per-game switches are locked — turn this off to edit, then turn it back on to push your changes everywhere.'
              : 'Saved for this game and applied automatically when you install it or a new version.'}
          </p>
        </div>
        <p className="muted">
          Skip options follow the game&apos;s saved preferences. Quit the game, then refresh if you changed them
          in-game.
        </p>
        <div className="renpy-tools">
          {OPTIONS.map((option) => {
            const on = Boolean(info?.tools[option.id])
            return (
              <article key={option.id} className="renpy-tool">
                <div>
                  <strong>{option.label}</strong>
                  <p className="muted library-file-meta">{option.hint}</p>
                </div>
                <button
                  className={on ? 'ghost-btn nav-btn-active' : 'ghost-btn'}
                  type="button"
                  aria-pressed={on}
                  disabled={busy || running || !activeId || optionsLocked}
                  title={optionsLocked ? 'Per-game options are locked while global settings are on' : undefined}
                  onClick={() => toggle(option.id, !on)}
                >
                  {on ? 'On' : 'Off'}
                </button>
              </article>
            )
          })}
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </section>
    </div>
  )
}
