import { normalizePackageInstallTags, type PackageInstallTags } from '@shared/p2p'
import { getPackage } from './p2p/metadata-client'

export async function knownInstallTags(
  contentHash: string,
  ...fallbacks: Array<PackageInstallTags | null | undefined>
): Promise<PackageInstallTags | null> {
  const pkg = await getPackage(contentHash.trim().toLowerCase())
  for (const candidate of [pkg?.consensus, ...fallbacks]) {
    if (!candidate || !Number.isFinite(candidate.contentKind)) continue
    try {
      return normalizePackageInstallTags({
        os: [...(candidate.os ?? [])],
        contentKind: candidate.contentKind,
        version: candidate.version ?? ''
      })
    } catch {
      continue
    }
  }
  return null
}
