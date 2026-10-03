import { useEffect, useRef, useState, type JSX } from 'react'
import type { GameLibraryFile, RenpyLastRun, UnRenAction } from '@shared/types'
import { confirm } from './ConfirmDialog'
import { formatBytes, useRenpySession } from '../lib/renpy'

type UnRenPanelProps = {
  files: GameLibraryFile[]
}

function lastRunLine(run: RenpyLastRun): string {
  const extra = [
    run.cancelled ? 'stopped' : '',
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
  const { installed, activeId, setFileId, info, status, error, setError, busy, running, withInfo, reload } =
    useRenpySession(files, { installedOnly: true, scope: 'scripts' })
  const logRef = useRef<HTMLPreElement>(null)
  const [logOpen, setLogOpen] = useState(false)
  const log = status?.log || info?.lastRun?.log || ''
  const scripts = info?.scripts
  const tracked = info?.trackedFiles
  const failed = Boolean(error || (info?.lastRun && !info.lastRun.ok && !info.lastRun.cancelled))
  const cancelling = Boolean(status?.cancelling)

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

  function stopAction(): void {
    if (!activeId) return
    void window.api.renpy.cancel(activeId)
  }

  const extractLocked = Boolean(
    tracked?.extractLocked || (scripts && (tracked?.extract || 0) > 0 && scripts.rpaCount === 0)
  )
  const compiledWithRpy = scripts ? Math.max(0, scripts.rpycCount - scripts.rpycWithoutRpy) : 0
  const decompileLocked = Boolean(
    tracked?.decompileLocked || (scripts && (tracked?.decompile || 0) > 0 && compiledWithRpy === 0)
  )
  const canDeleteArchives = Boolean(scripts && scripts.rpaCount > 0 && (tracked?.extract || scripts.alreadyUnpacked))
  const canDeleteCompiled = compiledWithRpy > 0

  async function retractAction(action: UnRenAction): Promise<void> {
    if (!activeId) return
    const extractCount = tracked?.extract || 0
    const decompileCount = tracked?.decompile || 0
    const count = action === 'extract' ? extractCount : decompileCount
    const ok = await confirm({
      title: action === 'extract' ? 'Remove extracted' : 'Remove decompiled',
      message:
        action === 'extract'
          ? `Delete the ${count} file(s) created by extracting .rpa archives? Original archives are kept. Decompiled .rpy files are not removed unless you remove those separately.`
          : `Delete the ${count} .rpy file(s) created by decompiling? Compiled .rpyc files are kept.`,
      confirmLabel: 'Remove',
      danger: true
    })
    if (!ok) return
    await withInfo(() => window.api.renpy.retract(activeId, action))
  }

  async function discardAction(action: UnRenAction): Promise<void> {
    if (!activeId) return
    const archiveCount = scripts?.rpaCount || 0
    const ok = await confirm({
      title: action === 'extract' ? 'Delete RPA' : 'Delete RPYC',
      message:
        action === 'extract'
          ? `Delete the ${archiveCount} .rpa archive(s)? This cannot be undone, and you will no longer be able to remove the extracted files.`
          : `Delete the ${compiledWithRpy} compiled .rpyc file(s) that already have decompiled .rpy copies? This cannot be undone, and you will no longer be able to remove the decompiled scripts.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    await withInfo(() => window.api.renpy.discard(activeId, action))
  }

  if (!installed.length) {
    return (
      <p className="muted">
        Install a Ren&apos;Py build from the Files tab to unpack archives and decompile scripts.
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
          <div className="renpy-section-title">
            <h2>Game status</h2>
            {scripts ? (
              <div className="library-file-flags">
                <Flag on={scripts.alreadyUnpacked} warn={scripts.needsUnpack}>
                  {scripts.needsUnpack ? 'Still compressed' : scripts.alreadyUnpacked ? 'Uncompressed' : 'No scripts'}
                </Flag>
                <Flag on={scripts.alreadyDecompiled} warn={scripts.needsDecompile}>
                  {scripts.needsDecompile ? 'Still compiled' : scripts.alreadyDecompiled ? 'Decompiled' : 'No scripts'}
                </Flag>
                {!scripts.pythonPath ? <Flag on warn>Python missing</Flag> : null}
              </div>
            ) : null}
          </div>
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
              onClick={() => void reload()}
            >
              Refresh
            </button>
          </div>
        </div>
        {scripts ? (
          <>
            <div className="renpy-work-rows">
              <div className="renpy-work-row">
                <div className="renpy-stats">
                  <div className="renpy-stat">
                    <strong>{scripts.rpaCount}</strong>
                    <span>Archives{scripts.rpaBytes ? ` · ${formatBytes(scripts.rpaBytes)}` : ''}</span>
                  </div>
                  <div className="renpy-stat">
                    <strong>{tracked?.extract || 0}</strong>
                    <span>Extracted files</span>
                  </div>
                </div>
                <div className="renpy-actions">
                  {running && status?.action === 'extract' ? (
                    <button
                      className="stop-btn"
                      type="button"
                      disabled={!activeId || cancelling}
                      onClick={() => stopAction()}
                    >
                      {cancelling ? 'Stopping…' : 'Stop'}
                    </button>
                  ) : (
                    <>
                      <button
                        className="primary-btn"
                        type="button"
                        disabled={busy || running || !scripts.needsUnpack}
                        title={
                          scripts.needsUnpack
                            ? undefined
                            : scripts.alreadyUnpacked
                              ? 'Already uncompressed'
                              : 'No archives to extract'
                        }
                        onClick={() => runAction('extract')}
                      >
                        Extract RPA
                      </button>
                      {tracked?.extract ? (
                        <button
                          className="warn-btn"
                          type="button"
                          disabled={busy || running || extractLocked}
                          title={
                            extractLocked
                              ? 'Archives were deleted, so extracted files cannot be removed'
                              : 'Remove extracted files. Original RPA archives are kept.'
                          }
                          onClick={() => void retractAction('extract')}
                        >
                          Remove extracted
                        </button>
                      ) : null}
                      {canDeleteArchives ? (
                        <button
                          className="danger-btn"
                          type="button"
                          disabled={busy || running}
                          title="Permanently delete original RPA archives"
                          onClick={() => void discardAction('extract')}
                        >
                          Delete RPA
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
              <div className="renpy-work-row">
                <div className="renpy-stats">
                  <div className="renpy-stat">
                    <strong>{scripts.rpyCount}</strong>
                    <span>Decompiled scripts</span>
                  </div>
                  <div className="renpy-stat">
                    <strong>{scripts.rpycWithoutRpy}</strong>
                    <span>Still compiled</span>
                  </div>
                </div>
                <div className="renpy-actions">
                  {running && status?.action === 'decompile' ? (
                    <button
                      className="stop-btn"
                      type="button"
                      disabled={!activeId || cancelling}
                      onClick={() => stopAction()}
                    >
                      {cancelling ? 'Stopping…' : 'Stop'}
                    </button>
                  ) : (
                    <>
                      <button
                        className="primary-btn"
                        type="button"
                        disabled={busy || running || !scripts.needsDecompile}
                        title={
                          scripts.needsDecompile
                            ? undefined
                            : scripts.alreadyDecompiled
                              ? 'Already decompiled'
                              : 'No compiled scripts to decompile'
                        }
                        onClick={() => runAction('decompile')}
                      >
                        Decompile RPYC
                      </button>
                      {tracked?.decompile ? (
                        <button
                          className="warn-btn"
                          type="button"
                          disabled={busy || running || decompileLocked}
                          title={
                            decompileLocked
                              ? 'Compiled scripts were deleted, so decompiled scripts cannot be removed'
                              : 'Remove decompiled scripts. Compiled RPYC files are kept.'
                          }
                          onClick={() => void retractAction('decompile')}
                        >
                          Remove decompiled
                        </button>
                      ) : null}
                      {canDeleteCompiled ? (
                        <button
                          className="danger-btn"
                          type="button"
                          disabled={busy || running}
                          title="Permanently delete compiled RPYC files that already have .rpy copies"
                          onClick={() => void discardAction('decompile')}
                        >
                          Delete RPYC
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
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
          <p className="muted">{lastRunLine(info.lastRun)}</p>
        ) : null}
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
    </div>
  )
}
