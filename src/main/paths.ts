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
  gameFilesFile: string
  downloadsDir: string
  libraryDir: string
} {
  const userData = app.getPath('userData')
  return {
    userData,
    sessionFile: join(userData, 'session.json'),
    subscriptionsFile: join(userData, 'subscriptions.json'),
    settingsFile: join(userData, 'settings.json'),
    gameFilesFile: join(userData, 'game-files.json'),
    downloadsDir: join(userData, 'downloads'),
    libraryDir: join(userData, 'library')
  }
}
