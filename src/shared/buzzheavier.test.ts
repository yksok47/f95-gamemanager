import { describe, expect, test } from 'bun:test'
import type { ConnectorFetch } from './connector'
import {
  buzzheavierDownloadUrl,
  buzzheavierDirectUrlFromResponse,
  buzzheavierIdFromUrl,
  isBuzzheavierChallengeBody,
  isBuzzheavierDirectUrl,
  isBuzzheavierPageUrl,
  resolveBuzzheavierFromFetch
} from './buzzheavier'

const redirectFetch =
  (location: string, url = 'https://buzzheavier.com/kwkqt9wacoeq/download'): ConnectorFetch =>
  async (input) =>
    ({
      ok: true,
      status: 302,
      url: url || String(input),
      headers: new Headers({ location }),
      text: async () => ''
    })

const htmlFetch =
  (body: string, status = 200, url = 'https://buzzheavier.com/kwkqt9wacoeq/download'): ConnectorFetch =>
  async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      url,
      headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
      text: async () => body
    })

describe('isBuzzheavierPageUrl', () => {
  test('matches file ids on every alias host', () => {
    expect(isBuzzheavierPageUrl('https://buzzheavier.com/kwkqt9wacoeq')).toBe(true)
    expect(isBuzzheavierPageUrl('https://bzzhr.to/kwkqt9wacoeq/download')).toBe(true)
    expect(buzzheavierIdFromUrl('https://bzzhr.co/kwkqt9wacoeq')).toBe('kwkqt9wacoeq')
    expect(buzzheavierDownloadUrl('https://buzzheavier.com/kwkqt9wacoeq')).toBe(
      'https://buzzheavier.com/kwkqt9wacoeq/download'
    )
  })

  test('rejects site chrome', () => {
    expect(isBuzzheavierPageUrl('https://buzzheavier.com/developers')).toBe(false)
    expect(isBuzzheavierPageUrl('https://buzzheavier.com/help')).toBe(false)
    expect(isBuzzheavierPageUrl('https://bzzhr.to/blog')).toBe(false)
  })
})

describe('isBuzzheavierDirectUrl', () => {
  const page = 'https://buzzheavier.com/kwkqt9wacoeq'

  test('accepts a CDN file and rejects the landing page', () => {
    expect(isBuzzheavierDirectUrl('https://cdn.example/Game.zip', page)).toBe(true)
    expect(isBuzzheavierDirectUrl(page, page)).toBe(false)
    expect(isBuzzheavierDirectUrl(`${page}/download`, page)).toBe(false)
  })
})

describe('buzzheavierDirectUrlFromResponse', () => {
  const page = 'https://buzzheavier.com/kwkqt9wacoeq'

  test('prefers HX-Redirect over a followed download URL', () => {
    expect(
      buzzheavierDirectUrlFromResponse(page, {
        status: 200,
        url: `${page}/download`,
        headers: new Headers({ 'hx-redirect': 'https://cdn.example/Game.zip' })
      })
    ).toBe('https://cdn.example/Game.zip')
  })

  test('uses the final URL when Chromium already followed the redirect', () => {
    expect(
      buzzheavierDirectUrlFromResponse(page, {
        status: 200,
        url: 'https://cdn.example/Game.zip',
        headers: new Headers({ 'content-type': 'application/octet-stream' })
      })
    ).toBe('https://cdn.example/Game.zip')
  })

  test('ignores Cloudflare challenge HTML', () => {
    const body = '<title>Just a moment...</title><script>window._cf_chl_opt={}</script>'
    expect(isBuzzheavierChallengeBody(body)).toBe(true)
    expect(
      buzzheavierDirectUrlFromResponse(
        page,
        {
          status: 403,
          url: `${page}/download`,
          headers: new Headers({ 'content-type': 'text/html' })
        },
        body
      )
    ).toBe(null)
  })
})

describe('resolveBuzzheavierFromFetch', () => {
  test('uses Location from /download', async () => {
    expect(
      await resolveBuzzheavierFromFetch(
        'https://buzzheavier.com/kwkqt9wacoeq',
        redirectFetch('https://cdn.example/Game.zip')
      )
    ).toBe('https://cdn.example/Game.zip')
  })

  test('uses the followed URL when Location is missing', async () => {
    expect(
      await resolveBuzzheavierFromFetch(
        'https://buzzheavier.com/kwkqt9wacoeq',
        redirectFetch('', 'https://cdn.example/Game.zip')
      )
    ).toBe('https://cdn.example/Game.zip')
  })

  test('ignores a redirect back to the landing page', async () => {
    expect(
      await resolveBuzzheavierFromFetch(
        'https://buzzheavier.com/kwkqt9wacoeq',
        redirectFetch('https://buzzheavier.com/kwkqt9wacoeq')
      )
    ).toBe(null)
  })

  test('gives up on a Cloudflare interstitial so a window fallback can run', async () => {
    expect(
      await resolveBuzzheavierFromFetch(
        'https://buzzheavier.com/kwkqt9wacoeq',
        htmlFetch('<title>Just a moment...</title>', 403)
      )
    ).toBe(null)
  })
})
