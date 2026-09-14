import { session as electronSession } from 'electron'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { getAppPaths } from './paths'

type SameSite = 'unspecified' | 'no_restriction' | 'lax' | 'strict'

export type StoredCookie = {
  name: string
  value: string
  domain?: string
  path?: string
  secure?: boolean
  httpOnly?: boolean
  hostOnly?: boolean
  expirationDate?: number
  sameSite?: SameSite
}

export type CookieJar = Record<string, string>

export type PersistedSession = {
  cookies: StoredCookie[]
  userId: string | null
  username: string | null
}

const F95_HOST = 'f95zone.to'
/** Chrome rejects cookies with a lifetime much longer than this. */
const COOKIE_TTL_SEC = 60 * 60 * 24 * 400
const AUTH_COOKIE_NAMES = new Set(['xf_user', 'xf_session', 'xf_csrf'])

const emptySession = (): PersistedSession => ({
  cookies: [],
  userId: null,
  username: null
})

let persisted: PersistedSession = emptySession()
let saveTimer: ReturnType<typeof setTimeout> | null = null

export function getSession(): PersistedSession {
  return persisted
}

export function getCookie(name: string): string | undefined {
  return persisted.cookies.find((cookie) => cookie.name === name)?.value
}

export function setUserId(userId: string | null): void {
  persisted = { ...persisted, userId }
}

export function setUsername(username: string | null): void {
  persisted = { ...persisted, username }
}

export function userIdFromXfUser(value: string | undefined): string | null {
  if (!value) return null
  try {
    const decoded = decodeURIComponent(value)
    const id = decoded.split(',')[0]?.trim()
    return id || null
  } catch {
    const id = value.split(',')[0]?.trim()
    return id || null
  }
}

function isF95Cookie(cookie: { domain?: string; name: string }): boolean {
  const domain = (cookie.domain ?? F95_HOST).replace(/^\./, '').toLowerCase()
  return domain === F95_HOST || domain.endsWith(`.${F95_HOST}`) || AUTH_COOKIE_NAMES.has(cookie.name)
}

function cookieUrl(cookie: StoredCookie): string {
  const domain = (cookie.domain ?? F95_HOST).replace(/^\./, '')
  return `https://${domain || F95_HOST}`
}

function expiryFrom(cookie: { session?: boolean; expirationDate?: number }): number {
  const minExpiry = Math.floor(Date.now() / 1000) + 60 * 60 * 24
  const requested = cookie.expirationDate && cookie.expirationDate > minExpiry
    ? cookie.expirationDate
    : Math.floor(Date.now() / 1000) + COOKIE_TTL_SEC
  const cap = Math.floor(Date.now() / 1000) + COOKIE_TTL_SEC
  return Math.min(requested, cap)
}

function toStoredCookie(cookie: Electron.Cookie): StoredCookie {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path || '/',
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    hostOnly: cookie.hostOnly,
    expirationDate: expiryFrom(cookie),
    sameSite: cookie.sameSite
  }
}

function cookiesFromUnknown(value: unknown): StoredCookie[] {
  if (Array.isArray(value)) {
    const cookies: StoredCookie[] = []
    for (const item of value) {
      if (!item || typeof item !== 'object' || !('name' in item) || !('value' in item)) continue
      const cookie = item as StoredCookie
      if (!cookie.name) continue
      cookies.push({
        name: String(cookie.name),
        value: String(cookie.value ?? ''),
        domain: cookie.domain,
        path: cookie.path || '/',
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        hostOnly: cookie.hostOnly,
        expirationDate: cookie.expirationDate,
        sameSite: cookie.sameSite
      })
    }
    return cookies
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as CookieJar).map(([name, cookieValue]) => ({
      name,
      value: String(cookieValue),
      domain: `.${F95_HOST}`,
      path: '/',
      secure: true,
      httpOnly: name !== 'xf_csrf',
      hostOnly: false,
      expirationDate: Math.floor(Date.now() / 1000) + COOKIE_TTL_SEC,
      sameSite: 'lax' as const
    }))
  }
  return []
}

async function flushCookieStore(): Promise<void> {
  try {
    await electronSession.defaultSession.cookies.flushStore()
  } catch (error) {
    console.warn('Could not flush cookie store', error)
  }
}

async function injectCookiesIntoElectron(): Promise<void> {
  const jar = electronSession.defaultSession.cookies
  for (const cookie of persisted.cookies) {
    if (!cookie.name) continue
    const url = cookieUrl(cookie)
    try {
      await jar.remove(url, cookie.name)
    } catch {
      // Cookie may not exist yet.
    }
    try {
      await jar.set({
        url,
        name: cookie.name,
        value: cookie.value,
        path: cookie.path || '/',
        secure: cookie.secure !== false,
        httpOnly: cookie.httpOnly ?? cookie.name !== 'xf_csrf',
        expirationDate: expiryFrom(cookie),
        sameSite: cookie.name === 'cf_clearance' || cookie.name === '__cf_bm'
          ? 'no_restriction'
          : cookie.sameSite && cookie.sameSite !== 'unspecified'
            ? cookie.sameSite
            : 'lax',
        ...(cookie.hostOnly ? {} : { domain: cookie.domain || `.${F95_HOST}` })
      })
    } catch (error) {
      console.warn(`Could not restore cookie ${cookie.name}`, error)
    }
  }
  await flushCookieStore()
}

export async function loadSession(): Promise<PersistedSession> {
  try {
    const raw = await readFile(getAppPaths().sessionFile, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedSession> & { cookies?: unknown }
    persisted = {
      cookies: cookiesFromUnknown(parsed.cookies),
      userId: typeof parsed.userId === 'string' ? parsed.userId : null,
      username: typeof parsed.username === 'string' ? parsed.username : null
    }
    if (!persisted.userId) {
      persisted.userId = userIdFromXfUser(getCookie('xf_user'))
    }
  } catch {
    persisted = emptySession()
    return persisted
  }

  try {
    await injectCookiesIntoElectron()
  } catch (error) {
    console.warn('Could not inject saved F95zone cookies', error)
  }
  return persisted
}

export async function saveSession(): Promise<void> {
  const file = getAppPaths().sessionFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(persisted, null, 2), 'utf8')
  await flushCookieStore()
}

export function scheduleSaveSession(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void saveSession().catch((error) => console.warn('Could not save session', error))
  }, 400)
}

export async function persistSessionNow(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  await pullCookiesFromElectron()
  await saveSession()
}

export async function clearSession(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  persisted = emptySession()
  await clearElectronCookies()
  await flushCookieStore()
  await rm(getAppPaths().sessionFile, { force: true })
}

export async function pullCookiesFromElectron(): Promise<void> {
  const cookies = await electronSession.defaultSession.cookies.get({})
  const next = cookies.filter(isF95Cookie).map(toStoredCookie)
  const byName = new Map(persisted.cookies.map((cookie) => [cookie.name, cookie]))
  for (const cookie of next) {
    byName.set(cookie.name, cookie)
  }
  const merged = [...byName.values()]
  persisted = {
    cookies: merged,
    userId: persisted.userId ?? userIdFromXfUser(merged.find((cookie) => cookie.name === 'xf_user')?.value),
    username: persisted.username
  }
}

async function clearElectronCookies(): Promise<void> {
  const cookies = await electronSession.defaultSession.cookies.get({})
  await Promise.all(
    cookies
      .filter(isF95Cookie)
      .map((cookie) =>
        electronSession.defaultSession.cookies.remove(cookieUrl(toStoredCookie(cookie)), cookie.name)
      )
  )
}
