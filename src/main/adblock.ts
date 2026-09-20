import { app, session } from 'electron'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import { FiltersEngine, Request, type Fetch } from '@ghostery/adblocker'
import { EXTRA_FILTERS } from './adblock-filters'
import {
  matchNetworkRequest,
  shouldBlockDownload as matchShouldBlockDownload,
  shouldBlockPopup as matchShouldBlockPopup,
  type AdblockEngine
} from './adblock-match'
import { maybeRedirectCdnImageRequest } from './f95/image-cache'

const LIST_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const guestContentsIds = new Set<number>()

let extraEngine: FiltersEngine | null = null
let listsEngine: FiltersEngine | null = null
let listsStarted = false
let registered = false

function cachePath(): string {
  return join(app.getPath('userData'), 'adblock-engine.bin')
}

function engines(): AdblockEngine[] {
  return [extraEngine, listsEngine].filter((engine): engine is FiltersEngine => Boolean(engine))
}

export function registerGuestContents(id: number): void {
  guestContentsIds.add(id)
  ensureAdblockEngines()
}

export function unregisterGuestContents(id: number): void {
  guestContentsIds.delete(id)
}

export function isGuestContents(contents?: Electron.WebContents | null): boolean {
  if (!contents || contents.isDestroyed()) return false
  return guestContentsIds.has(contents.id)
}

export function isGuestContentsId(id: number | undefined): boolean {
  return id != null && guestContentsIds.has(id)
}

export function shouldBlockPopup(url: string, pageUrl: string): boolean {
  return matchShouldBlockPopup({ url, pageUrl, engines: engines() })
}

export function shouldBlockDownload(input: {
  url: string
  pageUrl: string
  filename?: string
  mimeType?: string
  urlChain?: string[]
}): boolean {
  return matchShouldBlockDownload({ ...input, engines: engines() })
}

function cosmeticCss(url: string): string {
  const page = Request.fromRawDetails({ url, type: 'mainFrame' })
  const chunks: string[] = []
  for (const engine of [extraEngine, listsEngine]) {
    if (!engine) continue
    try {
      const { styles } = engine.getCosmeticsFilters({
        url: page.url,
        hostname: page.hostname,
        domain: page.domain,
        getInjectionRules: false,
        getExtendedRules: false
      })
      if (styles.trim()) chunks.push(styles)
    } catch {
      // Cosmetic lookup is best-effort.
    }
  }
  return chunks.join('\n')
}

function applyCosmetics(contents: Electron.WebContents): void {
  if (contents.isDestroyed()) return
  const url = contents.getURL()
  if (!url || url === 'about:blank') return
  const css = cosmeticCss(url)
  if (!css) return
  void contents.insertCSS(css).catch(() => undefined)
}

const wrapFetch: Fetch = (url) => fetch(url)

async function readCachedLists(): Promise<FiltersEngine | null> {
  try {
    const buffer = await readFile(cachePath())
    return FiltersEngine.deserialize(buffer)
  } catch {
    return null
  }
}

async function writeCachedLists(engine: FiltersEngine): Promise<void> {
  const file = cachePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, engine.serialize())
}

async function fetchListsEngine(): Promise<FiltersEngine> {
  return FiltersEngine.fromPrebuiltAdsAndTracking(wrapFetch)
}

async function refreshListsIfNeeded(): Promise<void> {
  try {
    if (listsEngine) {
      try {
        const info = await stat(cachePath())
        if (Date.now() - info.mtimeMs < LIST_MAX_AGE_MS) return
      } catch {
        // Cache missing or unreadable — fetch a fresh engine.
      }
    }
    const engine = await fetchListsEngine()
    listsEngine = engine
    await writeCachedLists(engine)
  } catch (error) {
    console.warn('[adblock] could not refresh filter lists', error)
  }
}

function registerWebRequest(): void {
  if (registered) return
  registered = true

  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    // Live forum HTML is subject to f95zone CSP, which does not allow f95-img:.
    // Only the app renderer should rewrite CDN <img> tags onto the cache protocol.
    if (!isGuestContentsId(details.webContentsId)) {
      const cdn = maybeRedirectCdnImageRequest(details)
      if (cdn) {
        callback({ redirectURL: cdn })
        return
      }
      callback({})
      return
    }
    const pageUrl = (() => {
      const contents = details.webContents
      if (contents && !contents.isDestroyed()) {
        try {
          return contents.getURL()
        } catch {
          /* destroyed between the check and getURL */
        }
      }
      return details.referrer || ''
    })()
    const decision = matchNetworkRequest({
      url: details.url,
      pageUrl,
      resourceType: details.resourceType,
      engines: engines()
    })
    if (decision.redirectURL) {
      callback({ redirectURL: decision.redirectURL })
      return
    }
    if (decision.cancel) {
      callback({ cancel: true })
      return
    }
    callback({})
  })

  session.defaultSession.setPermissionRequestHandler((contents, _permission, grant) => {
    grant(!isGuestContents(contents))
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('dom-ready', () => {
      if (!isGuestContents(contents)) return
      applyCosmetics(contents)
    })
  })
}

/** Extra rules are tiny; EasyList is deserialized only when a guest browser window opens. */
function ensureAdblockEngines(): void {
  if (!extraEngine) extraEngine = FiltersEngine.parse(EXTRA_FILTERS)
  if (listsStarted) return
  listsStarted = true
  void readCachedLists()
    .then((cached) => {
      if (cached) listsEngine = cached
    })
    .catch((error) => console.warn('[adblock] could not read cached lists', error))
    .then(() => refreshListsIfNeeded())
    .catch((error) => console.warn('[adblock] list refresh failed', error))
}

/** CDN image redirects only. Filter engines stay unloaded until a guest window needs them. */
export function initAdblock(): void {
  registerWebRequest()
}
