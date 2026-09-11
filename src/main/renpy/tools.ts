import { unlink } from 'fs/promises'
import { join } from 'path'
import { pathExists } from '../win-path'

export const MANAGED_OPTIONS_FILE = 'f95gm-options.rpy'

export const LEGACY_UNREN_TOOL_FILES = [
  'unren-dev.rpy',
  'unren-quick.rpy',
  'unren-skip.rpy',
  'unren-rollback.rpy'
] as const

const SKIP_SCRIPT_NAMES = new Set<string>([
  MANAGED_OPTIONS_FILE,
  ...LEGACY_UNREN_TOOL_FILES
])

export function isRenpyToolScript(name: string): boolean {
  return SKIP_SCRIPT_NAMES.has(name.toLowerCase())
}

const LEGACY_UNREN_TOOL_NAMES = new Set<string>(LEGACY_UNREN_TOOL_FILES)

export function isLegacyUnrenToolScript(name: string): boolean {
  return LEGACY_UNREN_TOOL_NAMES.has(name.toLowerCase())
}

export async function removeLegacyUnrenTools(gameDir: string): Promise<void> {
  for (const name of LEGACY_UNREN_TOOL_FILES) {
    const file = join(gameDir, name)
    if (pathExists(file)) await unlink(file)
  }
}
