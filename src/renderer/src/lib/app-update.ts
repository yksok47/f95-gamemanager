import { useEffect, useState } from 'react'
import type { AppUpdateStatus } from '@shared/app-update'
import { emptyAppUpdateStatus } from '@shared/app-update'

export function useAppUpdate(): AppUpdateStatus {
  const [status, setStatus] = useState<AppUpdateStatus>(() => emptyAppUpdateStatus('…', 'dev', false))

  useEffect(() => {
    let cancelled = false
    void window.api.appUpdate.get().then((next) => {
      if (!cancelled) setStatus(next)
    })
    const stop = window.api.appUpdate.onChange(setStatus)
    return () => {
      cancelled = true
      stop()
    }
  }, [])

  return status
}
