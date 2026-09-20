import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { pathExists } from '../win-path'

export type GoogleInstalledClient = {
  clientId: string
  clientSecret: string
  tokenUri: string
  authUri: string
}

type InstalledJson = {
  installed?: {
    client_id?: string
    client_secret?: string
    token_uri?: string
    auth_uri?: string
  }
}

function parseClient(raw: string): GoogleInstalledClient | null {
  try {
    const parsed = JSON.parse(raw) as InstalledJson
    const installed = parsed.installed
    const clientId = installed?.client_id?.trim() || ''
    const clientSecret = installed?.client_secret?.trim() || ''
    if (!clientId || !clientSecret) return null
    return {
      clientId,
      clientSecret,
      tokenUri: installed?.token_uri?.trim() || 'https://oauth2.googleapis.com/token',
      authUri: installed?.auth_uri?.trim() || 'https://accounts.google.com/o/oauth2/auth'
    }
  } catch {
    return null
  }
}

function candidateFiles(): string[] {
  const files = [
    join(process.resourcesPath || '', 'google-oauth.json'),
    join(app.getAppPath(), 'resources', 'google-oauth.json'),
    join(__dirname, '../../resources/google-oauth.json'),
    join(process.cwd(), 'resources', 'google-oauth.json')
  ]
  const searchDirs = [process.cwd(), join(process.cwd(), '..')]
  for (const dir of searchDirs) {
    try {
      for (const name of readdirSync(dir)) {
        if (/^client_secret_.*\.apps\.googleusercontent\.com\.json$/i.test(name)) {
          files.push(join(dir, name))
        }
      }
    } catch {
      // Folder may not exist (packaged app).
    }
  }
  return files
}

let cached: GoogleInstalledClient | null | undefined

export function loadGoogleClient(): GoogleInstalledClient {
  if (cached) return cached
  for (const file of candidateFiles()) {
    if (!file || !pathExists(file)) continue
    try {
      const parsed = parseClient(readFileSync(file, 'utf8'))
      if (parsed) {
        cached = parsed
        return parsed
      }
    } catch {
      // Try the next location.
    }
  }
  throw new Error(
    'Google Drive client credentials are missing. Place google-oauth.json in the app resources folder.'
  )
}
