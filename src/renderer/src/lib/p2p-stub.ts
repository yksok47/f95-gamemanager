import type { P2pDownloadOptionStub } from '@shared/p2p'
import { normalizePackageFilename } from '@shared/content-address'

/** Local-only stub when preload p2p API is unavailable during early UI work */
export function localP2pStubOptions(filename: string): P2pDownloadOptionStub[] {
  const normalizedName = normalizePackageFilename(filename)
  return [
    {
      contentHash: null,
      normalizedName,
      label: `${normalizedName || filename} (P2P stub)`,
      uniqueSeederPubkeyCount: 3,
      flags: [],
      stub: true
    }
  ]
}
