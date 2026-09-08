import { cpSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { pathExists, stripNamespace } from '../win-path'
import type { GamePython } from './runtime'

export const UNRPYC_STAGE_NAME = '.f95-unren'

export type UnrenVendor = {
  root: string
  rpatool: string
  fallback: string
  unrpycDir: string
  unrpyc: string
  unrpycOld: string | null
  unrpycOldDir: string | null
}

function candidateRoots(): string[] {
  return [
    join(process.resourcesPath, 'unren'),
    join(app.getAppPath(), 'resources', 'unren'),
    join(__dirname, '../../resources/unren'),
    join(process.cwd(), 'resources', 'unren')
  ]
}

export function getUnrenVendor(runtime: GamePython): UnrenVendor {
  const root = candidateRoots().find((dir) => pathExists(join(dir, 'rpatool-py3.py')))
  if (!root) throw new Error('Bundled script tools are missing from the app files.')
  const unrpycDir = join(root, runtime.major === 3 ? 'unrpyc-py3' : 'unrpyc-py2')
  const unrpyc = join(unrpycDir, 'unrpyc.py')
  const rpatool = join(root, runtime.major === 3 ? 'rpatool-py3.py' : 'rpatool-py2.py')
  const fallback = join(root, 'rpa-fallback.py')
  const unrpycOldDir = join(root, 'unrpyc-old')
  const unrpycOld = join(unrpycOldDir, 'unrpyc.py')
  if (!pathExists(rpatool) || !pathExists(fallback)) {
    throw new Error('Bundled rpatool files are missing.')
  }
  if (!pathExists(unrpyc) || !pathExists(join(unrpycDir, 'decompiler', '__init__.py'))) {
    throw new Error(`Bundled unrpyc for Python ${runtime.major} is missing the decompiler package.`)
  }
  return {
    root,
    rpatool,
    fallback,
    unrpycDir,
    unrpyc,
    unrpycOld: pathExists(unrpycOld) ? unrpycOld : null,
    unrpycOldDir: pathExists(unrpycOld) ? unrpycOldDir : null
  }
}

export function stageUnrpycTree(gameRoot: string, fromDir: string, folderName = UNRPYC_STAGE_NAME): string {
  const stage = join(stripNamespace(gameRoot), folderName)
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(stage, { recursive: true })
  cpSync(fromDir, stage, { recursive: true })
  if (!pathExists(join(stage, 'unrpyc.py')) || !pathExists(join(stage, 'decompiler', '__init__.py'))) {
    throw new Error('Staged unrpyc is missing the decompiler package.')
  }
  return stage
}

export function removeUnrpycStage(gameRoot: string, folderName = UNRPYC_STAGE_NAME): void {
  rmSync(join(stripNamespace(gameRoot), folderName), { recursive: true, force: true })
}
