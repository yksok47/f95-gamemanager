import { describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import type { ConnectorFetch } from './connector'
import {
  isWorkuploadPageUrl,
  resolveWorkuploadFromFetch,
  solveWorkuploadPuzzle,
  workuploadDirectUrlFromBody,
  workuploadPuzzleFromBody,
  workuploadTargetFromUrl
} from './workupload'

const pagesFetch =
  (pages: Record<string, string>): ConnectorFetch =>
  async (input) => {
    const url = String(input)
    const body = Object.entries(pages).find(([key]) => url.includes(key))?.[1] ?? '{}'
    return {
      ok: true,
      status: 200,
      url,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => body
    }
  }

describe('isWorkuploadPageUrl', () => {
  test('matches file and archive pages', () => {
    expect(isWorkuploadPageUrl('https://workupload.com/file/HhUs4hP3E7G')).toBe(true)
    expect(isWorkuploadPageUrl('https://www.workupload.com/archive/abc')).toBe(true)
    expect(workuploadTargetFromUrl('https://workupload.com/file/HhUs4hP3E7G')).toEqual({
      kind: 'file',
      id: 'HhUs4hP3E7G'
    })
  })
})

describe('workuploadDirectUrlFromBody', () => {
  test('reads data.url', () => {
    expect(
      workuploadDirectUrlFromBody('{"data":{"url":"https://s1.workupload.com/token/Game.zip"}}')
    ).toBe('https://s1.workupload.com/token/Game.zip')
  })
})

describe('solveWorkuploadPuzzle', () => {
  test('finds every index whose hash is wanted, in order', () => {
    const sha = (input: string) => createHash('sha256').update(input).digest('hex')
    const puzzle = workuploadPuzzleFromBody(
      JSON.stringify({
        success: true,
        data: { puzzle: 'abc', range: 100, find: [sha('abc42'), sha('abc7')] }
      })
    )
    expect(puzzle).not.toBeNull()
    expect(solveWorkuploadPuzzle(puzzle!, sha)).toBe('7 42 ')
  })

  test('gives up when a hash is out of range', () => {
    const sha = (input: string) => createHash('sha256').update(input).digest('hex')
    expect(solveWorkuploadPuzzle({ puzzle: 'abc', range: 5, find: [sha('abc9')] }, sha)).toBeNull()
  })
})

describe('resolveWorkuploadFromFetch', () => {
  test('passes the human check before calling the API', async () => {
    const sha = (input: string) => createHash('sha256').update(input).digest('hex')
    const calls: string[] = []
    let passed = false
    const fetchImpl: ConnectorFetch = async (input, init) => {
      const url = String(input)
      calls.push(`${init?.method ?? 'GET'} ${new URL(url).pathname}`)
      let body = '{}'
      if (url.endsWith('/puzzle')) {
        body = JSON.stringify({ data: { puzzle: 'p', range: 50, find: [sha('p3')] } })
      } else if (url.endsWith('/captcha')) {
        passed = init?.body === 'captcha=3+'
      } else if (url.includes('getDownloadServer')) {
        body = passed ? '{"data":{"url":"https://f1.workupload.com/download/abc"}}' : '{"success":false}'
      } else {
        body = passed ? '<html>file</html>' : '<title>workupload - Are you a human?</title>'
      }
      return { ok: true, status: 200, url, headers: new Headers(), text: async () => body }
    }
    const resolved = await resolveWorkuploadFromFetch(
      'https://workupload.com/file/abc',
      fetchImpl,
      sha
    )
    expect(resolved).toBe('https://f1.workupload.com/download/abc')
    expect(calls).toEqual([
      'GET /file/abc',
      'GET /puzzle',
      'POST /captcha',
      'GET /file/abc',
      'GET /api/file/getDownloadServer/abc'
    ])
  })

  test('hits getDownloadServer after the landing page', async () => {
    const resolved = await resolveWorkuploadFromFetch(
      'https://workupload.com/file/HhUs4hP3E7G',
      pagesFetch({
        '/file/HhUs4hP3E7G': '<html></html>',
        getDownloadServer: '{"data":{"url":"https://s1.workupload.com/token/Game.zip"}}'
      })
    )
    expect(resolved).toBe('https://s1.workupload.com/token/Game.zip')
  })
})
