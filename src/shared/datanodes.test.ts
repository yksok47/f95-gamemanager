import { describe, expect, test } from 'bun:test'
import {
  dataNodesIdFromUrl,
  isDataNodesInterstitialDownload,
  isDataNodesPageUrl
} from './datanodes'

describe('isDataNodesPageUrl', () => {
  test('reads the file id from common paths', () => {
    expect(isDataNodesPageUrl('https://datanodes.to/abc123xyz')).toBe(true)
    expect(isDataNodesPageUrl('https://www.datanodes.to/download/abc123xyz')).toBe(true)
    expect(dataNodesIdFromUrl('https://datanodes.to/file/abc123xyz')).toBe('abc123xyz')
  })

  test('uses the id, not the filename, on F95-style links', () => {
    expect(
      dataNodesIdFromUrl(
        'https://datanodes.to/n7hc0br4n6g0/Family_business_0.45_patreon_ver.zip'
      )
    ).toBe('n7hc0br4n6g0')
  })

  test('ignores the download interstitial', () => {
    expect(isDataNodesPageUrl('https://datanodes.to/download')).toBe(false)
    expect(isDataNodesPageUrl('https://datanodes.to/download.htm')).toBe(false)
  })
})

describe('isDataNodesInterstitialDownload', () => {
  test('detects Chromium saving /download as download.htm', () => {
    expect(
      isDataNodesInterstitialDownload(
        'https://datanodes.to/download',
        'download.htm',
        'text/html'
      )
    ).toBe(true)
    expect(
      isDataNodesInterstitialDownload('https://cdn.example/Game.zip', 'Game.zip', 'application/zip')
    ).toBe(false)
  })
})
