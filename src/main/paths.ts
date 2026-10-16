import { app } from 'electron'
import { join } from 'path'

/**
 * Local layout for the POC and later library features.
 * Only the session file is used today. Download/install roots stay here
 * so filesystem work can grow without moving auth/catalog code.
 */
export function getAppPaths(): {
  userData: string
  sessionFile: string
  subscriptionsFile: string
  settingsFile: string
  googleDriveTokenFile: string
  gameFilesFile: string
  p2pTorrentMapFile: string
  p2pDownloadsFile: string
  p2pIdentityFile: string
  p2pTorrentsDir: string
  downloadsHistoryFile: string
  gameNotesFile: string
  threadReadFile: string
  saveFoldersFile: string
  cloudSaveManifestsDir: string
  cloudUserDataStateFile: string
  cloudUserDataApplyFile: string
  libraryImportsFile: string
  renpyOptionsFile: string
  rosterFile: string
  requestLogFile: string
  downloadsDir: string
  libraryDir: string
  imageCacheDir: string
} {
  const userData = app.getPath('userData')
  return {
    userData,
    sessionFile: join(userData, 'session.json'),
    subscriptionsFile: join(userData, 'subscriptions.json'),
    settingsFile: join(userData, 'settings.json'),
    googleDriveTokenFile: join(userData, 'google-drive-token.json'),
    gameFilesFile: join(userData, 'game-files.json'),
    p2pTorrentMapFile: join(userData, 'p2p-torrent-map.json'),
    p2pDownloadsFile: join(userData, 'p2p-downloads.json'),
    p2pIdentityFile: join(userData, 'p2p-identity.json'),
    p2pTorrentsDir: join(userData, 'p2p-torrents'),
    downloadsHistoryFile: join(userData, 'downloads-history.json'),
    gameNotesFile: join(userData, 'game-notes.json'),
    threadReadFile: join(userData, 'thread-read.json'),
    saveFoldersFile: join(userData, 'save-folders.json'),
    cloudSaveManifestsDir: join(userData, 'cloud-save-manifests'),
    cloudUserDataStateFile: join(userData, 'cloud-user-data.json'),
    cloudUserDataApplyFile: join(userData, 'cloud-user-data-apply.json'),
    libraryImportsFile: join(userData, 'library-imports.json'),
    renpyOptionsFile: join(userData, 'renpy-options.json'),
    rosterFile: join(userData, 'roster.json'),
    requestLogFile: join(userData, 'request-log.json'),
    downloadsDir: join(userData, 'downloads'),
    libraryDir: join(userData, 'library'),
    imageCacheDir: join(userData, 'image-cache')
  }
}
