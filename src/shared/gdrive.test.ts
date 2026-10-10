import { describe, expect, test } from 'bun:test'
import type { ConnectorFetch } from './connector'
import {
  googleDriveDirectUrlFromHtml,
  googleDriveExportUrl,
  googleDriveFileIdFromUrl,
  isGoogleDriveFolderUrl,
  isGoogleDrivePageUrl,
  resolveGoogleDriveFromFetch
} from './gdrive'

const htmlFetch =
  (html: string): ConnectorFetch =>
  async (input) =>
    ({
      ok: true,
      status: 200,
      url: String(input),
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () => html
    })

describe('googleDriveFileIdFromUrl', () => {
  test('reads file/d and uc?id forms', () => {
    expect(
      googleDriveFileIdFromUrl('https://drive.google.com/file/d/1LHsdf3leinq1wCertnwFVGertertHrfB/view')
    ).toBe('1LHsdf3leinq1wCertnwFVGertertHrfB')
    expect(
      googleDriveFileIdFromUrl('https://docs.google.com/uc?export=download&id=abc123')
    ).toBe('abc123')
    expect(isGoogleDrivePageUrl('https://drive.google.com/file/d/abc/view?usp=sharing')).toBe(true)
    expect(isGoogleDriveFolderUrl('https://drive.google.com/drive/folders/abc')).toBe(true)
    expect(isGoogleDrivePageUrl('https://drive.google.com/drive/folders/abc')).toBe(false)
  })
})

describe('googleDriveDirectUrlFromHtml', () => {
  test('reads confirm + uuid from the virus-scan form', () => {
    const html = `
      <form id="download-form" action="https://drive.usercontent.google.com/download">
        <input name="id" value="abc">
        <input name="export" value="download">
        <input name="confirm" value="t">
        <input name="uuid" value="u-1">
      </form>
    `
    expect(googleDriveDirectUrlFromHtml(html, 'abc')).toBe(
      'https://drive.usercontent.google.com/download?id=abc&export=download&confirm=t&uuid=u-1'
    )
  })

  test('reads the uc-download-link href', () => {
    const html = `<a id="uc-download-link" href="/uc?export=download&amp;confirm=ABCD&amp;id=abc">Download anyway</a>`
    expect(googleDriveDirectUrlFromHtml(html, 'abc')).toBe(
      'https://drive.google.com/uc?export=download&confirm=ABCD&id=abc'
    )
  })
})

describe('resolveGoogleDriveFromFetch', () => {
  test('falls back to the confirm=t usercontent URL', async () => {
    expect(await resolveGoogleDriveFromFetch('https://drive.google.com/file/d/abc/view', htmlFetch('<html></html>'))).toBe(
      googleDriveExportUrl('abc')
    )
  })
})
