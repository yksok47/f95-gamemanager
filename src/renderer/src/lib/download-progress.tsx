import { createContext, useContext, type JSX, type ReactNode } from 'react'
import type { ThreadDownloadProgress } from './downloads'

const DownloadProgressContext = createContext<Map<number, ThreadDownloadProgress>>(new Map())

export function DownloadProgressProvider({
  value,
  children
}: {
  value: Map<number, ThreadDownloadProgress>
  children: ReactNode
}): JSX.Element {
  return <DownloadProgressContext.Provider value={value}>{children}</DownloadProgressContext.Provider>
}

export function usePendingDownloads(): Map<number, ThreadDownloadProgress> {
  return useContext(DownloadProgressContext)
}

export function useGameDownloadProgress(threadId: number): ThreadDownloadProgress | undefined {
  return useContext(DownloadProgressContext).get(threadId)
}
