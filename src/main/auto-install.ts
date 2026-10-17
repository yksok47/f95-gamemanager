import { isInstallableLibraryPackage, isRenpyOverlayPackage } from '@shared/types'
import { compareLibraryFilesByVersion } from '@shared/updates'
import {
  installGameFile,
  installUncensorPatch,
  latestInstalledFile,
  listGameFiles,
  listUncensorPatchTargets,
  uninstallGameFile
} from './game-files-store'
import { getAutoInstallDownloadsSync } from './settings-store'

export async function autoInstallApprovedPackage(
  threadId: number | null | undefined,
  contentHash: string | null | undefined
): Promise<void> {
  if (!getAutoInstallDownloadsSync()) return
  const hash = contentHash?.trim().toLowerCase()
  if (threadId == null || !hash) return
  const files = await listGameFiles(Number(threadId))
  const file = files.find((item) => item.hash?.trim().toLowerCase() === hash)
  if (!file?.hasArchive) return

  if (isInstallableLibraryPackage(file.packageTags)) {
    if (file.isInstalled) return
    const previous = latestInstalledFile(files)
    await installGameFile(file.id)
    if (
      previous &&
      previous.id !== file.id &&
      !previous.playing &&
      compareLibraryFilesByVersion(file, previous) > 0
    ) {
      await uninstallGameFile(previous.id)
    }
    return
  }

  if (!isRenpyOverlayPackage(file.packageTags)) return
  const target = listUncensorPatchTargets(files, file).at(-1)
  if (target) await installUncensorPatch(file.id, target.id)
}

export function startAutoInstall(
  threadId: number | null | undefined,
  contentHash: string | null | undefined
): void {
  void autoInstallApprovedPackage(threadId, contentHash).catch((error) => {
    console.warn('[downloads] auto-install after approve failed', error)
  })
}
