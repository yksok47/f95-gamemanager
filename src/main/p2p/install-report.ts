import type { PackageInstallTags } from '@shared/p2p'

export type InstallReportPayload = {
  seederPubkey: string
  ts: number
  signature: string
  tags?: PackageInstallTags | null
}

export function isMetadataNotFoundError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error)
  return /→ 404\b/.test(msg)
}

/**
 * Install reports require the package row to exist. HTTP/import approve posts
 * immediately while share-claim waits on torrent hashing, so a 404 is queued
 * and flushed after registerPackage succeeds.
 */
export function createInstallReportQueue(
  post: (contentHash: string, payload: InstallReportPayload) => Promise<void>
) {
  const pending = new Map<string, InstallReportPayload>()
  const inflight = new Map<string, Promise<void>>()

  async function flush(contentHash: string): Promise<void> {
    const current = inflight.get(contentHash)
    if (current) {
      await current
      return
    }

    let run!: Promise<void>
    run = (async () => {
      const payload = pending.get(contentHash)
      if (!payload) return
      try {
        await post(contentHash, payload)
        pending.delete(contentHash)
      } catch (error) {
        if (isMetadataNotFoundError(error)) return
        pending.delete(contentHash)
        throw error
      }
    })().finally(() => {
      if (inflight.get(contentHash) === run) inflight.delete(contentHash)
    })
    inflight.set(contentHash, run)
    await run
  }

  return {
    async report(contentHash: string, payload: InstallReportPayload): Promise<void> {
      const hash = contentHash.trim().toLowerCase()
      if (!hash) return
      pending.set(hash, payload)
      await flush(hash)
    },

    async onPackageRegistered(contentHash: string): Promise<void> {
      const hash = contentHash.trim().toLowerCase()
      if (!hash) return
      const current = inflight.get(hash)
      if (current) await current
      if (!pending.has(hash)) return
      await flush(hash)
    }
  }
}
