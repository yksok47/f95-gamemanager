import { useEffect, useState } from 'react'

/** Wait this long before showing a spinner so short loads never flash. */
export const SPINNER_SHOW_DELAY_MS = 200

export function useDelayedBusy(busy: boolean, delayMs = SPINNER_SHOW_DELAY_MS): boolean {
  const [shown, setShown] = useState(false)

  useEffect(() => {
    if (!busy) {
      setShown(false)
      return
    }
    const timer = window.setTimeout(() => setShown(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [busy, delayMs])

  return shown
}
