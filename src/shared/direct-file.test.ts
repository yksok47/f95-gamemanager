import { describe, expect, test } from 'bun:test'
import { isDirectDownloadName, isDirectFileHref, isFileLockerLandingHost } from './direct-file'

describe('isDirectDownloadName', () => {
  test('matches archives, installers, and Ren\'Py overlay files', () => {
    expect(isDirectDownloadName('patch.zip')).toBe(true)
    expect(isDirectDownloadName('game.7z')).toBe(true)
    expect(isDirectDownloadName('build.rar')).toBe(true)
    expect(isDirectDownloadName('setup.exe')).toBe(true)
    expect(isDirectDownloadName('uncensor.rpy')).toBe(true)
    expect(isDirectDownloadName('UNCENSOR.RPYC')).toBe(true)
    expect(isDirectDownloadName('mod.rpa')).toBe(true)
    expect(isDirectDownloadName('extra.rpu')).toBe(true)
  })

  test('matches XenForo attachment slugs that keep the extension before the id', () => {
    expect(isDirectDownloadName('uncensor.rpy.2512345')).toBe(true)
    expect(isDirectDownloadName('patch.rpyc.99')).toBe(true)
  })

  test('leaves viewable names alone', () => {
    expect(isDirectDownloadName('notes.txt')).toBe(false)
    expect(isDirectDownloadName('shot.png')).toBe(false)
    expect(isDirectDownloadName('uncensor-rpy.2512345')).toBe(false)
    expect(isDirectDownloadName('patch.rpyc.txt')).toBe(false)
  })
})

describe('isFileLockerLandingHost', () => {
  test('matches locker front pages, not their download CDNs', () => {
    expect(isFileLockerLandingHost('www.mediafire.com')).toBe(true)
    expect(isFileLockerLandingHost('mediafire.com')).toBe(true)
    expect(isFileLockerLandingHost('download1234.mediafire.com')).toBe(false)
    expect(isFileLockerLandingHost('store1.gofile.io')).toBe(false)
  })
})

describe('isDirectFileHref', () => {
  test('reads the filename from F95 attachment CDN paths', () => {
    expect(
      isDirectFileHref('https://attachments.f95zone.to/2024/01/1234567_uncensor.rpy')
    ).toBe(true)
    expect(
      isDirectFileHref('https://attachments.f95zone.to/2024/01/1234567_unlock.rpyc')
    ).toBe(true)
    expect(
      isDirectFileHref('https://attachments.f95zone.to/2023/04/2539531_notes.torrent')
    ).toBe(false)
  })

  test('reads XenForo attachment URLs that embed the extension', () => {
    expect(isDirectFileHref('https://f95zone.to/attachments/uncensor.rpy.2512345/')).toBe(true)
    expect(isDirectFileHref('https://f95zone.to/attachments/2512345/')).toBe(false)
  })

  test('uses the link title when the URL has no extension', () => {
    expect(
      isDirectFileHref('https://f95zone.to/attachments/2512345/', 'uncensor.rpy')
    ).toBe(true)
    expect(isDirectFileHref('https://f95zone.to/attachments/2512345/', 'shot.png')).toBe(false)
  })

  test('does not treat file-locker landing pages as direct downloads', () => {
    expect(isDirectFileHref('https://www.mediafire.com/file/abc123/Game-v1.zip')).toBe(false)
    expect(isDirectFileHref('https://www.mediafire.com/file/abc123/Game-v1.zip/file')).toBe(false)
    expect(isDirectFileHref('https://mediafire.com/file/abc123')).toBe(false)
    expect(isDirectFileHref('https://www.mediafire.com/file/abc123/Game.zip', 'Game.zip')).toBe(
      false
    )
    expect(isDirectFileHref('https://dropbox.com/s/abc/Game.zip')).toBe(false)
  })

  test('still treats locker CDN URLs with a filename as direct files', () => {
    expect(isDirectFileHref('https://download1234.mediafire.com/token/Game-v1.zip')).toBe(true)
    expect(isDirectFileHref('https://store1.gofile.io/download/Game.zip')).toBe(true)
  })
})
