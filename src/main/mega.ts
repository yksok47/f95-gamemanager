import type { Readable } from 'stream'
import type { GameFileContext } from '@shared/types'
import { isMegaPageUrl, listMegaFiles, parseMegaLink } from '@shared/mega'
import { chooseListedFile } from './connector-pick'
import type { ConnectorDownloadResult } from './download-connectors'
import { startStreamDownload } from './downloads'
import { loadMegaShare, megaStorageUrl, sleep, type MegaShareFile } from './mega-api'
import { createMegaChunkStream, type MegaRangeFetch } from './mega-download'

export { isMegaPageUrl }

const RANGE_TRIES = 8
/** A range request that receives nothing for this long is dropped and retried. */
const STALL_MS = 30_000

class MegaQuotaError extends Error {}

/** Storage URLs expire, so HTTP errors fetch a new one before retrying. */
class MegaStorageError extends Error {}

async function fetchRange(url: string, expected: number, signal: AbortSignal): Promise<Buffer> {
  const stall = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const arm = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => stall.abort(new Error('MEGA connection stalled')), STALL_MS)
  }
  arm()
  try {
    const res = await fetch(url, { signal: AbortSignal.any([signal, stall.signal]) })
    if (res.status === 509) {
      void res.body?.cancel()
      const left = Number(res.headers.get('x-mega-time-left'))
      const wait = left > 0 ? ` (try again in ${Math.ceil(left / 60)} min)` : ''
      throw new MegaQuotaError(`MEGA transfer quota exceeded${wait}`)
    }
    if (!res.ok || !res.body) {
      void res.body?.cancel()
      throw new MegaStorageError(`MEGA storage returned ${res.status}`)
    }
    const parts: Uint8Array[] = []
    let length = 0
    const reader = res.body.getReader()
    for (;;) {
      arm()
      const { done, value } = await reader.read()
      if (done) break
      parts.push(value)
      length += value.length
    }
    if (length !== expected) throw new Error(`MEGA sent ${length} of ${expected} bytes`)
    return Buffer.concat(parts, length)
  } finally {
    clearTimeout(timer)
  }
}

function rangeFetcher(file: MegaShareFile): MegaRangeFetch {
  let storage: Promise<string> | null = null
  return async (start, end, signal) => {
    for (let tries = 1; ; tries += 1) {
      const pending = (storage ??= megaStorageUrl(file))
      try {
        const base = await pending.catch((error: unknown) => {
          throw new MegaStorageError(String(error))
        })
        return await fetchRange(`${base}/${start}-${end}`, end - start + 1, signal)
      } catch (error) {
        if (signal.aborted || error instanceof MegaQuotaError || tries >= RANGE_TRIES) throw error
        if (error instanceof MegaStorageError && storage === pending) storage = null
        await sleep(Math.min(500 * 2 ** (tries - 1), 10_000), signal)
      }
    }
  }
}

function megaFileStream(file: MegaShareFile, start: number): Readable {
  return createMegaChunkStream({
    key: file.key,
    size: file.size,
    start,
    fetchRange: rangeFetcher(file)
  })
}

export async function resolveMegaDownload(
  pageUrl: string,
  context?: GameFileContext
): Promise<ConnectorDownloadResult> {
  const link = parseMegaLink(pageUrl)
  if (!link) return null
  try {
    const root = await loadMegaShare(link)
    const files = listMegaFiles(root).filter((file) => !file.directory) as MegaShareFile[]
    const picked = await chooseListedFile(files, context)
    if (picked === 'cancel') return 'cancel'
    if (!picked) return null
    startStreamDownload({
      filename: picked.name || 'download',
      url: pageUrl,
      totalBytes: picked.size,
      context,
      open: (start) => megaFileStream(picked, start)
    })
    return 'started'
  } catch (error) {
    console.warn('[mega] could not start download', error)
    return null
  }
}
