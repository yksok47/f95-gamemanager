import type { AuthSession } from '@shared/types'
import {
  clearSession,
  getCookie,
  getSession,
  persistSessionNow,
  setUserId,
  setUsername,
  userIdFromXfUser
} from '../session-store'
import { invalidateCatalogSessionOptions } from './catalog'
import { F95Error, f95Fetch } from './http'

const TOKEN_RE = /name="_xfToken"\s+value="([^"]+)"/
const AUTH_ERROR_RE =
  /<div class="blockMessage blockMessage--error[^"]*"[^>]*>([\s\S]*?)<\/div>/i

function currentSession(): AuthSession {
  const xfUser = getCookie('xf_user')
  return {
    loggedIn: Boolean(xfUser),
    userId: getSession().userId ?? userIdFromXfUser(xfUser),
    username: getSession().username
  }
}

export async function getAuthSession(): Promise<AuthSession> {
  const xfUser = getCookie('xf_user')
  if (!xfUser) {
    return { loggedIn: false, userId: null, username: null }
  }
  if (!getSession().userId) {
    setUserId(userIdFromXfUser(xfUser))
  }
  return currentSession()
}

export async function login(username: string, password: string): Promise<AuthSession> {
  const loginName = username.trim()
  if (!loginName || !password) {
    throw new F95Error('Enter your F95zone username and password.', 'auth_failed')
  }

  await clearSession()
  invalidateCatalogSessionOptions()

  const { body: loginPage } = await f95Fetch('/login/')
  const token = loginPage.match(TOKEN_RE)?.[1]
  if (!token) {
    throw new F95Error('Could not read the F95zone login form. The site layout may have changed.', 'parse')
  }

  const form = new URLSearchParams({
    login: loginName,
    password,
    remember: '1',
    _xfRedirect: '/',
    _xfToken: token
  })

  const { body } = await f95Fetch('/login/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://f95zone.to',
      Referer: 'https://f95zone.to/login/'
    },
    body: form.toString()
  })

  const xfUser = getCookie('xf_user')
  if (!xfUser) {
    const htmlError = body
      .match(AUTH_ERROR_RE)?.[1]
      ?.replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    throw new F95Error(htmlError || 'Login failed. Check the username and password.', 'auth_failed')
  }

  setUserId(userIdFromXfUser(xfUser))
  setUsername(loginName)
  await persistSessionNow()
  return currentSession()
}

export async function logout(): Promise<AuthSession> {
  await clearSession()
  invalidateCatalogSessionOptions()
  return { loggedIn: false, userId: null, username: null }
}
