import { createHash, randomBytes } from 'crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { mkdir, readFile, rm, writeFile } from 'fs/promises'
import { dirname } from 'path'
import { shell } from 'electron'
import type { CloudSaveAccount } from '@shared/types'
import { getAppPaths } from '../paths'
import { sendToRenderer } from '../windows'
import { loadGoogleClient } from './credentials'
import { setCloudSavePhase, setCloudSignInUrl } from './status'

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const LOGIN_TIMEOUT_MS = 5 * 60_000

type StoredToken = {
  accessToken: string
  refreshToken: string
  expiry: number
  tokenType: string
  email: string | null
}

type TokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  error?: string
  error_description?: string
}

let memory: StoredToken | null | undefined
let loginInFlight: Promise<CloudSaveAccount> | null = null

function tokenFile(): string {
  return getAppPaths().googleDriveTokenFile
}

function asToken(value: unknown): StoredToken | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Partial<StoredToken>
  const accessToken = typeof raw.accessToken === 'string' ? raw.accessToken : ''
  const refreshToken = typeof raw.refreshToken === 'string' ? raw.refreshToken : ''
  if (!accessToken && !refreshToken) return null
  return {
    accessToken,
    refreshToken,
    expiry: Number(raw.expiry) || 0,
    tokenType: typeof raw.tokenType === 'string' ? raw.tokenType : 'Bearer',
    email: typeof raw.email === 'string' && raw.email.trim() ? raw.email.trim() : null
  }
}

async function readToken(): Promise<StoredToken | null> {
  if (memory !== undefined) return memory
  try {
    memory = asToken(JSON.parse(await readFile(tokenFile(), 'utf8')))
  } catch {
    memory = null
  }
  return memory
}

async function writeToken(token: StoredToken | null): Promise<void> {
  memory = token
  const file = tokenFile()
  if (!token) {
    await rm(file, { force: true })
    return
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(token, null, 2), 'utf8')
}

export function presentCloudAccount(token: StoredToken | null): CloudSaveAccount {
  return {
    signedIn: Boolean(token?.refreshToken || (token?.accessToken && token.expiry > Date.now() + 30_000)),
    email: token?.email ?? null
  }
}

export async function getCloudSaveAccount(): Promise<CloudSaveAccount> {
  return presentCloudAccount(await readToken())
}

function broadcastAccount(): void {
  void getCloudSaveAccount().then((account) => sendToRenderer('cloud-saves:account', account))
}

function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const client = loadGoogleClient()
  const payload = new URLSearchParams({
    client_id: client.clientId,
    client_secret: client.clientSecret,
    ...body
  })
  const res = await fetch(client.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString()
  })
  const json = (await res.json().catch(() => ({}))) as TokenResponse
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `Google token request failed (${res.status})`)
  }
  return json
}

async function fetchEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)', {
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    if (!res.ok) return null
    const json = (await res.json()) as { user?: { emailAddress?: string } }
    return json.user?.emailAddress?.trim() || null
  } catch {
    return null
  }
}

async function persistFromGoogle(json: TokenResponse, previous?: StoredToken | null): Promise<StoredToken> {
  const accessToken = json.access_token || previous?.accessToken || ''
  const refreshToken = json.refresh_token || previous?.refreshToken || ''
  if (!accessToken) throw new Error('Google did not return an access token.')
  const expiresIn = Number(json.expires_in) || 3600
  const token: StoredToken = {
    accessToken,
    refreshToken,
    expiry: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    tokenType: json.token_type || 'Bearer',
    email: previous?.email ?? null
  }
  if (!token.email) token.email = await fetchEmail(accessToken)
  await writeToken(token)
  broadcastAccount()
  return token
}

export async function getAccessToken(): Promise<string> {
  const current = await readToken()
  if (!current?.refreshToken && !current?.accessToken) {
    throw new Error('Sign in to Google Drive in Settings → Cloud first.')
  }
  if (current.accessToken && current.expiry > Date.now() + 15_000) return current.accessToken
  if (!current.refreshToken) throw new Error('Google Drive sign-in expired. Sign in again.')
  const json = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken
  })
  const next = await persistFromGoogle(json, current)
  return next.accessToken
}

