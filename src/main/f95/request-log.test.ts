import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clearF95RequestLog,
  F95_REQUEST_LOG_LIMIT,
  flushF95RequestLog,
  initF95RequestLog,
  listF95RequestLog,
  recordF95Request,
  shouldLogF95Request
} from './request-log'

afterEach(async () => {
  await initF95RequestLog(null)
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

describe('recordF95Request', () => {
  test('stores requests newest first and omits static URLs', () => {
    recordF95Request({
      method: 'get',
      url: 'https://f95zone.to/threads/1/',
      ok: true,
      status: 200
    })
    recordF95Request({
      method: 'GET',
      url: 'https://preview.f95zone.to/data/cover.jpg',
      ok: true,
      status: 200
    })
    recordF95Request({
      method: 'POST',
      url: 'https://f95zone.to/login/login',
      ok: false,
      status: 403
    })

    const items = listF95RequestLog()
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
    for (let i = 0; i < F95_REQUEST_LOG_LIMIT + 5; i++) {
      recordF95Request({
        method: 'GET',
        url: `https://f95zone.to/threads/${i}/`,
        ok: true,
        status: 200
      })
    }
    const items = listF95RequestLog()
    expect(items).toHaveLength(F95_REQUEST_LOG_LIMIT)
    expect(items[0]?.url).toBe(`https://f95zone.to/threads/${F95_REQUEST_LOG_LIMIT + 4}/`)
    expect(items[items.length - 1]?.url).toBe('https://f95zone.to/threads/5/')
  })
})

describe('initF95RequestLog', () => {
  test('writes the log to disk and wipes it on init', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'f95-request-log-'))
    const file = join(dir, 'f95-request-log.json')
    try {
      await initF95RequestLog(file)
      recordF95Request({
        method: 'GET',
        url: 'https://f95zone.to/threads/1/',
        ok: true,
        status: 200
      })
      await flushF95RequestLog()
      const saved = JSON.parse(await readFile(file, 'utf8')) as {
        entries: Array<{ url: string }>
      }
      expect(saved.entries).toHaveLength(1)
      expect(saved.entries[0]?.url).toBe('https://f95zone.to/threads/1/')

      await initF95RequestLog(file)
      expect(listF95RequestLog()).toEqual([])
      const wiped = JSON.parse(await readFile(file, 'utf8')) as { entries: unknown[] }
      expect(wiped.entries).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('clear empties the file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'f95-request-log-'))
    const file = join(dir, 'f95-request-log.json')
    try {
      await initF95RequestLog(file)
      recordF95Request({
        method: 'GET',
        url: 'https://f95zone.to/threads/1/',
        ok: true,
        status: 200
      })
      await flushF95RequestLog()
      await clearF95RequestLog()
      const saved = JSON.parse(await readFile(file, 'utf8')) as { entries: unknown[] }
      expect(saved.entries).toEqual([])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
