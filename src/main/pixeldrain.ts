import type { GameFileContext } from '@shared/types'
import { isPixeldrainPageUrl, resolvePixeldrainFromFetch } from '@shared/pixeldrain'
import { chooseListedFile } from './connector-pick'
import { sessionFetch } from './connector-session'

export { isPixeldrainPageUrl }

export async function resolvePixeldrainDownload(
  pageUrl: string,
  context?: GameFileContext
): Promise<string | 'cancel' | null> {
  if (!isPixeldrainPageUrl(pageUrl)) return null
  try {
    const resolved = await resolvePixeldrainFromFetch(pageUrl, sessionFetch())
    if (typeof resolved === 'string' || resolved == null) return resolved
    const picked = await chooseListedFile(resolved, context)
    if (picked === 'cancel') return 'cancel'
    return picked?.url ?? null
  } catch (error) {
    console.warn('[pixeldrain] could not resolve download URL', error)
    return null
  }
}
