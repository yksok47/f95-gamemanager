import { describe, expect, test } from 'bun:test'
import {
  gofileAccountTokenFromBody,
  gofileIdFromUrl,
  gofileListedFilesFromContentsBody,
  gofileSaltsFromScript,
  gofileWebsiteTokenFromScript,
  isGoFilePageUrl
} from './gofile'

describe('isGoFilePageUrl', () => {
  test('matches share folders', () => {
    expect(isGoFilePageUrl('https://gofile.io/d/AbC123xy')).toBe(true)
    expect(isGoFilePageUrl('https://www.gofile.io/d/AbC123xy#/')).toBe(true)
    expect(gofileIdFromUrl('https://gofile.io/d/AbC123xy')).toBe('AbC123xy')
  })

  test('rejects store CDN URLs', () => {
    expect(isGoFilePageUrl('https://store1.gofile.io/download/web/token/Game.zip')).toBe(false)
  })
})

describe('gofile parsers', () => {
  test('reads a guest account token', () => {
    expect(gofileAccountTokenFromBody('{"status":"ok","data":{"token":"guest-token"}}')).toBe(
      'guest-token'
    )
  })

  test('reads wt from config.js', () => {
    expect(gofileWebsiteTokenFromScript('appdata.wt = "4fd6sg89d7s6";')).toBe('4fd6sg89d7s6')
  })

  test('collects salt-like strings from obfuscated JS', () => {
    const salts = gofileSaltsFromScript('var s="zz9tokenSaltValue"; var x="short";')
    expect(salts).toContain('zz9tokenSaltValue')
  })

  test('lists downloadable files from a folder payload', () => {
    const body = JSON.stringify({
      status: 'ok',
      data: {
        type: 'folder',
        children: {
          a: {
            id: 'a',
            type: 'file',
            name: 'notes.txt',
            size: 10,
            link: 'https://store1.gofile.io/download/notes.txt'
          },
          b: {
            id: 'b',
            type: 'file',
            name: 'Game-Win.zip',
            size: 999,
            link: 'https://store1.gofile.io/download/Game-Win.zip'
          },
          c: {
            id: 'c',
            type: 'file',
            name: 'Game-Linux.zip',
            size: 800,
            link: 'https://store1.gofile.io/download/Game-Linux.zip'
          }
        }
      }
    })
    expect(gofileListedFilesFromContentsBody(body)?.map((file) => file.name)).toEqual([
      'notes.txt',
      'Game-Win.zip',
      'Game-Linux.zip'
    ])
  })

  test('ignores error payloads', () => {
    expect(gofileListedFilesFromContentsBody('{"status":"error-notPremium","data":{}}')).toBe(null)
  })
})
