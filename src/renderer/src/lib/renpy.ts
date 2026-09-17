import { useEffect, useMemo, useState } from 'react'
import type { GameLibraryFile, RenpyInfo, RenpyStatus } from '@shared/types'
import { notifyError } from '../components/ErrorNotifications'

export function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

type UseRenpySessionOptions = {
  prepare?: boolean
  title?: string
  threadId?: number
  installedOnly?: boolean
}

export function useRenpySession(files: GameLibraryFile[], options: UseRenpySessionOptions = {}) {
  const prepare = options.prepare ?? false
  const fallbackTitle = options.title || ''
  const threadId = options.threadId || 0
  const installed = useMemo(() => files.filter((file) => file.isInstalled), [files])
  const sources = options.installedOnly || installed.length ? installed : files
  const [fileId, setFileId] = useState(sources[0]?.id || '')
  const [info, setInfo] = useState<RenpyInfo | null>(null)
  const [status, setStatus] = useState<RenpyStatus | null>(null)
  const [error, setErrorState] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function setError(message: string | null): void {
    setErrorState(message)
    if (message) notifyError(message)
  }

  const selected = sources.find((file) => file.id === fileId) || sources[0] || null
  const activeId = selected?.id || ''
  const lookupTitle = fallbackTitle || selected?.title || ''
  const running = Boolean(status?.running && (!status.fileId || status.fileId === activeId))

  useEffect(() => {
    if (selected?.id && selected.id !== fileId) setFileId(selected.id)
  }, [selected?.id, fileId])

  useEffect(() => {
    const stop = window.api.renpy.onStatus((next) => {
      if (!activeId || next.fileId === activeId) setStatus(next)
    })
    return stop
  }, [activeId])

  useEffect(() => {
    if (!activeId && !lookupTitle && !threadId) {
      setInfo(null)
      setError(null)
      return
    }
    let cancelled = false
    setBusy(true)
    setError(null)
    void window.api.renpy
      .info(activeId, prepare, lookupTitle, threadId)
      .then((next) => {
        if (cancelled) return
        setInfo(next)
        if (next.lastRun?.error) setErrorState(next.lastRun.error)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not read Ren'Py data.")
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [activeId, prepare, lookupTitle, threadId])

  async function withInfo(work: () => Promise<RenpyInfo>): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      const next = await work()
      setInfo(next)
      if (next.lastRun?.error) setError(next.lastRun.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ren'Py action failed.")
    } finally {
      setBusy(false)
    }
  }

  return {
    installed,
    selected,
    activeId,
    lookupTitle,
    threadId,
    setFileId,
    info,
    status,
    error,
    setError,
    busy,
    running,
    withInfo
  }
}
