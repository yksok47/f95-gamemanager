import { useEffect, useState } from 'react'
import type { FollowSyncStatus } from '@shared/types'

export function useFollowSyncStatus(): FollowSyncStatus | null {
  const [sync, setSync] = useState<FollowSyncStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.subscriptions.syncStatus().then((next) => {
      if (!cancelled) setSync(next)
    })
    const stop = window.api.subscriptions.onSyncStatus(setSync)
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  return sync
}
