import { basename } from 'path'
import { listIdentifiedSaveFolders } from '../save-folders-store'
import { listRpgMakerBackupFolders, rpgMakerBackupDir, syncRpgMakerSaves } from '../rpgmaker/saves'
import { pathExists } from '../win-path'
import { folderKey } from './manifest'

export const RPG_FOLDER = 'rpgmaker'

export type LocalSaveSource = {
  key: string
  title: string
  localDir: string
}

export async function listLocalSaveSources(
  threadId: number
): Promise<{ title: string; sources: LocalSaveSource[] }> {
  const identified = (await listIdentifiedSaveFolders()).filter((item) => item.threadId === threadId)
  const sources: LocalSaveSource[] = []
  const seen = new Set<string>()
  let title = ''
  for (const rec of identified) {
    title = title || rec.title
    if (!rec.savePath || !pathExists(rec.savePath)) continue
    const key = folderKey(rec.folderName || basename(rec.savePath))
    if (seen.has(key)) continue
    seen.add(key)
    sources.push({ key, title: rec.title, localDir: rec.savePath })
  }
  for (const rec of identified) {
    title = title || rec.title
    if (!rec.savePath || pathExists(rec.savePath)) continue
    const key = folderKey(rec.folderName || basename(rec.savePath))
    if (seen.has(key)) continue
    seen.add(key)
    sources.push({ key, title: rec.title, localDir: rec.savePath })
  }

  let installPath: string | null = null
  try {
    const { listGameFiles } = await import('../game-files-store')
    const files = await listGameFiles(threadId)
    const installed = files.find((file) => file.installPath && pathExists(file.installPath))
    installPath = installed?.installPath || null
    title = title || installed?.title || files[0]?.title || ''
  } catch {
    // Library lookup is optional; identified folders still sync.
  }

  const backupPath = rpgMakerBackupDir(threadId)
  if (installPath) {
    try {
      await syncRpgMakerSaves({ installPath, threadId, title, mode: 'merge' })
    } catch (error) {
      console.warn('Could not merge RPG Maker saves before cloud sync', error)
    }
  }
  if (pathExists(backupPath)) {
    sources.push({ key: RPG_FOLDER, title, localDir: backupPath })
  }
  return { title: title || `Thread ${threadId}`, sources }
}

export { listRpgMakerBackupFolders }
