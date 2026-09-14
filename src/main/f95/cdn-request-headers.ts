import { session } from 'electron'

/** Hosts that serve catalog covers / screenshots (not the main forum HTML). */
const CDN_FILTER = {
  urls: [
    'https://preview.f95zone.to/*',
    'https://preview.f95zone.com/*',
    'https://preview.f95zone.ninja/*',
    'https://attachments.f95zone.to/*',
    'https://attachments.f95zone.com/*',
    'https://attachments.f95zone.ninja/*'
  ]
}

const F95_REFERER = 'https://f95zone.to/'

let registered = false

/**
 * Catalog JSON goes through session.fetch (cookies + Referer). Cover <img> tags do not —
 * they hit the preview/attachments CDN from the renderer with referrerPolicy=no-referrer,
 * so Cloudflare / hotlink checks often see a blank Referer and block only thumbnails.
 * Force a first-party F95 Referer on those CDN requests (and keep the session UA).
 */
export function registerF95CdnRequestHeaders(): void {
  if (registered) return
  registered = true

  session.defaultSession.webRequest.onBeforeSendHeaders(CDN_FILTER, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders }
    // Rewrite whatever the renderer would send (vite / file:// / empty) to a first-party F95 Referer.
    requestHeaders.Referer = F95_REFERER
    callback({ requestHeaders })
  })
}