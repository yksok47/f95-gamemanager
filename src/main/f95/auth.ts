import type { AuthSession, LoginResult, TwoStepChallenge, TwoStepPayload } from '@shared/types'
import {
  clearSession,
  getCookie,
  getSession,
  persistSessionNow,
  setUserId,
  setUsername,
  userIdFromXfUser
} from '../session-store'
import { resetCatalogRequestState } from './catalog'
import { F95Error, f95Fetch } from './http'
import { parseTwoStepError, parseTwoStepForm, type TwoStepForm } from './two-step-parse'

const TOKEN_RE = /name="_xfToken"\s+value="([^"]+)"/
const AUTH_ERROR_RE =
  /<div class="blockMessage blockMessage--error[^"]*"[^>]*>([\s\S]*?)<\/div>/i
const TWO_STEP_URL = 'https://f95zone.to/login/two-step'

type PendingTwoStep = {
  loginName: string
  form: TwoStepForm
}

let pendingTwoStep: PendingTwoStep | null = null

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

function challengeFrom(form: TwoStepForm, error: string | null): TwoStepChallenge {
  return {
    provider: form.provider,
    prompt: form.prompt,
    canTrust: form.canTrust,
    providers: form.providers.map(({ id, label }) => ({ id, label })),
    error
  }
}

function pageUrlOf(response: Response): string {
  return response.url || TWO_STEP_URL
}

async function completeLogin(loginName: string): Promise<LoginResult> {
  const xfUser = getCookie('xf_user')
  if (!xfUser) {
    throw new F95Error('Login failed. F95zone did not return a session.', 'auth_failed')
  }
  pendingTwoStep = null
  setUserId(userIdFromXfUser(xfUser))
  setUsername(loginName)
  await persistSessionNow()
  return { status: 'ok', session: currentSession() }
}

function requirePending(): PendingTwoStep {
  if (!pendingTwoStep) {
    throw new F95Error('The verification step expired. Sign in again.', 'auth_failed')
  }
  return pendingTwoStep
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const loginName = username.trim()
  if (!loginName || !password) {
    throw new F95Error('Enter your F95zone username and password.', 'auth_failed')
  }

  pendingTwoStep = null
  await clearSession()
  resetCatalogRequestState()

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

  const { response, body } = await f95Fetch('/login/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://f95zone.to',
      Referer: 'https://f95zone.to/login/'
    },
    body: form.toString()
  })

  if (getCookie('xf_user')) {
    return completeLogin(loginName)
  }

  const twoStep = parseTwoStepForm(body, pageUrlOf(response))
  if (twoStep) {
    pendingTwoStep = { loginName, form: twoStep }
    return { status: 'two_step', challenge: challengeFrom(twoStep, null) }
  }

  const htmlError = body
    .match(AUTH_ERROR_RE)?.[1]
    ?.replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  throw new F95Error(htmlError || 'Login failed. Check the username and password.', 'auth_failed')
}

export async function submitTwoStep(payload: TwoStepPayload): Promise<LoginResult> {
  const pending = requirePending()
  const code = payload.code.replace(/\s+/g, '')
  if (!code) {
    return { status: 'two_step', challenge: challengeFrom(pending.form, 'Enter the verification code.') }
  }

  const fields = new URLSearchParams()
  for (const [name, value] of pending.form.fields) fields.append(name, value)
  fields.set('code', code)
  if (payload.trust && pending.form.canTrust) fields.set('trust', '1')
  if (!fields.has('confirm')) fields.set('confirm', '1')

  const { response, body } = await f95Fetch(pending.form.action, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Origin: 'https://f95zone.to',
      Referer: TWO_STEP_URL
    },
    body: fields.toString()
  })

  if (getCookie('xf_user')) {
    return completeLogin(pending.loginName)
  }

  const error = parseTwoStepError(body) || 'The verification code was not accepted. Try again.'
  const next = parseTwoStepForm(body, pageUrlOf(response))
  if (next) {
    pending.form = next
  }
  return { status: 'two_step', challenge: challengeFrom(pending.form, error) }
}

function providerUrl(form: TwoStepForm, providerId: string): string | null {
  const link = form.providers.find((item) => item.id === providerId)
  if (link) return link.href
  if (providerId !== form.provider) return null
  const target = new URL(TWO_STEP_URL)
  target.searchParams.set('provider', providerId)
  for (const [name, value] of form.fields) {
    if (name === 'remember' || name === '_xfRedirect') target.searchParams.set(name, value)
  }
  return target.href
}

export async function switchTwoStepProvider(providerId: string): Promise<LoginResult> {
  const pending = requirePending()
  const url = providerUrl(pending.form, providerId)
  if (!url) {
    throw new F95Error('That verification method is not available for this account.', 'auth_failed')
  }

  const { response, body } = await f95Fetch(url, {
    headers: { Referer: TWO_STEP_URL }
  })
  const next = parseTwoStepForm(body, pageUrlOf(response))
  if (!next) {
    const error = parseTwoStepError(body)
    pendingTwoStep = null
    throw new F95Error(error || 'The verification step expired. Sign in again.', 'auth_failed')
  }
  pending.form = next
  return { status: 'two_step', challenge: challengeFrom(next, null) }
}

export async function cancelTwoStep(): Promise<AuthSession> {
  pendingTwoStep = null
  await clearSession()
  resetCatalogRequestState()
  return { loggedIn: false, userId: null, username: null }
}

export async function logout(): Promise<AuthSession> {
  pendingTwoStep = null
  await clearSession()
  resetCatalogRequestState()
  return { loggedIn: false, userId: null, username: null }
}
