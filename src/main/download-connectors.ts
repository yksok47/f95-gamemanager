import {
  isConnectedProvider,
  isMaskedDownloadLink,
  mirrorProvider,
  type ConnectedProviderId
} from '@shared/download-providers'
import { resolveMediaFireDownload } from './mediafire'

/** Turns a host page URL into a file URL the session can download, or null to fall back to a browser window. */
type DownloadConnector = (pageUrl: string) => Promise<string | null>

const CONNECTORS: Record<ConnectedProviderId, DownloadConnector> = {
  mediafire: resolveMediaFireDownload
}

export async function resolveConnectorDownload(pageUrl: string): Promise<string | null> {
  if (isMaskedDownloadLink(pageUrl)) return null
  const provider = mirrorProvider({ label: '', url: pageUrl })
  if (!isConnectedProvider(provider)) return null
  return CONNECTORS[provider](pageUrl)
}
