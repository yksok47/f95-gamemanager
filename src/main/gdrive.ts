import { isGoogleDrivePageUrl, resolveGoogleDriveFromFetch } from '@shared/gdrive'
import { sessionFetch } from './connector-session'

export { isGoogleDrivePageUrl }

export async function resolveGoogleDriveDownload(pageUrl: string): Promise<string | null> {
  if (!isGoogleDrivePageUrl(pageUrl)) return null
  try {
    return await resolveGoogleDriveFromFetch(pageUrl, sessionFetch())
  } catch (error) {
    console.warn('[gdrive] could not resolve download URL', error)
    return null
  }
}
