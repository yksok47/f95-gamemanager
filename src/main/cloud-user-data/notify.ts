export type UserDataChangeReason = 'settings' | 'data' | 'playtime'

type ChangeHandler = (reason: UserDataChangeReason) => void
type EnabledHandler = (enabled: boolean) => void
type SessionHandler = () => void

let applying = 0
let localChanges = 0
let onChange: ChangeHandler | null = null
let onEnabled: EnabledHandler | null = null
let onSession: SessionHandler | null = null

export function setUserDataSyncHandlers(handlers: {
  onChange: ChangeHandler
  onEnabled: EnabledHandler
  onSession: SessionHandler
}): void {
  onChange = handlers.onChange
  onEnabled = handlers.onEnabled
  onSession = handlers.onSession
}

export function beginApplyingCloudUserData(): void {
  applying += 1
}

export function endApplyingCloudUserData(): void {
  applying = Math.max(0, applying - 1)
}

/** Bumped on every local user edit so an in-flight sync can tell its snapshot went stale. */
export function markLocalUserDataChange(): void {
  if (applying) return
  localChanges += 1
}

export function localUserDataChangeCount(): number {
  return localChanges
}

export function notifyUserDataChanged(reason: UserDataChangeReason): void {
  if (applying) return
  if (reason !== 'playtime') localChanges += 1
  onChange?.(reason)
}

export function notifyUserDataEnabled(enabled: boolean): void {
  onEnabled?.(enabled)
}

export function notifyUserDataSession(): void {
  onSession?.()
}
