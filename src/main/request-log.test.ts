import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearRequestLog,
  REQUEST_LOG_LIMIT,
  flushRequestLog,
  initRequestLog,
  listRequestLog,
  getRequestLogDetail,
  recordRequest,
  shouldLogF95Request
} from './request-log'

afterEach(async () => {
  await initRequestLog(null)
})

describe('shouldLogF95Request', () => {
  test('keeps forum HTML and API calls', () => {
    expect(shouldLogF95Request('https://f95zone.to/threads/1/')).toBe(true)
    expect(shouldLogF95Request('https://f95zone.to/sam/latest_alpha/latest_data.php?cmd=list')).toBe(
      true
    )
    expect(shouldLogF95Request('https://f95zone.to/login/login')).toBe(true)
    expect(shouldLogF95Request('https://www.f95zone.to/watched/threads')).toBe(true)
  })

  test('skips static files and CDN images', () => {
    expect(shouldLogF95Request('https://preview.f95zone.to/data/cover.jpg')).toBe(false)
    expect(shouldLogF95Request('https://attachments.f95zone.to/data/shot.png')).toBe(false)
    expect(shouldLogF95Request('https://f95zone.to/styles/default/xenforo.css')).toBe(false)
    expect(shouldLogF95Request('https://f95zone.to/js/xf/core.js')).toBe(false)
    expect(shouldLogF95Request('https://f95zone.to/data/avatars/l/1/1.jpg?v=2')).toBe(false)
  })

  test('skips other hosts', () => {
    expect(shouldLogF95Request('https://example.com/threads/1/')).toBe(false)
  })
})

describe('recordRequest', () => {
  test('stores requests newest first and omits static URLs', () => {
    recordRequest({
      service: 'f95zone',
      method: 'get',
      url: 'https://f95zone.to/threads/1/',
      ok: true,
      status: 200
    })
    recordRequest({
      service: 'f95zone',
      method: 'GET',
      url: 'https://preview.f95zone.to/data/cover.jpg',
      ok: true,
      status: 200
    })
    recordRequest({
      service: 'f95zone',
      method: 'POST',
      url: 'https://f95zone.to/login/login',
      ok: false,
      status: 403
    })

    const items = listRequestLog()
    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      method: 'POST',
      url: 'https://f95zone.to/login/login',
      ok: false,
      status: 403
    })
    expect(items[1]).toMatchObject({
      method: 'GET',
      url: 'https://f95zone.to/threads/1/',
      ok: true,
      status: 200
    })
  })

  test('drops oldest entries past the cap', () => {
    for (let i = 0; i < REQUEST_LOG_LIMIT + 5; i++) {
      recordRequest({
        service: 'f95zone',
        method: 'GET',
        url: `https://f95zone.to/threads/${i}/`,
        ok: true,
        status: 200
      })
    }
    const items = listRequestLog()
    expect(items).toHaveLength(REQUEST_LOG_LIMIT)
    expect(items[0]?.url).toBe(`https://f95zone.to/threads/${REQUEST_LOG_LIMIT + 4}/`)
    expect(items[items.length - 1]?.url).toBe('https://f95zone.to/threads/5/')
  })
})

describe('getRequestLogDetail', () => {
  test('keeps headers and bodies and hides secrets', () => {
    recordRequest({
      service: 'f95zone',
      method: 'POST',
      url: 'https://f95zone.to/login/login',
      ok: true,
      status: 200,
      startedAt: Date.now() - 25,
      requestHeaders: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Cookie: 'xf_user=abc'
      },
      requestBody: 'login=me&password=hunter2&_xfToken=tok&remember=1',
      responseHeaders: new Headers({ 'content-type': 'text/html', 'set-cookie': 'xf_user=abc' }),
      responseBody: '<html>ok</html>'
    })
    const [entry] = listRequestLog()
    const detail = getRequestLogDetail(entry!.id)
    expect(detail?.durationMs).toBeGreaterThanOrEqual(0)
    expect(detail?.requestHeaders).toContainEqual({ name: 'cookie', value: '[hidden]' })
    expect(detail?.responseHeaders).toContainEqual({ name: 'set-cookie', value: '[hidden]' })
    const sent = new URLSearchParams(detail?.requestBody?.text)
    expect(sent.get('login')).toBe('me')
    expect(sent.get('password')).toBe('[hidden]')
    expect(sent.get('_xfToken')).toBe('[hidden]')
    expect(detail?.responseBody).toEqual({ text: '<html>ok</html>', size: 15, truncated: false })
  })

  test('pretty-prints JSON bodies and records failures', () => {
    recordRequest({
      service: 'metadata',
      method: 'POST',
      url: 'https://metadata.test/api/v1/links',
      ok: false,
      error: new Error('connect ECONNREFUSED'),
      requestHeaders: { 'content-type': 'application/json' },
      requestBody: JSON.stringify({ url: 'https://mega.nz/file/x', signature: 'sig' })
    })
    const [entry] = listRequestLog()
    expect(entry).toMatchObject({ service: 'metadata', ok: false, error: 'connect ECONNREFUSED' })
    const detail = getRequestLogDetail(entry!.id)
    expect(detail?.requestBody?.text).toBe(
      JSON.stringify({ url: 'https://mega.nz/file/x', signature: 'sig' }, null, 2)
    )
    expect(detail?.responseBody).toBeNull()
  })

  test('logs metadata requests for any host', () => {
    recordRequest({ service: 'metadata', url: 'https://130.61.67.157:6767/health', ok: true, status: 200 })
    expect(listRequestLog()).toHaveLength(1)
  })
})

describe('initRequestLog', () => {
  test('writes the log to disk and wipes it on init', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'request-log-'))
    const file = join(dir, 'request-log.json')
    try {
      await initRequestLog(file)
      recordRequest({
        service: 'f95zone',
        method: 'GET',
        url: 'https://f95zone.to/threads/1/',
        ok: true,
        status: 200
      })
      await flushRequestLog()
      const saved = JSON.parse(await readFile(file, 'utf8')) as {
        entries: Array<{ url: string }>
      }
      expect(saved.entries).toHaveLength(1)
      expect(saved.entries[0]?.url).toBe('https://f95zone.to/threads/1/')

      await initRequestLog(file)
      expect(listRequestLog()).toEqual([])
      const wiped = JSON.parse(await readFile(file, 'utf8')) as { entries: unknown[] }
      expect(wiped.entries).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('clear empties the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'request-log-'))
    const file = join(dir, 'request-log.json')
    try {
      await initRequestLog(file)
      recordRequest({
        service: 'f95zone',
        method: 'GET',
        url: 'https://f95zone.to/threads/1/',
        ok: true,
        status: 200
      })
      await flushRequestLog()
      await clearRequestLog()
      const saved = JSON.parse(await readFile(file, 'utf8')) as { entries: unknown[] }
      expect(saved.entries).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
