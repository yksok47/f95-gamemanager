import { useState } from 'react'

export const GROUP_BY_UPDATE_DATE_KEY = 'group-by-update-date'

export function readGroupByUpdateDate(): boolean {
  try {
    return window.localStorage.getItem(GROUP_BY_UPDATE_DATE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeGroupByUpdateDate(enabled: boolean): void {
  try {
    window.localStorage.setItem(GROUP_BY_UPDATE_DATE_KEY, enabled ? '1' : '0')
  } catch {
    /* ignore quota / private-mode failures */
  }
}

export function useGroupByUpdateDate(): [boolean, () => void] {
  const [enabled, setEnabled] = useState(readGroupByUpdateDate)
  function toggle(): void {
    setEnabled((current) => {
      const next = !current
      writeGroupByUpdateDate(next)
      return next
    })
  }
  return [enabled, toggle]
}
