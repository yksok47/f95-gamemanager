import { describe, expect, test } from 'bun:test'
import type { CloudSaveRemoteFile } from '@shared/types'
import { cloudFolderKey, filesForSaveFolder, isPersistentSaveName } from './cloud-saves'

function file(name: string, folderKey: string): CloudSaveRemoteFile {
  return {
    name,
    size: 1,
    modifiedAt: 1,
    folderKey,
    hash: '',
    presentLocally: false
  }
}

describe('isPersistentSaveName', () => {
  test('matches RenPy persistent files', () => {
    expect(isPersistentSaveName('persistent')).toBe(true)
    expect(isPersistentSaveName('Persistent.new')).toBe(true)
    expect(isPersistentSaveName('1-1.save')).toBe(false)
  })
})

describe('cloudFolderKey', () => {
  test('matches the Drive folder key for a save directory name', () => {
    expect(cloudFolderKey('Game')).toBe('Game')
    expect(cloudFolderKey('Game/old')).toBe('Game_old')
  })
})

describe('filesForSaveFolder', () => {
  test('keeps only cloud files from the active save directory', () => {
    const files = [
      file('1-1.save', 'Game'),
      file('1-1.save', 'Game-old'),
      file('1-2.save', 'Game-old')
    ]
    expect(filesForSaveFolder(files, 'Game').map((item) => item.name)).toEqual(['1-1.save'])
    expect(filesForSaveFolder(files, 'Game-old').map((item) => item.name)).toEqual([
      '1-1.save',
      '1-2.save'
    ])
  })

  test('does not apply a legacy thread folder to every save location', () => {
    const files = [file('1-1.save', '99'), file('2-1.save', 'Game-old')]
    expect(filesForSaveFolder(files, 'Game', 99)).toEqual([])
    expect(filesForSaveFolder(files, 'Game-old', 99).map((item) => item.name)).toEqual(['2-1.save'])
  })

  test('uses legacy thread files only when that is the only cloud folder', () => {
    const files = [file('1-1.save', '99')]
    expect(filesForSaveFolder(files, 'Game', 99).map((item) => item.name)).toEqual(['1-1.save'])
  })
})
