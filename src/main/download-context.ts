import type { WebContents } from 'electron'
import type { GameFileContext } from '@shared/types'

const byContents = new Map<number, GameFileContext>()
let lastContext: { context: GameFileContext; at: number } | null = null

const LAST_CONTEXT_MS = 15 * 60 * 1000

export function setDownloadContext(contentsId: number, context: GameFileContext): void {
  byContents.set(contentsId, context)
  lastContext = { context, at: Date.now() }
}

export function clearDownloadContext(contentsId: number): void {
  byContents.delete(contentsId)
}

export function getDownloadContext(contents?: WebContents | null): GameFileContext | undefined {
  if (contents && !contents.isDestroyed()) {
    const direct = byContents.get(contents.id)
    if (direct) return direct
  }
  if (lastContext && Date.now() - lastContext.at < LAST_CONTEXT_MS) {
    return lastContext.context
  }
  return undefined
}
