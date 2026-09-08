import { mkdir, unlink, writeFile } from 'fs/promises'
import { dirname, join } from 'path'
import type { RenpyToolId } from '@shared/types'
import { pathExists } from '../win-path'

export const TOOL_FILES: Record<RenpyToolId, string> = {
  console: 'unren-dev.rpy',
  quick: 'unren-quick.rpy',
  skip: 'unren-skip.rpy',
  rollback: 'unren-rollback.rpy'
}

export function toolFilePath(gameDir: string, tool: RenpyToolId): string {
  return join(gameDir, TOOL_FILES[tool])
}

const TOOL_SCRIPTS: Record<RenpyToolId, string> = {
  console: `init 999 python:
  config.developer = True
  config.console = True
`,
  quick: `init 999 python:
  try:
    config.underlay[0].keymap['quickSave'] = QuickSave()
    config.keymap['quickSave'] = 'K_F5'
    config.underlay[0].keymap['quickLoad'] = QuickLoad()
    config.keymap['quickLoad'] = 'K_F9'
  except:
    pass
`,
  skip: `init 999 python:
  _preferences.skip_unseen = True
  renpy.game.preferences.skip_unseen = True
  renpy.config.allow_skipping = True
  renpy.config.fast_skipping = True
`,
  rollback: `init 999 python:
  renpy.config.rollback_enabled = True
  renpy.config.hard_rollback_limit = 256
  renpy.config.rollback_length = 256
  def unren_noblock( *args, **kwargs ):
    return
  renpy.block_rollback = unren_noblock
  try:
    config.keymap['rollback'] = [ 'K_PAGEUP', 'repeat_K_PAGEUP', 'K_AC_BACK', 'mousedown_4' ]
  except:
    pass
`
}

export async function setRenpyTool(gameDir: string, tool: RenpyToolId, enabled: boolean): Promise<void> {
  const file = toolFilePath(gameDir, tool)
  if (!enabled) {
    if (pathExists(file)) await unlink(file)
    return
  }
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, TOOL_SCRIPTS[tool], 'utf8')
}

export async function setAllRenpyTools(gameDir: string, enabled: boolean): Promise<void> {
  for (const tool of Object.keys(TOOL_SCRIPTS) as RenpyToolId[]) {
    await setRenpyTool(gameDir, tool, enabled)
  }
}

export function readRenpyTools(gameDir: string): Record<RenpyToolId, boolean> {
  return {
    console: pathExists(toolFilePath(gameDir, 'console')),
    quick: pathExists(toolFilePath(gameDir, 'quick')),
    skip: pathExists(toolFilePath(gameDir, 'skip')),
    rollback: pathExists(toolFilePath(gameDir, 'rollback'))
  }
}
