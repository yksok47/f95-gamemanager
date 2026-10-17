import { useEffect, useState, type JSX } from 'react'
import type { TestEnvStatus } from '@shared/types'
import { formatDateTime } from '@shared/updates'
import { confirm } from './ConfirmDialog'
import { notifyCaught } from './ErrorNotifications'

export default function TestEnvPanel({ status }: { status: TestEnvStatus }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [envs, setEnvs] = useState(status.envs)

  useEffect(() => {
    setEnvs(status.envs)
  }, [status.envs])

  const restartNote = status.restartsItself
    ? 'The app will restart.'
    : 'The app will close. Run `bun dev` again to open it.'

  async function run(action: () => Promise<unknown>, failure: string): Promise<void> {
    setBusy(true)
    try {
      await action()
    } catch (err) {
      notifyCaught(err, failure)
      setBusy(false)
    }
  }

  async function create(): Promise<void> {
    const ok = await confirm({
      title: 'Create test env',
      message: `Start a fresh environment with no library, settings, cloud saves or other app data. Only your F95zone session is copied. ${restartNote}`,
      confirmLabel: 'Create'
    })
    if (ok) await run(() => window.api.testEnv.create(), 'Could not create test env.')
  }

  async function switchTo(id: string | null): Promise<void> {
    const ok = await confirm({
      title: id ? 'Switch test env' : 'Return to main env',
      message: `${id ? `Switch to ${id}.` : 'Return to your main environment.'} ${restartNote}`,
      confirmLabel: id ? 'Switch' : 'Return'
    })
    if (ok) await run(() => window.api.testEnv.switchTo(id), 'Could not switch environment.')
  }

  async function remove(id: string): Promise<void> {
    const active = id === status.active
    const ok = await confirm({
      title: 'Delete test env',
      message: active
        ? `Delete ${id} and return to your main environment. ${restartNote}`
        : `Delete ${id} and all of its data.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    if (active) {
      await run(() => window.api.testEnv.remove(id), 'Could not delete test env.')
      return
    }
    setBusy(true)
    try {
      await window.api.testEnv.remove(id)
      setEnvs((list) => list.filter((env) => env.id !== id))
    } catch (err) {
      notifyCaught(err, 'Could not delete test env.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="settings-tab-body">
      <h2 className="settings-heading">Test environments</h2>
      <p className="muted settings-lead">
        Debug builds only. A test env is a separate app data folder: library, settings, cloud saves,
        downloads history and P2P state start empty. Your F95zone session is copied in when the env
        is created. Game save folders outside app data (for example Ren&apos;Py saves) are shared.
      </p>
      <div className="folder-field">
        <span className="filter-label">Current</span>
        <p className="download-meta">
          {status.active ? (
            <>
              Test env <strong>{status.active}</strong>
            </>
          ) : (
            'Main environment'
          )}
        </p>
        <div className="folder-path-row">
          <button className="primary-btn" type="button" disabled={busy} onClick={() => void create()}>
            Create new test env
          </button>
          {status.active ? (
            <>
              <button className="ghost-btn" type="button" disabled={busy} onClick={() => void switchTo(null)}>
                Return to main env
              </button>
              <button
                className="danger-btn"
                type="button"
                disabled={busy}
                onClick={() => void remove(status.active as string)}
              >
                Delete this env
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="folder-field">
        <span className="filter-label">Test envs</span>
        {envs.length ? (
          <ul className="external-library-list">
            {envs.map((env) => (
              <li key={env.id} className="folder-path-row test-env-row">
                <span className="test-env-name">
                  {env.id}
                  {env.id === status.active ? <span className="test-env-badge">Active</span> : null}
                </span>
                <span className="muted download-meta">{formatDateTime(env.createdAt)}</span>
                {env.id === status.active ? null : (
                  <button className="ghost-btn" type="button" disabled={busy} onClick={() => void switchTo(env.id)}>
                    Switch
                  </button>
                )}
                <button className="ghost-btn" type="button" disabled={busy} onClick={() => void remove(env.id)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted download-meta">No test envs yet.</p>
        )}
      </div>
    </div>
  )
}
