import { describe, expect, test } from 'bun:test'
import { isRpgMakerManagedSavePath } from './sources'

describe('isRpgMakerManagedSavePath', () => {
  const rpgRoot = 'C:/data/rpgmaker-saves'
  const backup = 'C:/data/rpgmaker-saves/111'
  const gameSave = 'D:/Games/Town/www/save'

  test('matches the backup folder and anything under the RPG Maker save root', () => {
    expect(isRpgMakerManagedSavePath(backup, backup, gameSave, rpgRoot)).toBe(true)
    expect(isRpgMakerManagedSavePath('C:/data/rpgmaker-saves/222', backup, gameSave, rpgRoot)).toBe(true)
  })

  test('matches the in-game www/save folder so it is not synced as a second copy', () => {
    expect(isRpgMakerManagedSavePath(gameSave, backup, gameSave, rpgRoot)).toBe(true)
    expect(isRpgMakerManagedSavePath('E:/Other/www/save', backup, gameSave, rpgRoot)).toBe(true)
  })

  test('leaves Ren\'Py save folders alone', () => {
    expect(isRpgMakerManagedSavePath('C:/renpy/saves/Game', backup, gameSave, rpgRoot)).toBe(false)
  })
})
