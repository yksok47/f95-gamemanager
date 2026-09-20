import { engineKind } from '@shared/engines'
import type { GameLibraryFile, RenpyToolId } from '@shared/types'
import { isInstallableLibraryPackage } from '@shared/types'
import { listGameFiles } from '../game-files-store'
import { findRenpyGameRoot } from '../launch'
import {
  EMPTY_OPTIONS,
  OPTION_IDS,
  readRenpyOptions,
  setRenpyOptions,
  type OptionValues
} from './options'
import {
  isRenpyOptionsGlobalEnabled,
  resolveDesiredRenpyOptions,
  saveDesiredRenpyOptions,
  setRenpyOptionsGlobalEnabled
} from './options-prefs-store'
import { gameDirFromRoot } from './scan'

function optionsMatch(current: OptionValues, desired: OptionValues): boolean {
  return OPTION_IDS.every((id) => current[id] === desired[id])
}

function isRenpyInstall(file: Pick<GameLibraryFile, 'installPath' | 'engine' | 'packageTags'>): boolean {
  if (!file.installPath) return false
  if (!isInstallableLibraryPackage(file.packageTags)) return false
  if (engineKind(file.engine) === 'renpy') return true
  return Boolean(findRenpyGameRoot(file.installPath))
}

async function listInstalledRenpyFiles(threadId?: number): Promise<GameLibraryFile[]> {
  const files = await listGameFiles(threadId)
  return files.filter((file) => file.isInstalled && isRenpyInstall(file))
}

export async function applyDesiredOptionsToGameDir(
  gameDir: string,
  desired: OptionValues,
  savePath?: string | null
): Promise<boolean> {
  const current = readRenpyOptions(gameDir, savePath)
  if (optionsMatch(current, desired)) return false
  await setRenpyOptions(gameDir, desired, savePath)
  return true
}

export async function ensureRenpyOptionsForInstallPath(
  installPath: string,
  threadId: number
): Promise<void> {
  const desired = await resolveDesiredRenpyOptions(threadId)
  if (!desired) return
  const gameRoot = findRenpyGameRoot(installPath)
  if (!gameRoot) return
  await applyDesiredOptionsToGameDir(gameDirFromRoot(gameRoot), desired)
}

export async function ensureRenpyOptionsForLibraryFile(
  file: Pick<GameLibraryFile, 'installPath' | 'threadId' | 'engine' | 'packageTags'>
): Promise<void> {
  if (!file.installPath || !isRenpyInstall(file)) return
  await ensureRenpyOptionsForInstallPath(file.installPath, file.threadId)
}

async function applyDesiredToTargets(
  desired: OptionValues,
  threadId?: number
): Promise<void> {
  const files = await listInstalledRenpyFiles(threadId)
  for (const file of files) {
    if (!file.installPath) continue
    const gameRoot = findRenpyGameRoot(file.installPath)
    if (!gameRoot) continue
    try {
      await applyDesiredOptionsToGameDir(gameDirFromRoot(gameRoot), desired)
    } catch (error) {
      console.warn('[renpy-options] apply failed', file.id, error)
    }
  }
}

export async function setStoredRenpyOption(
  threadId: number,
  current: OptionValues,
  tool: RenpyToolId,
  enabled: boolean
): Promise<OptionValues> {
  const desired = { ...current, [tool]: enabled }
  await saveDesiredRenpyOptions(threadId, desired)
  const global = await isRenpyOptionsGlobalEnabled()
  await applyDesiredToTargets(desired, global ? undefined : threadId)
  return desired
}

export async function setStoredAllRenpyOptions(
  threadId: number,
  enabled: boolean
): Promise<OptionValues> {
  const desired = Object.fromEntries(OPTION_IDS.map((id) => [id, enabled])) as OptionValues
  await saveDesiredRenpyOptions(threadId, desired)
  const global = await isRenpyOptionsGlobalEnabled()
  await applyDesiredToTargets(desired, global ? undefined : threadId)
  return desired
}

export async function setRenpyOptionsGlobalMode(
  enabled: boolean,
  seedFrom?: OptionValues | null
): Promise<{ globalEnabled: boolean; tools: OptionValues }> {
  const store = await setRenpyOptionsGlobalEnabled(enabled, seedFrom)
  if (store.globalEnabled) {
    await applyDesiredToTargets(store.global)
  }
  return { globalEnabled: store.globalEnabled, tools: { ...store.global } }
}

export async function readEffectiveRenpyOptions(
  gameDir: string | null,
  savePath?: string | null
): Promise<OptionValues> {
  if (!gameDir) return { ...EMPTY_OPTIONS }
  return readRenpyOptions(gameDir, savePath)
}

export async function ensureDesiredOnGameDir(
  threadId: number,
  gameDir: string | null,
  savePath?: string | null
): Promise<OptionValues> {
  if (!gameDir) return { ...EMPTY_OPTIONS }
  const desired = await resolveDesiredRenpyOptions(threadId)
  if (desired) {
    try {
      await applyDesiredOptionsToGameDir(gameDir, desired, savePath)
    } catch (error) {
      console.warn('[renpy-options] ensure failed', threadId, error)
    }
  }
  return readRenpyOptions(gameDir, savePath)
}
