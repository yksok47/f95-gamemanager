import { basename, resolve } from 'path'
import { listIdentifiedSaveFolders } from '../save-folders-store'
import {
  findRpgMakerGameSaveDir,
  listRpgMakerBackupFolders,
  rpgMakerBackupDir,
  rpgMakerSavesRoot,
  syncRpgMakerSaves
} from '../rpgmaker/saves'
import { pathExists } from '../win-path'
import { folderKey } from './manifest'

export const RPG_FOLDER = 'rpgmaker'

export type LocalSaveSource = {
  key: string
  title: string
  localDir: string
}

function normPath(value: string): string {
  return resolve(value).replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/** True when this folder is the RPG Maker backup or the in-game www/save copy. */
export function isRpgMakerManagedSavePath(
  savePath: string,
  backupPath: string,
  gameSavePath: string | null,
  rpgRoot: string
): boolean {
  if (!savePath) return false
  const target = normPath(savePath)
  if (target === normPath(backupPath)) return true
  if (gameSavePath && target === normPath(gameSavePath)) return true
  const root = normPath(rpgRoot)
  if (target === root || target.startsWith(`${root}/`)) return true
  if (target.endsWith('/www/save')) return true
  return false
}

export async function listLocalSaveSources(
  threadId: number
): Promise<{ title: string; sources: LocalSaveSource[] }> {
  const identified = (await listIdentifiedSaveFolders()).filter((item) => item.threadId === threadId)
  const sources: LocalSaveSource[] = []
  const seen = new Set<string>()
  let title = ''

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
  const gameSavePath = findRpgMakerGameSaveDir(installPath)
  const rpgRoot = rpgMakerSavesRoot()

  function addSource(key: string, sourceTitle: string, localDir: string): void {
    if (!key || seen.has(key)) return
    seen.add(key)
    sources.push({ key, title: sourceTitle, localDir })
  }

  for (const rec of identified) {
    title = title || rec.title
    if (!rec.savePath || !pathExists(rec.savePath)) continue
    if (isRpgMakerManagedSavePath(rec.savePath, backupPath, gameSavePath, rpgRoot)) continue
    addSource(folderKey(rec.folderName || basename(rec.savePath)), rec.title, rec.savePath)
  }
  for (const rec of identified) {
    title = title || rec.title
    if (!rec.savePath || pathExists(rec.savePath)) continue
    if (isRpgMakerManagedSavePath(rec.savePath, backupPath, gameSavePath, rpgRoot)) continue
    addSource(folderKey(rec.folderName || basename(rec.savePath)), rec.title, rec.savePath)
  }

  if (installPath) {
    try {
      await syncRpgMakerSaves({ installPath, threadId, title, mode: 'merge' })
    } catch (error) {
      console.warn('Could not merge RPG Maker saves before cloud sync', error)
    }
  }
  if (pathExists(backupPath)) {
    addSource(RPG_FOLDER, title, backupPath)
  }
  return { title: title || `Thread ${threadId}`, sources }
}

export { listRpgMakerBackupFolders }
