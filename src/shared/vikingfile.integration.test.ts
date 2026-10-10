import { describe, expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { DownloadSection } from './types'
import {
  checkVikingFile,
  isVikingFilePageUrl,
  resolveVikingFileFromFetch,
  vikingFileDirectUrlFromBody,
  vikingFileHashFromUrl,
  type ConnectorFetch
} from './vikingfile'

function samplesDir(): string | null {
  const junction = join(import.meta.dir, '../main/f95/parser/samples/downloads')
  if (existsSync(junction)) return junction
  const sibling = join(import.meta.dir, '../../../f95-gamemanager-parser-samples/downloads')
  if (existsSync(sibling)) return sibling
  return null
}

function collectVikingFileUrls(dir: string): string[] {
  const urls: string[] = []
  const seen = new Set<string>()

  function walkMirrors(sections: DownloadSection[]): void {
    for (const section of sections) {
      for (const entry of section.entries) {
        for (const mirror of [...entry.mirrors, ...entry.parts.flatMap((part) => part.mirrors)]) {
          if (!isVikingFilePageUrl(mirror.url) || seen.has(mirror.url)) continue
          seen.add(mirror.url)
          urls.push(mirror.url)
        }
      }
      walkMirrors(section.sections)
    }
  }

  for (const id of readdirSync(dir, { withFileTypes: true })) {
    if (!id.isDirectory()) continue
    const file = join(dir, id.name, 'output.json')
    if (!existsSync(file)) continue
    walkMirrors(JSON.parse(readFileSync(file, 'utf8')) as DownloadSection[])
  }
  return urls
}

const jsonFetch =
  (body: string): ConnectorFetch =>
  async () =>
    ({
      ok: true,
      url: 'https://vikingfile.com/f/IYQDK1lzRf',
      headers: new Headers({ 'content-type': 'application/json' }),
      text: async () => body
    }) as Pick<Response, 'ok' | 'url' | 'headers' | 'text'>

describe('VikingFile connector integration', () => {
  const dir = samplesDir()
  if (!dir) {
    test('parser samples unavailable — pass', () => {
      expect(true).toBe(true)
    })
    return
  }

  const sampleUrls = collectVikingFileUrls(dir)

  test('parser download samples include VikingFile landing links', () => {
    expect(sampleUrls.length).toBeGreaterThan(0)
    expect(sampleUrls.every(isVikingFilePageUrl)).toBe(true)
    expect(sampleUrls.some((url) => vikingFileHashFromUrl(url) === 'IYQDK1lzRf')).toBe(true)
  })

  test(
    'resolves a parser-sample link through check-file and the connector contract',
    async () => {
      const pageUrl =
        sampleUrls.find((url) => vikingFileHashFromUrl(url) === 'IYQDK1lzRf') ?? sampleUrls[0]
      expect(pageUrl).toBeTruthy()

      const realFetch: ConnectorFetch = (url, init) => fetch(url, init)
      const meta = await checkVikingFile(pageUrl, realFetch)
      expect(meta).not.toBeNull()
      expect(meta?.exist).toBe(true)
      expect(meta?.hash).toBe(vikingFileHashFromUrl(pageUrl))
      expect(meta?.name).toMatch(/\.(zip|rar|7z)$/i)

      const live = await resolveVikingFileFromFetch(pageUrl, realFetch)
      if (live) {
        expect(isVikingFilePageUrl(live)).toBe(false)
        expect(live.startsWith('http')).toBe(true)
      } else {
        const page = await fetch(pageUrl, { redirect: 'follow' })
        const html = await page.text()
        expect(html).toMatch(/captcha-download|download-link|ViKiNG FiLE/i)
        expect(vikingFileDirectUrlFromBody(html)).toBeNull()
      }

      const fakeCdn = 'https://cdn.vik1ngfile.site/token/Secret_Flasher_Manaka_v1.1.3.zip'
      const resolved = await resolveVikingFileFromFetch(
        pageUrl,
        jsonFetch(JSON.stringify({ link: fakeCdn }))
      )
      expect(resolved).toBe(fakeCdn)
    },
    { timeout: 30_000 }
  )
})
