import { useEffect, useRef, useState, type JSX } from 'react'
import type { GameLibraryFile, RenpyLastRun, RenpyToolId, UnRenAction } from '@shared/types'
import { formatBytes, useRenpySession } from '../lib/renpy'

type UnRenPanelProps = {
  files: GameLibraryFile[]
}

const TOOLS: Array<{ id: RenpyToolId; label: string; hint: string }> = [
  { id: 'console', label: 'Developer console', hint: 'Shift+O console, Shift+D developer menu' },
  { id: 'quick', label: 'Quick save / load', hint: 'F5 save, F9 load' },
  { id: 'skip', label: 'Skip unseen text', hint: 'Tab and Ctrl skip everything' },
  { id: 'rollback', label: 'Rollback', hint: 'Scroll wheel and Page Up go back' }
]

function lastRunLine(run: RenpyLastRun): string {
  const extra = [
    run.total ? `${run.done}/${run.total}` : '',
    run.failed ? `${run.failed} failed` : '',
    run.skipped ? `${run.skipped} skipped` : '',
    run.finishedAt ? `${Math.round((run.finishedAt - run.startedAt) / 1000)}s` : ''
  ].filter(Boolean)
  return extra.length ? `${run.summary} · ${extra.join(' · ')}` : run.summary
}

function Flag({ on, warn, children }: { on: boolean; warn?: boolean; children: string }): JSX.Element {
  return (
    <span className={on ? (warn ? 'file-flag file-flag-warn' : 'file-flag file-flag-on') : 'file-flag'}>
      {children}
    </span>
  )
}

