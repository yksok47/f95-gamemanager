import { session } from 'electron'

/** Hosts that serve catalog covers / screenshots (not the main forum HTML). */
export const F95_CDN_FILTER = {
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
 * Catalog JSON goes through session.fetch (cookies + Referer). Cover / gallery
 * <img> tags load the CDN directly from the renderer (localhost origin), so this
 * rewrites Referer to a first-party F95 URL that the attachments host accepts.
 */
export function registerF95CdnRequestHeaders(): void {
  if (registered) return
  registered = true

  session.defaultSession.webRequest.onBeforeSendHeaders(F95_CDN_FILTER, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders }
    // Rewrite whatever the renderer would send (vite / file:// / empty) to a first-party F95 Referer.
    requestHeaders.Referer = F95_REFERER
    callback({ requestHeaders })
  })
}