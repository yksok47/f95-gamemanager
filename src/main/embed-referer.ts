/**
 * Packaged Electron loads the UI from file://. YouTube (and similar players)
 * reject that as Error 153. Dev serve uses http://localhost, which they accept.
 */

export const EMBED_REQUEST_URL_FILTER = {
  urls: [
    'https://youtube.com/*',
    'https://*.youtube.com/*',
    'https://youtube-nocookie.com/*',
    'https://*.youtube-nocookie.com/*',
    'https://youtu.be/*',
    'https://*.ytimg.com/*',
    'https://*.googlevideo.com/*',
    'https://jnn-pa.googleapis.com/*',
    'https://youtubei.googleapis.com/*',
    'https://player.vimeo.com/*',
    'https://*.vimeo.com/*',
    'https://*.vimeocdn.com/*',
    'https://geo.dailymotion.com/*',
    'https://*.dailymotion.com/*',
    'https://*.dmcdn.net/*',
    'https://streamable.com/*',
    'https://*.streamable.com/*',
    'https://odysee.com/*',
    'https://*.odysee.com/*'
  ]
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

function hostEndsWith(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`)
}

export function embedRefererForUrl(url: string): string {
  const host = hostname(url)
  if (hostEndsWith(host, 'vimeo.com') || hostEndsWith(host, 'vimeocdn.com')) {
    return 'https://player.vimeo.com/'
  }
  if (hostEndsWith(host, 'dailymotion.com') || hostEndsWith(host, 'dmcdn.net')) {
    return 'https://www.dailymotion.com/'
  }
  if (hostEndsWith(host, 'streamable.com')) return 'https://streamable.com/'
  if (hostEndsWith(host, 'odysee.com')) return 'https://odysee.com/'
  return 'https://www.youtube.com/'
}

/** file:// (packaged) and missing/null. Keep http(s) so Vite serve and forum pages stay as-is. */
export function shouldSpoofEmbedClientHint(value: string | undefined): boolean {
  if (!value || value === 'null') return true
  try {
    const protocol = new URL(value).protocol
    return protocol !== 'http:' && protocol !== 'https:'
  } catch {
    return true
  }
}

function header(headers: Record<string, string>, name: string): string | undefined {
  const needle = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === needle) return value
  }
  return undefined
}

function setHeader(headers: Record<string, string>, name: string, value: string): void {
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) delete headers[key]
  }
  headers[name] = value
}

export function applyEmbedRequestHeaders(
  headers: Record<string, string>,
  url: string
): Record<string, string> {
  const next = { ...headers }
  if (shouldSpoofEmbedClientHint(header(next, 'Referer'))) {
    setHeader(next, 'Referer', embedRefererForUrl(url))
  }
  return next
}
