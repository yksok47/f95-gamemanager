import { describe, expect, test } from 'bun:test'
import { gamesFromCloudTree, type CloudTreeItem } from './tree'

const FOLDER = 'application/vnd.google-apps.folder'

function item(
  id: string,
  name: string,
  parent: string,
  extra: Partial<CloudTreeItem> = {}
): CloudTreeItem {
  return {
    id,
    name,
    mimeType: extra.mimeType || 'application/octet-stream',
    modifiedTime: extra.modifiedTime ?? 0,
    size: extra.size ?? 0,
    parentIds: [parent],
    appProperties: extra.appProperties
  }
}

describe('gamesFromCloudTree', () => {
  const items: CloudTreeItem[] = [
    item('g1', '111', 'root', {
      mimeType: FOLDER,
      appProperties: { title: 'Cool Game' },
      modifiedTime: 10
    }),
    item('saves', 'saves', 'g1', { mimeType: FOLDER }),
    item('f1', '1-1.save', 'saves', { size: 100, modifiedTime: 5 }),
    item('f2', 'persistent', 'saves', { size: 50, modifiedTime: 9 }),
    item('blob', 'f95gm-abcdef0123456789', 'saves', { size: 30, modifiedTime: 7 }),
    item('shot', 'screenshot.png', 'saves', { size: 999, modifiedTime: 20 }),
    item('meta', 'game.json', 'g1', { size: 12, modifiedTime: 8 }),
    item('man', 'manifest.json', 'g1', { size: 40, modifiedTime: 8 }),
    item('g2', '222', 'root', { mimeType: FOLDER, modifiedTime: 3 }),
    item('rpg', 'rpgmaker', 'g2', { mimeType: FOLDER }),
    item('r1', 'file1.rpgsave', 'rpg', { size: 20, modifiedTime: 4 })
  ]

  test('counts save files per game and ignores metadata and screenshots', () => {
    const games = gamesFromCloudTree('root', items)
    expect(games).toHaveLength(2)
    expect(games[0]).toMatchObject({
      threadId: 111,
      title: 'Cool Game',
      saveCount: 2,
      bytes: 130,
      updatedAt: 9
    })
    expect(games[0].files.map((file) => file.name).sort()).toEqual([
      '1-1.save',
      'f95gm-abcdef0123456789',
      'persistent'
    ])
    expect(games[1]).toMatchObject({
      threadId: 222,
      title: 'Thread 222',
      saveCount: 1,
      bytes: 20
    })
  })

  test('prefers local titles when Drive has none', () => {
    const titles = new Map<number, string>([[222, 'RPG Town']])
    const games = gamesFromCloudTree('root', items, titles)
    expect(games.find((game) => game.threadId === 222)?.title).toBe('RPG Town')
    expect(games.find((game) => game.threadId === 111)?.title).toBe('Cool Game')
  })

  test('skips non-numeric folders under the root', () => {
    const games = gamesFromCloudTree('root', [
      ...items,
      item('junk', 'not-a-game', 'root', { mimeType: FOLDER })
    ])
    expect(games.map((game) => game.threadId)).toEqual([111, 222])
  })
})
