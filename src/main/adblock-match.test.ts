import { describe, expect, test } from 'bun:test'
import { FiltersEngine } from '@ghostery/adblocker'
import { EXTRA_FILTERS } from './adblock-filters'
import {
  isExecutableDownload,
  isKnownFileHost,
  isLikelyFileCdn,
  matchNetworkRequest,
  shouldBlockDownload,
  shouldBlockPopup
} from './adblock-match'

const extra = FiltersEngine.parse(EXTRA_FILTERS)
const engines = [extra]

const ads = FiltersEngine.parse(`
||ads.example.net^
||popup-ads.test^
||malware-cdn.test^
`)

describe('isKnownFileHost', () => {
  test('accepts lockers and their CDNs', () => {
    expect(isKnownFileHost('pixeldrain.com')).toBe(true)
    expect(isKnownFileHost('store1.gofile.io')).toBe(true)
    expect(isKnownFileHost('download1234.mediafire.com')).toBe(true)
    expect(isKnownFileHost('attachments.f95zone.to')).toBe(true)
  })

  test('rejects unrelated hosts', () => {
    expect(isKnownFileHost('exoclick.com')).toBe(false)
    expect(isKnownFileHost('evil.example')).toBe(false)
  })
})

describe('isLikelyFileCdn', () => {
  test('accepts object storage hosts', () => {
    expect(isLikelyFileCdn('files.s3.amazonaws.com')).toBe(true)
    expect(isLikelyFileCdn('pub.r2.dev')).toBe(true)
  })
})

describe('isExecutableDownload', () => {
  test('detects exe names and PE mime types', () => {
    expect(isExecutableDownload('Setup.exe', 'https://cdn.test/a', '')).toBe(true)
    expect(
      isExecutableDownload('payload', 'https://cdn.test/payload', 'application/x-msdownload')
    ).toBe(true)
    expect(isExecutableDownload('game.zip', 'https://cdn.test/game.zip', '')).toBe(false)
  })
})

describe('shouldBlockPopup', () => {
  test('blocks extra-list ad networks from a file hoster', () => {
    expect(
      shouldBlockPopup({
        url: 'https://syndication.exoclick.com/splash',
        pageUrl: 'https://datanodes.to/download/abc',
        engines
      })
    ).toBe(true)
  })

  test('blocks unknown third-party popunders', () => {
    expect(
      shouldBlockPopup({
        url: 'https://random-prize.example/winner',
        pageUrl: 'https://pixeldrain.com/u/abc',
        engines
      })
    ).toBe(true)
  })

  test('allows same-site and known locker popups', () => {
    expect(
      shouldBlockPopup({
        url: 'https://pixeldrain.com/api/file/abc',
        pageUrl: 'https://pixeldrain.com/u/abc',
        engines
      })
    ).toBe(false)
    expect(
      shouldBlockPopup({
        url: 'https://mega.nz/file/abc',
        pageUrl: 'https://f95zone.to/masked/1',
        engines
      })
    ).toBe(false)
  })

  test('allows object-storage popups that may be the real file', () => {
    expect(
      shouldBlockPopup({
        url: 'https://bucket.s3.amazonaws.com/game-v1',
        pageUrl: 'https://workupload.com/file/abc',
        engines
      })
    ).toBe(false)
  })

  test('blocks listed ad domains even when opened from a locker', () => {
    expect(
      shouldBlockPopup({
        url: 'https://popup-ads.test/click',
        pageUrl: 'https://mixdrop.co/e/abc',
        engines: [ads]
      })
    ).toBe(true)
  })
})

describe('shouldBlockDownload', () => {
  test('cancels third-party executables from unknown hosts', () => {
    expect(
      shouldBlockDownload({
        url: 'https://cdn.ads.example/Player.exe',
        pageUrl: 'https://datanodes.to/wait',
        filename: 'Player.exe',
        engines
      })
    ).toBe(true)
  })

  test('keeps archives even from a third-party CDN', () => {
    expect(
      shouldBlockDownload({
        url: 'https://files.examplecdn.net/Game_v1.2.zip',
        pageUrl: 'https://pixeldrain.com/u/abc',
        filename: 'Game_v1.2.zip',
        engines
      })
    ).toBe(false)
  })

  test('keeps executables from the locker itself', () => {
    expect(
      shouldBlockDownload({
        url: 'https://download1234.mediafire.com/file/game.exe',
        pageUrl: 'https://www.mediafire.com/file/abc/game.exe',
        filename: 'game.exe',
        engines
      })
    ).toBe(false)
  })

  test('cancels URLs the filter list blocks, including zip names', () => {
    expect(
      shouldBlockDownload({
        url: 'https://malware-cdn.test/not-a-virus.zip',
        pageUrl: 'https://pixeldrain.com/u/abc',
        filename: 'not-a-virus.zip',
        engines: [ads]
      })
    ).toBe(true)
  })
})

describe('matchNetworkRequest', () => {
  test('never cancels the main document', () => {
    expect(
      matchNetworkRequest({
        url: 'https://ads.example.net/landing',
        pageUrl: 'https://ads.example.net/landing',
        resourceType: 'mainFrame',
        engines: [ads]
      })
    ).toEqual({ cancel: false })
  })

  test('cancels ad scripts on a guest page', () => {
    expect(
      matchNetworkRequest({
        url: 'https://ads.example.net/banner.js',
        pageUrl: 'https://datanodes.to/file',
        resourceType: 'script',
        engines: [ads]
      }).cancel
    ).toBe(true)
  })
})
