import { describe, expect, test } from 'bun:test'
import type { ConnectorFetch } from './connector'
import {
  MIXDROP_RECAPTCHA_SITE_KEY,
  isMixdropChallengeBody,
  isMixdropDirectUrl,
  isMixdropHost,
  isMixdropMissingBody,
  isMixdropPageUrl,
  mixdropCsrfFromHtml,
  mixdropDirectUrlFromBody,
  mixdropGenticketBody,
  mixdropIdFromUrl,
  mixdropPageUrl,
  mixdropRecaptchaSiteKeyFromHtml,
  resolveMixdropFromFetch
} from './mixdrop'

const jsonFetch =
  (body: string, location?: string, url?: string): ConnectorFetch =>
  async (input) =>
    ({
      ok: true,
      status: location ? 302 : 200,
      url: url || String(input),
      headers: new Headers(
        location ? { location } : { 'content-type': 'application/json' }
      ),
      text: async () => body
    })

const htmlThenJson =
  (html: string, json: string, landingUrl?: string): ConnectorFetch =>
  async (input, init) => {
    if (init?.method === 'POST') {
      return {
        ok: true,
        status: 200,
        url: String(input),
        headers: new Headers({ 'content-type': 'application/json' }),
        text: async () => json
      }
    }
    return {
      ok: true,
      status: 200,
      url: landingUrl || String(input),
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => html
    }
  }

describe('isMixdropPageUrl', () => {
  test('reads the file id from /f/ and /e/ on alias hosts', () => {
    expect(isMixdropPageUrl('https://mixdrop.ag/f/dkqg74xefzmn7l')).toBe(true)
    expect(isMixdropPageUrl('https://mixdrop.top/e/dkqg74xefzmn7l')).toBe(true)
    expect(mixdropIdFromUrl('https://www.mxdrop.top/f/dkqg74xefzmn7l')).toBe('dkqg74xefzmn7l')
    expect(mixdropPageUrl('https://mixdrop.ag/e/dkqg74xefzmn7l')).toBe(
      'https://mixdrop.ag/f/dkqg74xefzmn7l'
    )
    expect(isMixdropHost('mxdrop.top')).toBe(true)
    expect(isMixdropHost('miixdrop.net')).toBe(true)
  })

  test('rejects site chrome', () => {
    expect(isMixdropPageUrl('https://mixdrop.ag/faq')).toBe(false)
    expect(isMixdropPageUrl('https://mixdrop.ag/news')).toBe(false)
    expect(isMixdropPageUrl('https://mixdrop.ag/panel/')).toBe(false)
    expect(isMixdropPageUrl('https://example.com/f/abc')).toBe(false)
  })
})

describe('isMixdropDirectUrl', () => {
  test('accepts CDN URLs and rejects landing pages', () => {
    expect(isMixdropDirectUrl('https://a-delivery46.mxcontent.net/v2/abc.rar?s=1')).toBe(true)
    expect(isMixdropDirectUrl('https://cdn.example/Game.zip')).toBe(true)
    expect(isMixdropDirectUrl('https://mixdrop.ag/f/dkqg74xefzmn7l')).toBe(false)
    expect(isMixdropDirectUrl('https://mxdrop.top/e/dkqg74xefzmn7l')).toBe(false)
  })
})

describe('mixdrop html helpers', () => {
  test('reads csrf and recaptcha site key', () => {
    const html = `
      <meta name="csrf" content="abc123">
      <script src="https://www.google.com/recaptcha/api.js?render=site-key-9"></script>
    `
    expect(mixdropCsrfFromHtml(html)).toBe('abc123')
    expect(mixdropRecaptchaSiteKeyFromHtml(html)).toBe('site-key-9')
    expect(mixdropRecaptchaSiteKeyFromHtml('<html></html>')).toBe(MIXDROP_RECAPTCHA_SITE_KEY)
  })

  test('reads the genticket JSON URL', () => {
    expect(mixdropDirectUrlFromBody('{"url":"https://cdn.example/Game.rar"}')).toBe(
      'https://cdn.example/Game.rar'
    )
    expect(mixdropDirectUrlFromBody('{"msg":"captcha"}')).toBe(null)
    expect(mixdropGenticketBody('csrf-1', 'tok')).toBe('csrf=csrf-1&token=tok&a=genticket')
  })

  test('detects Cloudflare and missing-file pages', () => {
    expect(isMixdropChallengeBody('<title>Just a moment...</title>')).toBe(true)
    expect(isMixdropMissingBody("WE ARE SORRY We can't find the video you are looking for.")).toBe(
      true
    )
  })
})

describe('resolveMixdropFromFetch', () => {
  test('posts genticket after the landing page', async () => {
    expect(
      await resolveMixdropFromFetch(
        'https://mixdrop.ag/f/dkqg74xefzmn7l',
        htmlThenJson(
          '<meta name="csrf" content="csrf-1">',
          '{"url":"https://cdn.example/Game.rar"}',
          'https://mxdrop.top/f/dkqg74xefzmn7l'
        )
      )
    ).toBe('https://cdn.example/Game.rar')
  })

  test('follows a genticket redirect', async () => {
    const fetchImpl: ConnectorFetch = async (input, init) => {
      if (init?.method === 'POST') {
        return {
          ok: true,
          status: 302,
          url: String(input),
          headers: new Headers({ location: 'https://cdn.example/Game.rar' }),
          text: async () => ''
        }
      }
      return {
        ok: true,
        status: 200,
        url: String(input),
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<meta name="csrf" content="csrf-1">'
      }
    }
    expect(await resolveMixdropFromFetch('https://mixdrop.ag/e/dkqg74xefzmn7l', fetchImpl)).toBe(
      'https://cdn.example/Game.rar'
    )
  })

  test('gives up on a Cloudflare interstitial so a window fallback can run', async () => {
    expect(
      await resolveMixdropFromFetch(
        'https://mixdrop.ag/f/dkqg74xefzmn7l',
        jsonFetch('<title>Just a moment...</title>', undefined, 'https://mixdrop.ag/f/dkqg74xefzmn7l')
      )
    ).toBe(null)
  })

  test('does not treat the file page as the download', async () => {
    expect(
      await resolveMixdropFromFetch(
        'https://mixdrop.ag/f/dkqg74xefzmn7l',
        htmlThenJson('<meta name="csrf" content="csrf-1">', '{"url":"https://mixdrop.ag/f/dkqg74xefzmn7l"}')
      )
    ).toBe(null)
  })
})
