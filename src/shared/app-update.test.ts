import { describe, expect, test } from 'bun:test'
import {
  checksumAssetName,
  detectAppInstallKind,
  isRemoteAppVersionNewer,
  locateUpdatePayloadFromEntries,
  normalizeAppVersion,
  parseChecksumFile,
  parseUpdateResultFile,
  selectReleaseAsset
} from './app-update'

const assets = [
  { name: 'SHA512SUMS', browser_download_url: 'https://example/SHA512SUMS', size: 200 },
  { name: 'latest.yml', browser_download_url: 'https://example/latest.yml', size: 80 },
  { name: 'f95-gamemanager-1.2.3-setup.exe', browser_download_url: 'https://example/setup', size: 1 },
  { name: 'f95-gamemanager-1.2.3-win-unpacked.zip', browser_download_url: 'https://example/winzip', size: 2 },
  { name: 'f95-gamemanager-1.2.3-linux-x64.AppImage', browser_download_url: 'https://example/appimage', size: 3 },
  { name: 'f95-gamemanager-1.2.3-linux-unpacked.zip', browser_download_url: 'https://example/linuxzip', size: 4 },
  { name: 'f95-gamemanager-1.2.3-mac-x64.zip', browser_download_url: 'https://example/macx64', size: 5 },
  { name: 'f95-gamemanager-1.2.3-mac-arm64.zip', browser_download_url: 'https://example/macarm', size: 6 },
  { name: 'f95-gamemanager-1.2.3-mac-x64.dmg', browser_download_url: 'https://example/dmg', size: 7 }
]

describe('normalizeAppVersion', () => {
  test('strips a leading v', () => {
    expect(normalizeAppVersion('v1.2.3')).toBe('1.2.3')
    expect(normalizeAppVersion('1.2.3')).toBe('1.2.3')
  })
})

describe('isRemoteAppVersionNewer', () => {
  test('compares dotted versions numerically', () => {
    expect(isRemoteAppVersionNewer('0.1.0', '0.2.0')).toBe(true)
    expect(isRemoteAppVersionNewer('1.2.10', '1.2.3')).toBe(false)
    expect(isRemoteAppVersionNewer('1.2.3', '1.2.3')).toBe(false)
  })
})

describe('detectAppInstallKind', () => {
  test('treats unpackaged builds as development', () => {
    expect(detectAppInstallKind({ packaged: false, platform: 'win32' })).toBe('dev')
  })

  test('detects Windows installer vs portable', () => {
    expect(detectAppInstallKind({ packaged: true, platform: 'win32', hasUninstaller: true })).toBe(
      'nsis'
    )
    expect(detectAppInstallKind({ packaged: true, platform: 'win32', hasUninstaller: false })).toBe(
      'portable'
    )
  })

  test('detects Linux AppImage from env', () => {
    expect(
      detectAppInstallKind({
        packaged: true,
        platform: 'linux',
        env: { APPIMAGE: '/tmp/F95GameManager.AppImage' }
      })
    ).toBe('appimage')
    expect(detectAppInstallKind({ packaged: true, platform: 'linux', env: {} })).toBe('portable')
  })
})

describe('selectReleaseAsset', () => {
  test('picks the Windows installer for NSIS installs', () => {
    expect(selectReleaseAsset(assets, { platform: 'win32', arch: 'x64', kind: 'nsis' })?.name).toBe(
      'f95-gamemanager-1.2.3-setup.exe'
    )
  })

  test('picks the unpacked zip for Windows portable installs', () => {
    expect(
      selectReleaseAsset(assets, { platform: 'win32', arch: 'x64', kind: 'portable' })?.name
    ).toBe('f95-gamemanager-1.2.3-win-unpacked.zip')
  })

  test('picks AppImage vs unpacked zip on Linux', () => {
    expect(
      selectReleaseAsset(assets, { platform: 'linux', arch: 'x64', kind: 'appimage' })?.name
    ).toBe('f95-gamemanager-1.2.3-linux-x64.AppImage')
    expect(
      selectReleaseAsset(assets, { platform: 'linux', arch: 'x64', kind: 'portable' })?.name
    ).toBe('f95-gamemanager-1.2.3-linux-unpacked.zip')
  })

  test('picks the matching macOS zip and ignores the dmg when a zip exists', () => {
    expect(
      selectReleaseAsset(assets, { platform: 'darwin', arch: 'arm64', kind: 'mac' })?.name
    ).toBe('f95-gamemanager-1.2.3-mac-arm64.zip')
    expect(selectReleaseAsset(assets, { platform: 'darwin', arch: 'x64', kind: 'mac' })?.name).toBe(
      'f95-gamemanager-1.2.3-mac-x64.zip'
    )
  })
})

describe('parseChecksumFile', () => {
  test('reads GNU sha512 lines', () => {
    const hash = 'a'.repeat(128)
    const parsed = parseChecksumFile(`${hash}  f95-gamemanager-1.2.3-setup.exe\n`)
    expect(parsed.get('f95-gamemanager-1.2.3-setup.exe')).toEqual({
      algorithm: 'sha512',
      hash
    })
  })

  test('identifies checksum assets', () => {
    expect(checksumAssetName('SHA512SUMS')).toBe(true)
    expect(checksumAssetName('latest.yml')).toBe(false)
  })
})

describe('locateUpdatePayloadFromEntries', () => {
  test('unwraps win-unpacked to the folder that contains the exe', () => {
    expect(
      locateUpdatePayloadFromEntries(
        ['win-unpacked/F95GameManager.exe', 'win-unpacked/resources/app.asar'],
        { platform: 'win32' }
      )
    ).toEqual({ type: 'dir', root: 'win-unpacked' })
  })

  test('unwraps linux-unpacked to the folder that contains the binary', () => {
    expect(
      locateUpdatePayloadFromEntries(
        ['linux-unpacked/F95GameManager', 'linux-unpacked/resources/app.asar'],
        { platform: 'linux' }
      )
    ).toEqual({ type: 'dir', root: 'linux-unpacked' })
  })

  test('keeps the macOS .app bundle as the payload root', () => {
    expect(
      locateUpdatePayloadFromEntries(
        [
          'F95 Game Manager.app/Contents/MacOS/F95GameManager',
          'F95 Game Manager.app/Contents/Info.plist'
        ],
        { platform: 'darwin' }
      )
    ).toEqual({ type: 'app', root: 'F95 Game Manager.app' })
  })
})

describe('parseUpdateResultFile', () => {
  test('reads helper result lines', () => {
    expect(parseUpdateResultFile('\uFEFFok=1\nversion=1.2.3\nerror=\n')).toEqual({
      ok: true,
      version: '1.2.3',
      error: ''
    })
    expect(parseUpdateResultFile('ok=0\nversion=1.2.3\nerror=robocopy failed\n')).toEqual({
      ok: false,
      version: '1.2.3',
      error: 'robocopy failed'
    })
  })
})
