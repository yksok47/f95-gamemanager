import { describe, expect, test } from 'bun:test'
import { classifySaveName, cloudBlobName, cloudSaveNameAllowed, isCloudBlobName, selectCloudSaves, type CloudSaveCandidate } from './select'

function file(
  name: string,
  modifiedAt: number,
  kind: CloudSaveCandidate['kind'] = classifySaveName(name) || 'slot'
): CloudSaveCandidate {
  return { name, localPath: name, size: 10, modifiedAt, kind }
}

describe('classifySaveName', () => {
  test('maps RenPy and RPG Maker names', () => {
    expect(classifySaveName('1-2.save')).toBe('slot')
    expect(classifySaveName('auto-1.save')).toBe('auto')
    expect(classifySaveName('quick-2.save')).toBe('quick')
    expect(classifySaveName('persistent')).toBe('always')
    expect(classifySaveName('file3.rpgsave')).toBe('slot')
    expect(classifySaveName('auto.rpgsave')).toBe('auto')
    expect(classifySaveName('config.rpgsave')).toBe('always')
    expect(classifySaveName('screenshot.png')).toBe(null)
    expect(classifySaveName('game.txt')).toBe(null)
    expect(classifySaveName('manifest.json')).toBe(null)
    expect(classifySaveName('f95gm-manifest.json')).toBe(null)
  })
})

describe('cloud blob names', () => {
  test('builds opaque Drive names from content hashes', () => {
    expect(cloudBlobName('abc123')).toBe('f95gm-abc123')
    expect(isCloudBlobName('f95gm-abc123def4567890')).toBe(true)
    expect(isCloudBlobName('1-1.save')).toBe(false)
    expect(cloudSaveNameAllowed('f95gm-abc123def4567890')).toBe(true)
  })
})

describe('selectCloudSaves', () => {
  const files = [
    file('persistent', 1),
    file('1-1.save', 100),
    file('1-2.save', 200),
    file('1-3.save', 50),
    file('auto-1.save', 300),
    file('quick-1.save', 400)
  ]

  test('keeps the newest N slot saves and always-synced files', () => {
    const picked = selectCloudSaves(files, 2, false).map((item) => item.name)
    expect(picked).toEqual(['persistent', '1-2.save', '1-1.save'])
  })

  test('includes auto and quick regardless of the slot limit', () => {
    const picked = selectCloudSaves(files, 1, true).map((item) => item.name)
    expect(picked).toEqual(['persistent', 'auto-1.save', 'quick-1.save', '1-2.save'])
  })

  test('unlimited keeps every slot save', () => {
    const picked = selectCloudSaves(files, 0, false).map((item) => item.name)
    expect(picked).toEqual(['persistent', '1-2.save', '1-1.save', '1-3.save'])
  })
})
