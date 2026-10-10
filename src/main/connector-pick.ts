import type { GameFileContext, OsKind } from '@shared/types'
import {
  decideConnectorFile,
  hostOsKind,
  requestedOsKind,
  toConnectorFileChoice,
  type ChooseDownloadFileRequest,
  type ConnectorFileChoice
} from '@shared/connector-files'
import { sendToRenderer } from './windows'

const pending = new Map<string, (index: number | null) => void>()

function nextId(): string {
  return `pick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function wantedOsFromContext(context?: GameFileContext): OsKind | null {
  return requestedOsKind(context?.packageHint?.os) ?? hostOsKind(process.platform)
}

export function resolveConnectorFileChoice(id: string, index: number | null): void {
  const settle = pending.get(id)
  if (!settle) return
  pending.delete(id)
  settle(index)
}

export async function askChooseDownloadFile(files: ConnectorFileChoice[]): Promise<number | null> {
  const id = nextId()
  const payload: ChooseDownloadFileRequest = { id, files }
  return new Promise((resolve) => {
    pending.set(id, resolve)
    sendToRenderer('downloads:choose-file', payload)
  })
}

/** Auto-pick a labeled OS build, or ask the user when the listing is ambiguous. */
export async function chooseListedFile<T extends { name?: string | null; size?: number }>(
  files: readonly T[],
  context?: GameFileContext
): Promise<T | 'cancel' | null> {
  const decision = decideConnectorFile(files, wantedOsFromContext(context))
  if (decision.kind === 'file') return decision.file
  if (!decision.files.length) return null
  const index = await askChooseDownloadFile(decision.files.map(toConnectorFileChoice))
  if (index == null || index < 0 || index >= decision.files.length) return 'cancel'
  return decision.files[index] ?? 'cancel'
}