export default function UnRenPanel({ files }: UnRenPanelProps): JSX.Element {
  const { installed, activeId, setFileId, info, status, error, setError, busy, running, withInfo } =
    useRenpySession(files, { installedOnly: true })
  const logRef = useRef<HTMLPreElement>(null)
  const [logOpen, setLogOpen] = useState(false)
  const log = status?.log || info?.lastRun?.log || ''
  const scripts = info?.scripts
  const failed = Boolean(error || (info?.lastRun && !info.lastRun.ok))

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [log, logOpen])

  useEffect(() => {
    if (running) setLogOpen(true)
  }, [running])

  useEffect(() => {
    if (failed) setLogOpen(true)
  }, [failed])

  function runAction(action: UnRenAction): void {
    if (!activeId) return
    void withInfo(() => window.api.renpy.run(activeId, action))
  }

  function toggleTool(tool: RenpyToolId, enabled: boolean): void {
    if (!activeId) return
    void withInfo(() => window.api.renpy.setTool(activeId, tool, enabled))
  }

  if (!installed.length) {
    return (
      <p className="muted">
        Install a Ren&apos;Py build from the Files tab to unpack archives, decompile scripts, and enable UnRen tools.
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
          <h2>Game status</h2>
          <div className="renpy-actions">
            <button
              className="ghost-btn"
              type="button"
              disabled={!activeId}
              onClick={() => void window.api.library.showInstall(activeId).catch((err) => {
                setError(err instanceof Error ? err.message : 'Could not open the game folder.')
              })}
            >
              Open game folder
            </button>
            <button
              className="ghost-btn"
              type="button"
              disabled={busy || running}
              onClick={() => void withInfo(() => window.api.renpy.info(activeId, false))}
            >
              Refresh
            </button>
          </div>
        </div>
        {scripts ? (
          <>
            <p className="library-file-flags">
              <Flag on={scripts.alreadyUnpacked} warn={scripts.needsUnpack}>
                {scripts.needsUnpack ? 'Still compressed' : scripts.alreadyUnpacked ? 'Uncompressed' : 'No scripts'}
              </Flag>
              <Flag on={scripts.alreadyDecompiled} warn={scripts.needsDecompile}>
                {scripts.needsDecompile ? 'Still compiled' : scripts.alreadyDecompiled ? 'Decompiled' : 'No scripts'}
              </Flag>
              {!scripts.pythonPath ? <Flag on warn>Python missing</Flag> : null}
            </p>
            <div className="renpy-stats">
              <div className="renpy-stat">
                <strong>{scripts.rpaCount}</strong>
                <span>Archives{scripts.rpaBytes ? ` · ${formatBytes(scripts.rpaBytes)}` : ''}</span>
              </div>
              <div className="renpy-stat">
                <strong>{scripts.rpyCount}</strong>
                <span>Decompiled scripts</span>
              </div>
              <div className="renpy-stat">
                <strong>{scripts.rpycWithoutRpy}</strong>
                <span>Still compiled</span>
              </div>
            </div>
            <details className="renpy-fold">
              <summary>Install details</summary>
              <p className="muted library-file-meta" title={scripts.gameRoot}>
                {scripts.gameRoot}
              </p>
              {scripts.pythonPath ? (
                <p className="muted library-file-meta" title={scripts.pythonPath}>
                  {scripts.pythonPath}
                </p>
              ) : null}
              {scripts.rpaFiles.length ? (
                <ul className="renpy-rpa-list">
                  {scripts.rpaFiles.slice(0, 40).map((file) => (
                    <li key={file.path} title={file.path}>
                      {file.name} · {formatBytes(file.size)}
                    </li>
                  ))}
                  {scripts.rpaCount > 40 ? <li className="muted">+{scripts.rpaCount - 40} more</li> : null}
                </ul>
              ) : null}
            </details>
          </>
        ) : busy ? (
          <p className="muted">Scanning the install…</p>
        ) : null}
      </section>

      <section className="renpy-section">
        <div className="renpy-section-head">
          <h2>Unpack / decompile</h2>
          <div className="renpy-actions">
            <button className="primary-btn" type="button" disabled={busy || running} onClick={() => runAction('extract')}>
              Extract RPA
            </button>
            <button className="primary-btn" type="button" disabled={busy || running} onClick={() => runAction('decompile')}>
              Decompile rpyc
            </button>
          </div>
        </div>
        {running ? (
          <div className="renpy-progress">
            <p className="muted">{status?.message || 'Working…'}</p>
            {status?.total ? (
              <div className="download-progress" role="progressbar" aria-valuenow={status.percent ?? 0} aria-valuemin={0} aria-valuemax={100}>
                <span style={{ width: `${status.percent ?? 0}%` }} />
              </div>
            ) : (
              <div className="download-progress download-progress-unknown" role="progressbar">
                <span />
              </div>
            )}
            {status?.total ? (
              <p className="muted library-file-meta">
                {status.done}/{status.total}
                {status.percent != null ? ` (${status.percent}%)` : ''}
              </p>
            ) : null}
          </div>
        ) : null}
        {info?.lastRun && !running ? (
          <p className={info.lastRun.ok ? 'muted' : 'error-text'}>{lastRunLine(info.lastRun)}</p>
        ) : null}
        {error ? <p className="error-text">{error}</p> : null}
        {log.trim() || running ? (
          <details
            className="renpy-fold"
            open={logOpen}
            onToggle={(event) => setLogOpen(event.currentTarget.open)}
          >
            <summary>Log</summary>
            <pre ref={logRef} className="renpy-log" tabIndex={0}>
              {log.trim() || 'Working…'}
            </pre>
          </details>
        ) : null}
      </section>

      <section className="renpy-section">
        <div className="renpy-section-head">
          <h2>Runtime tools</h2>
          <button className="ghost-btn" type="button" disabled={busy || running} onClick={() => runAction('all-tools')}>
            Enable all
          </button>
        </div>
        <div className="renpy-tools">
          {TOOLS.map((tool) => {
            const on = Boolean(info?.tools[tool.id])
            return (
              <article key={tool.id} className="renpy-tool">
                <div>
                  <strong>{tool.label}</strong>
                  <p className="muted library-file-meta">{tool.hint}</p>
                </div>
                <button
                  className={on ? 'ghost-btn nav-btn-active' : 'ghost-btn'}
                  type="button"
                  aria-pressed={on}
                  disabled={busy || running}
                  onClick={() => toggleTool(tool.id, !on)}
                >
                  {on ? 'On' : 'Off'}
                </button>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
