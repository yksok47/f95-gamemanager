import {
  asRecord,
  firstHttpUrl,
  hostnameOf,
  jsonValue,
  parseHttpUrl,
  type ConnectorFetch
} from './connector'

const PAGE_HOSTS = new Set(['workupload.com'])
const FILE_PATH = /^\/(file|archive)\/([^/?#]+)/i

export type WorkuploadKind = 'file' | 'archive'

export function isWorkuploadHost(hostname: string): boolean {
  return PAGE_HOSTS.has(hostnameOf(hostname))
}

export function workuploadTargetFromUrl(
  href: string
): { kind: WorkuploadKind; id: string } | null {
  const url = parseHttpUrl(href)
  if (!url || !isWorkuploadHost(url.hostname)) return null
  const match = url.pathname.match(FILE_PATH)
  const kind = match?.[1]?.toLowerCase()
  const id = match?.[2]?.trim()
  if ((kind === 'file' || kind === 'archive') && id) return { kind, id }
  return null
}

export function isWorkuploadPageUrl(href: string): boolean {
  return Boolean(workuploadTargetFromUrl(href))
}

export function workuploadDirectUrlFromBody(body: string): string | null {
  const json = asRecord(jsonValue(body))
  const data = asRecord(json?.data) ?? json
  const url = firstHttpUrl(data?.url) || firstHttpUrl(data?.downloadurl) || firstHttpUrl(json?.url)
  return url
}

export type WorkuploadPuzzle = { puzzle: string; range: number; find: string[] }

export function isWorkuploadHumanCheck(html: string): boolean {
  return /are you a human\?/i.test(html) || /url:\s*["']\/puzzle["']/.test(html)
}

export function workuploadPuzzleFromBody(body: string): WorkuploadPuzzle | null {
  const data = asRecord(asRecord(jsonValue(body))?.data)
  const puzzle = data?.puzzle
  const range = Number(data?.range)
  const find = Array.isArray(data?.find)
    ? data.find.filter((item): item is string => typeof item === 'string')
    : []
  if (typeof puzzle !== 'string' || !Number.isSafeInteger(range) || range <= 0 || !find.length) {
    return null
  }
  return { puzzle, range, find: find.map((hash) => hash.toLowerCase()) }
}

/** The page brute-forces `sha256(puzzle + i)` and posts every hit as `"i "`. */
export function solveWorkuploadPuzzle(
  puzzle: WorkuploadPuzzle,
  sha256Hex: (input: string) => string
): string | null {
  const wanted = new Set(puzzle.find)
  const hits: number[] = []
  for (let i = 0; i < puzzle.range && hits.length < wanted.size; i += 1) {
    if (wanted.has(sha256Hex(puzzle.puzzle + i))) hits.push(i)
  }
  if (hits.length < wanted.size) return null
  return hits.map((hit) => `${hit} `).join('')
}

async function passHumanCheck(
  pageUrl: string,
  fetchImpl: ConnectorFetch,
  sha256Hex: (input: string) => string
): Promise<boolean> {
  const puzzleResponse = await fetchImpl('https://workupload.com/puzzle', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      Referer: pageUrl
    }
  })
  const puzzle = workuploadPuzzleFromBody(await puzzleResponse.text())
  if (!puzzle) return false
  const captcha = solveWorkuploadPuzzle(puzzle, sha256Hex)
  if (!captcha) return false
  await fetchImpl('https://workupload.com/captcha', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: 'https://workupload.com',
      Referer: pageUrl
    },
    body: new URLSearchParams({ captcha }).toString()
  })
  return true
}

async function loadLanding(pageUrl: string, fetchImpl: ConnectorFetch): Promise<string> {
  const response = await fetchImpl(pageUrl, {
    method: 'GET',
    headers: { Accept: 'text/html,application/xhtml+xml' }
  })
  return response.text()
}

export async function resolveWorkuploadFromFetch(
  pageUrl: string,
  fetchImpl: ConnectorFetch,
  sha256Hex?: (input: string) => string
): Promise<string | null> {
  const target = workuploadTargetFromUrl(pageUrl)
  if (!target) return null
  try {
    // The landing page sets the `token` cookie the API needs, but only once the
    // proof-of-work check has passed.
    const landing = await loadLanding(pageUrl, fetchImpl)
    if (isWorkuploadHumanCheck(landing)) {
      if (!sha256Hex || !(await passHumanCheck(pageUrl, fetchImpl, sha256Hex))) return null
      if (isWorkuploadHumanCheck(await loadLanding(pageUrl, fetchImpl))) return null
    }
    const api = `https://workupload.com/api/${target.kind}/getDownloadServer/${encodeURIComponent(target.id)}`
    const response = await fetchImpl(api, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Origin: 'https://workupload.com',
        Referer: pageUrl
      }
    })
    return workuploadDirectUrlFromBody(await response.text())
  } catch (error) {
    console.warn('[workupload] could not resolve download URL', error)
    return null
  }
}
