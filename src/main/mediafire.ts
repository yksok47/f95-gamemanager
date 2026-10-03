import { session } from 'electron'
import {
  isMediaFireCdnUrl,
  isMediaFirePageUrl,
  mediaFireDirectUrlFromHtml
} from '@shared/mediafire'

export { isMediaFireCdnUrl, isMediaFirePageUrl }

/** Fetch the interstitial and pull the CDN URL without opening a guest window. */
export async function resolveMediaFireDownload(pageUrl: string): Promise<string | null> {
  if (!isMediaFirePageUrl(pageUrl)) return null
  try {
    const response = await session.defaultSession.fetch(pageUrl, {
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': session.defaultSession.getUserAgent()
      }
    })
    if (isMediaFireCdnUrl(response.url)) return response.url
    const html = await response.text()
    return mediaFireDirectUrlFromHtml(html)
  } catch (error) {
    console.warn('[mediafire] could not resolve download URL', error)
    return null
  }
}
