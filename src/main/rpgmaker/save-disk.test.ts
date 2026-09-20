import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import { pathExists } from '../win-path'
import { rpgMakerSaveFileBytes, wipeRpgMakerSaveDirs } from './save-disk'

describe('wipeRpgMakerSaveDirs', () => {
  test('deletes the backup folder and empties the in-game save folder', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rpgmaker-wipe-'))
    const gameSave = join(root, 'www', 'save')
    const backup = join(root, 'rpgmaker-saves', '42')
    try {
      await mkdir(gameSave, { recursive: true })
      await mkdir(backup, { recursive: true })
      await writeFile(join(gameSave, 'file1.rpgsave'), 'slot')
      await writeFile(join(backup, 'file1.rpgsave'), 'slot')
      await writeFile(join(backup, 'game.txt'), 'Title\n')

      await wipeRpgMakerSaveDirs(gameSave, backup)

      expect(pathExists(backup)).toBe(false)
      expect(pathExists(gameSave)).toBe(true)
      expect(pathExists(join(gameSave, 'file1.rpgsave'))).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('removes a backup that only has game.txt leftover', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rpgmaker-wipe-label-'))
    const backup = join(root, '99')
    try {
      await mkdir(backup, { recursive: true })
      await writeFile(join(backup, 'game.txt'), 'Title\n')
      await wipeRpgMakerSaveDirs(null, backup)
      expect(pathExists(backup)).toBe(false)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

describe('rpgMakerSaveFileBytes', () => {
  test('ignores game.txt so leftover labels are not counted as saves', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rpgmaker-bytes-'))
    try {
      await writeFile(join(root, 'game.txt'), 'Title\n')
      await writeFile(join(root, 'file1.rpgsave'), '12345')
      expect(await rpgMakerSaveFileBytes(root)).toBe(5)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
