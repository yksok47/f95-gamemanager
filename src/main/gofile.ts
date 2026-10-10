import { createHash } from 'crypto'
import type { GameFileContext } from '@shared/types'
import {
  GOFILE_WT_SALTS,
  gofileAccountTokenFromBody,
  gofileIdFromUrl,
  gofileListedFilesFromContentsBody,
  gofileSaltsFromScript,
  gofileWebsiteTokenFromScript,
  isGoFilePageUrl
} from '@shared/gofile'
import { chooseListedFile } from './connector-pick'
import { sessionFetch, sessionUserAgent, setSessionCookie } from './connector-session'

export { isGoFilePageUrl }

const LANGUAGE = 'en-US'
const WINDOW_SECONDS = 14_400

function websiteToken(opts: {
  userAgent: string
  accountToken: string
  salt: string
  windowOffset?: number
}): string {
  const window = Math.floor(Date.now() / 1000 / WINDOW_SECONDS) + (opts.windowOffset ?? 0)
  const raw = `${opts.userAgent}::${LANGUAGE}::${opts.accountToken}::${window}::${opts.salt}`
  return createHash('sha256').update(raw).digest('hex')
}

async function readScriptTokens(
  fetchImpl: ReturnType<typeof sessionFetch>
): Promise<{ salts: string[]; staticWt: string | null }> {
  const salts = new Set<string>(GOFILE_WT_SALTS)
  let staticWt: string | null = null
  const scripts = ['https://gofile.io/dist/js/wt.obf.js', 'https://gofile.io/dist/js/config.js']
  for (const url of scripts) {
    try {
      const response = await fetchImpl(url, { method: 'GET', headers: { Accept: '*/*' } })
      const text = await response.text()
      const fromScript = gofileWebsiteTokenFromScript(text)
      if (fromScript) staticWt = fromScript
      for (const salt of gofileSaltsFromScript(text)) salts.add(salt)
    } catch {
      // Keep going with the known salts.
    }
  }
  return { salts: [...salts], staticWt }
}

export async function resolveGoFileDownload(
  pageUrl: string,
  context?: GameFileContext
): Promise<string | 'cancel' | null> {
  const id = gofileIdFromUrl(pageUrl)
  if (!id) return null
  const fetchImpl = sessionFetch()
  const userAgent = sessionUserAgent()
  try {
    const accountRes = await fetchImpl('https://api.gofile.io/accounts', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Origin: 'https://gofile.io',
        Referer: 'https://gofile.io/'
      }
    })
    const accountToken = gofileAccountTokenFromBody(await accountRes.text())
    if (!accountToken) return null

    await setSessionCookie({
      url: 'https://gofile.io',
      name: 'accountToken',
      value: accountToken,
      domain: '.gofile.io'
    })

    const { salts, staticWt } = await readScriptTokens(fetchImpl)
    const tokens = new Set<string>()
    if (staticWt) tokens.add(staticWt)
    for (const salt of salts) {
      tokens.add(websiteToken({ userAgent, accountToken, salt }))
      tokens.add(websiteToken({ userAgent, accountToken, salt, windowOffset: -1 }))
    }

    for (const wt of tokens) {
      const url = new URL(`https://api.gofile.io/contents/${encodeURIComponent(id)}`)
      url.searchParams.set('wt', wt)
      url.searchParams.set('cache', 'true')
      url.searchParams.set('page', '1')
      url.searchParams.set('pageSize', '1000')
      const response = await fetchImpl(url.href, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accountToken}`,
          'X-Website-Token': wt,
          'X-BL': LANGUAGE,
          Origin: 'https://gofile.io',
          Referer: 'https://gofile.io/'
        }
      })
      const listed = gofileListedFilesFromContentsBody(await response.text())
      if (!listed) continue
      const picked = await chooseListedFile(listed, context)
      if (picked === 'cancel') return 'cancel'
      return picked?.url ?? null
    }
    return null
  } catch (error) {
    console.warn('[gofile] could not resolve download URL', error)
    return null
  }
}
