import { createHash } from 'crypto'
import { isWorkuploadPageUrl, resolveWorkuploadFromFetch } from '@shared/workupload'
import { sessionFetch } from './connector-session'

export { isWorkuploadPageUrl }

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export async function resolveWorkuploadDownload(pageUrl: string): Promise<string | null> {
  if (!isWorkuploadPageUrl(pageUrl)) return null
  try {
    return await resolveWorkuploadFromFetch(pageUrl, sessionFetch(), sha256Hex)
  } catch (error) {
    console.warn('[workupload] could not resolve download URL', error)
    return null
  }
}
