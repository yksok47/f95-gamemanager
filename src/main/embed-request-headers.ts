import { session } from 'electron'
import { applyEmbedRequestHeaders, EMBED_REQUEST_URL_FILTER } from './embed-referer'

let registered = false

/** YouTube rejects file:// embeds. Same idea as the F95 CDN Referer rewrite. */
export function registerEmbedRequestHeaders(): void {
  if (registered) return
  registered = true

  session.defaultSession.webRequest.onBeforeSendHeaders(EMBED_REQUEST_URL_FILTER, (details, callback) => {
    callback({ requestHeaders: applyEmbedRequestHeaders(details.requestHeaders, details.url) })
  })
}
