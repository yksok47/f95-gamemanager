import type { GameFileContext } from '@shared/types'
import {
  isConnectedProvider,
  isMaskedDownloadLink,
  mirrorProvider,
  type ConnectedProviderId
} from '@shared/download-providers'
import { resolveBuzzheavierDownload } from './buzzheavier'
import { resolveDataNodesDownload } from './datanodes'
import { resolveGoogleDriveDownload } from './gdrive'
import { resolveGoFileDownload } from './gofile'
import { resolveMediaFireDownload } from './mediafire'
import { resolveMegaDownload } from './mega'
import { resolveMixdropDownload } from './mixdrop'
import { resolvePixeldrainDownload } from './pixeldrain'
import { resolveUploadHavenDownload } from './uploadhaven'
import { resolveVikingFileDownload } from './vikingfile'
import { resolveWorkuploadDownload } from './workupload'
import { resolveF95MaskedUrl } from './f95/masked'

/** `started` means the connector already handed a download to the session. */
export type ConnectorDownloadResult = string | 'started' | 'cancel' | null

/** Turns a host page URL into a file URL the session can download, or null to fall back to a browser window. */
type DownloadConnector = (
  pageUrl: string,
  context?: GameFileContext
) => Promise<ConnectorDownloadResult>

const CONNECTORS: Record<ConnectedProviderId, DownloadConnector> = {
  mediafire: resolveMediaFireDownload,
  pixeldrain: resolvePixeldrainDownload,
  gofile: resolveGoFileDownload,
  buzzheavier: resolveBuzzheavierDownload,
  datanodes: resolveDataNodesDownload,
  workupload: resolveWorkuploadDownload,
  uploadhaven: resolveUploadHavenDownload,
  vikingfile: resolveVikingFileDownload,
  mega: resolveMegaDownload,
  gdrive: resolveGoogleDriveDownload,
  mixdrop: resolveMixdropDownload
}

export async function resolveConnectorDownload(
  pageUrl: string,
  context?: GameFileContext
): Promise<ConnectorDownloadResult> {
  let href = pageUrl
  if (isMaskedDownloadLink(href)) {
    const unmasked = await resolveF95MaskedUrl(href)
    if (!unmasked) return null
    href = unmasked
  }
  const provider = mirrorProvider({ label: '', url: href })
  if (!isConnectedProvider(provider)) return null
  return CONNECTORS[provider](href, context)
}
