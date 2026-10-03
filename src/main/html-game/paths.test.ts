import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { htmlGameOrigin, htmlGameUrl, parseHtmlGameRequest, safeGameFile } from './paths'

const root = join('C:', 'games', 'Family Business', '0.45')

describe('html game URLs', () => {
  test('uses a non-numeric host so Chromium does not treat the thread id as an IP', () => {
    expect(htmlGameOrigin(42)).toBe('htmlgame://t42')
    expect(htmlGameUrl(42, 'Family business.html')).toBe('htmlgame://t42/Family%20business.html')
    expect(htmlGameUrl(42, 'resources/day1/a.png')).toBe('htmlgame://t42/resources/day1/a.png')
    expect(htmlGameOrigin(162898)).toBe('htmlgame://t162898')
  })

  test('parses asset requests back to the thread and path', () => {
    expect(parseHtmlGameRequest('htmlgame://t42/Family%20business.html')).toEqual({
      threadId: 42,
      pathname: '/Family%20business.html'
    })
    expect(parseHtmlGameRequest('htmlgame://0.2.124.82/Family%20business.html')).toEqual({
      threadId: 162898,
      pathname: '/Family%20business.html'
    })
    expect(parseHtmlGameRequest('https://example.com/x')).toBeNull()
    expect(parseHtmlGameRequest('htmlgame://nope/index.html')).toBeNull()
  })
})

describe('safeGameFile', () => {
  test('maps URLs onto files under the install root', () => {
    expect(safeGameFile(root, '/Family%20business.html')).toBe(join(root, 'Family business.html'))
    expect(safeGameFile(root, '/resources/icon.png')).toBe(join(root, 'resources', 'icon.png'))
  })

  test('rejects path traversal', () => {
    expect(safeGameFile(root, '/../secret.html')).toBeNull()
    expect(safeGameFile(root, '/resources/../../secret')).toBeNull()
  })
})
