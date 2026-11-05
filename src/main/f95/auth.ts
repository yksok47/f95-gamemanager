import type {
  AuthChange,
  AuthSession,
  LoginResult,
  TwoStepChallenge,
  TwoStepPayload
} from '@shared/types'
import {
  clearSession,
  getCookie,
  getSession,
  persistSessionNow,
  removeCookies,
  setUserId,
  setUsername,
  userIdFromXfUser
} from '../session-store'
import { sendToRenderer } from '../windows'
import { resetCatalogRequestState } from './catalog'
import { F95Error, f95Fetch, onSignedInPage, onSignedOutPage, type SignedOutPage } from './http'
import {
  parseTwoStepError,
  parseTwoStepForm,
  signedInAfterAuthStep,
  signedInUsername,
  type TwoStepForm
} from './two-step-parse'

const TOKEN_RE = /name="_xfToken"\s+value="([^"]+)"/
const AUTH_ERROR_RE =
  /<div class="blockMessage blockMessage--error[^"]*"[^>]*>([\s\S]*?)<\/div>/i
const TWO_STEP_URL = 'https://f95zone.to/login/two-step'
const HOME_URL = 'https://f95zone.to/'
const LOGGED_OUT: AuthSession = { loggedIn: false, userId: null, username: null }

type PendingTwoStep = {
  loginName: string
  form: TwoStepForm
}

let pendingTwoStep: PendingTwoStep | null = null
let sessionLost = false
let recovery: Promise<void> | null = null

function currentSession(): AuthSession {
  const xfUser = getCookie('xf_user')
  return {
    loggedIn: Boolean(xfUser) && !sessionLost && !pendingTwoStep,
    userId: getSession().userId ?? userIdFromXfUser(xfUser),
    username: getSession().username
  }
}

export async function getAuthSession(): Promise<AuthSession> {
  const xfUser = getCookie('xf_user')
  if (!xfUser) {
    return LOGGED_OUT
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

function landedSignedIn(response: Response, body: string): boolean {
  return Boolean(getCookie('xf_user')) && signedInAfterAuthStep(body, response.url || HOME_URL)
}

function emitAuthChange(change: AuthChange): void {
  sendToRenderer('auth:changed', change)
}

function usernameFor(loginName: string, page: string): string | null {
  return signedInUsername(page) || (loginName && !loginName.includes('@') ? loginName : null)
}

async function completeLogin(loginName: string, page: string): Promise<LoginResult> {
  const xfUser = getCookie('xf_user')
  if (!xfUser) {
    throw new F95Error('Login failed. F95zone did not return a session.', 'auth_failed')
  }
  pendingTwoStep = null
  sessionLost = false
  resetCatalogRequestState()
  setUserId(userIdFromXfUser(xfUser))
  const username = usernameFor(loginName, page)
  if (username) setUsername(username)
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
  sessionLost = false
  await clearSession()
  resetCatalogRequestState()

  const { body: loginPage } = await f95Fetch('/login/', {}, { authFlow: true })
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

  const { response, body } = await f95Fetch(
    '/login/login',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://f95zone.to',
        Referer: 'https://f95zone.to/login/'
      },
      body: form.toString()
    },
    { authFlow: true }
  )

  const pageUrl = pageUrlOf(response)
  if (landedSignedIn(response, body)) {
    return completeLogin(loginName, body)
  }

  const twoStep = parseTwoStepForm(body, pageUrl)
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

  const { response, body } = await f95Fetch(
    pending.form.action,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://f95zone.to',
        Referer: TWO_STEP_URL
      },
      body: fields.toString()
    },
    { authFlow: true }
  )

  const pageUrl = pageUrlOf(response)
  if (landedSignedIn(response, body)) {
    return completeLogin(pending.loginName, body)
  }

  const error = parseTwoStepError(body) || 'The verification code was not accepted. Try again.'
  const next = parseTwoStepForm(body, pageUrl)
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

  const { response, body } = await f95Fetch(
    url,
    { headers: { Referer: TWO_STEP_URL } },
    { authFlow: true }
  )
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
  sessionLost = false
  await clearSession()
  resetCatalogRequestState()
  return LOGGED_OUT
}

export async function logout(): Promise<AuthSession> {
  pendingTwoStep = null
  sessionLost = false
  await clearSession()
  resetCatalogRequestState()
  return LOGGED_OUT
}

/**
 * F95zone sessions expire quickly and the remember cookie brings them back, but
 * an account with two-step verification is sent to /login/two-step unless this
 * device is trusted. Every later request on that guest session just looks signed
 * out, so drop it and ask for a fresh challenge.
 */
async function rememberCookieChallenge(): Promise<TwoStepForm | { restored: string } | null> {
  if (!getCookie('xf_user')) return null
  await removeCookies(['xf_session'])
  const { response, body } = await f95Fetch('/', {}, { authFlow: true })
  const pageUrl = pageUrlOf(response)
  const form = parseTwoStepForm(body, pageUrl)
  if (form) return form
  return landedSignedIn(response, body) ? { restored: body } : null
}

async function recoverSession(page: SignedOutPage): Promise<void> {
  sessionLost = true
  resetCatalogRequestState()
  const outcome = parseTwoStepForm(page.body, page.url) ?? (await rememberCookieChallenge())
  if (outcome && 'restored' in outcome) {
    sessionLost = false
    const username = signedInUsername(outcome.restored)
    if (username) setUsername(username)
    await persistSessionNow()
    emitAuthChange({ status: 'ok', session: currentSession() })
    return
  }
  if (outcome) {
    pendingTwoStep = { loginName: getSession().username ?? '', form: outcome }
    emitAuthChange({ status: 'two_step', challenge: challengeFrom(outcome, null) })
    return
  }
  pendingTwoStep = null
  await clearSession()
  emitAuthChange({ status: 'logged_out', session: LOGGED_OUT })
}

onSignedInPage((page) => {
  if (getSession().username || sessionLost || pendingTwoStep || !getCookie('xf_user')) return
  const username = signedInUsername(page)
  if (!username) return
  setUsername(username)
  void persistSessionNow().catch((error) => console.warn('[f95] could not save the username', error))
  emitAuthChange({ status: 'session', session: currentSession() })
})

onSignedOutPage((page) => {
  if (sessionLost || recovery) return
  recovery = recoverSession(page)
    .catch((error) => {
      console.warn('[f95] could not recover the F95zone session', error)
      pendingTwoStep = null
      emitAuthChange({ status: 'logged_out', session: LOGGED_OUT })
    })
    .finally(() => {
      recovery = null
    })
})