export async function hasCloudSaveSession(): Promise<boolean> {
  const token = await readToken()
  return Boolean(token?.refreshToken || (token?.accessToken && token.expiry > Date.now()))
}

function sendHtml(res: ServerResponse, status: number, title: string, body: string): void {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:sans-serif;padding:2rem"><h1>${title}</h1><p>${body}</p></body></html>`
  )
}

function startLoopback(expectedState: string): Promise<{
  redirectUri: string
  done: Promise<{ code: string; redirectUri: string }>
}> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    // Bind all local interfaces so http://localhost (IPv4 or IPv6) can return the code.
    server.listen(0, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      if (!port) {
        server.close()
        reject(new Error('Could not start the Google sign-in listener.'))
        return
      }
      // Desktop client JSON lists "http://localhost"; 127.0.0.1 is a different host and 400s.
      const redirectUri = `http://localhost:${port}`
      const done = new Promise<{ code: string; redirectUri: string }>((ok, fail) => {
        const timer = setTimeout(() => {
          cleanup()
          fail(new Error('Google sign-in timed out. Try again from Settings.'))
        }, LOGIN_TIMEOUT_MS)

        function cleanup(): void {
          clearTimeout(timer)
          server.close()
        }

        server.on('request', (req: IncomingMessage, res: ServerResponse) => {
          try {
            const url = new URL(req.url || '/', redirectUri)
            if (url.pathname === '/favicon.ico') {
              res.writeHead(204)
              res.end()
              return
            }
            const error = url.searchParams.get('error')
            if (error) {
              sendHtml(res, 400, 'Sign-in cancelled', 'You can close this tab and return to the app.')
              cleanup()
              fail(
                new Error(
                  error === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed: ${error}`
                )
              )
              return
            }
            const state = url.searchParams.get('state') || ''
            const code = url.searchParams.get('code') || ''
            if (state !== expectedState || !code) {
              sendHtml(
                res,
                400,
                'Sign-in failed',
                'The sign-in response did not match this app. Close this tab and try again.'
              )
              return
            }
            sendHtml(res, 200, 'Signed in', 'You can close this tab and return to F95 Game Manager.')
            cleanup()
            ok({ code, redirectUri })
          } catch (error) {
            cleanup()
            fail(error)
          }
        })
      })
      resolve({ redirectUri, done })
    })
  })
}

function buildAuthUrl(input: {
  clientId: string
  redirectUri: string
  state: string
  challenge: string
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    code_challenge: input.challenge,
    code_challenge_method: 'S256',
    state: input.state
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
}

async function runSignIn(openBrowser: boolean): Promise<CloudSaveAccount> {
  const client = loadGoogleClient()
  const state = base64Url(randomBytes(16))
  const verifier = base64Url(randomBytes(32))
  const challenge = base64Url(createHash('sha256').update(verifier).digest())
  setCloudSavePhase('signing-in')
  try {
    const loopback = await startLoopback(state)
    const authUrl = buildAuthUrl({
      clientId: client.clientId,
      redirectUri: loopback.redirectUri,
      state,
      challenge
    })
    setCloudSignInUrl(authUrl)
    if (openBrowser) await shell.openExternal(authUrl)
    const { code, redirectUri } = await loopback.done
    const json = await tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier
    })
    const token = await persistFromGoogle(json, await readToken())
    return presentCloudAccount(token)
  } finally {
    setCloudSavePhase('idle')
  }
}

export async function signInCloudSaves(openBrowser = true): Promise<CloudSaveAccount> {
  if (loginInFlight) return loginInFlight
  loginInFlight = runSignIn(openBrowser).finally(() => {
    loginInFlight = null
  })
  return loginInFlight
}

export async function signOutCloudSaves(): Promise<CloudSaveAccount> {
  const token = await readToken()
  const revoke = token?.refreshToken || token?.accessToken
  if (revoke) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(revoke)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      })
    } catch {
      // Local sign-out still proceeds.
    }
  }
  await writeToken(null)
  broadcastAccount()
  return getCloudSaveAccount()
}
