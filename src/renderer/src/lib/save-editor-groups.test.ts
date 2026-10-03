import { describe, expect, test } from 'bun:test'
import type { RenpySaveEditVar } from '@shared/types'
import {
  buildSaveEditorTree,
  parseSaveEditorPath,
  pathPartsFromSegments,
  rewriteIndexedPath,
  sortSaveEditorTree,
  splitPinnedSaveEditorTree,
  type SaveEditorNode
} from './save-editor-groups'

function row(partial: Partial<RenpySaveEditVar> & Pick<RenpySaveEditVar, 'name' | 'displayName'>): RenpySaveEditVar {
  return {
    type: 'Integer',
    value: 1,
    pos: 0,
    editable: true,
    kind: 'BININT1',
    ...partial
  }
}

function outline(nodes: SaveEditorNode[]): unknown[] {
  return nodes.map((node) => {
    if (!node.children.length) return [node.label, node.kind, node.leaf?.row.displayName]
    return [node.label, node.kind, outline(node.children)]
  })
}

describe('parseSaveEditorPath', () => {
  test('splits dotted fields, indexes, and quoted dict keys', () => {
    expect(parseSaveEditorPath('store.Hazel.Name')).toEqual([
      { type: 'id', value: 'Hazel' },
      { type: 'id', value: 'Name' }
    ])
    expect(parseSaveEditorPath('BoughtItems[0].price')).toEqual([
      { type: 'id', value: 'BoughtItems' },
      { type: 'index', value: 0 },
      { type: 'id', value: 'price' }
    ])
    expect(parseSaveEditorPath('GalleryTextsUnlocked["6M5PM"]')).toEqual([
      { type: 'id', value: 'GalleryTextsUnlocked' },
      { type: 'key', value: '6M5PM' }
    ])
  })
})

describe('buildSaveEditorTree', () => {
  test('keeps scalars ungrouped', () => {
    const tree = buildSaveEditorTree([{ row: row({ name: 'store.money', displayName: 'money' }), index: 0 }])
    expect(outline(tree)).toEqual([['money', 'scalar', 'money']])
  })

  test('nests objects, lists, and nested objects like JSON', () => {
    const tree = buildSaveEditorTree([
      {
        row: row({
          name: 'store.BoughtItems[0].price',
          displayName: 'BoughtItems[0].price',
          group: 'BoughtItems',
          groupKind: 'list',
          field: 'price',
          itemIndex: 0,
          itemStart: 10,
          itemEnd: 20,
          insertPos: 40,
          value: 30
        }),
        index: 0
      },
      {
        row: row({
          name: 'store.BoughtItems[0].name',
          displayName: 'BoughtItems[0].name',
          group: 'BoughtItems',
          groupKind: 'list',
          field: 'name',
          itemIndex: 0,
          itemStart: 10,
          itemEnd: 20,
          insertPos: 40,
          type: 'String',
          kind: 'SHORT_BINUNICODE',
          value: 'Police Outfit'
        }),
        index: 1
      },
      {
        row: row({
          name: 'store.BoughtItems[1].price',
          displayName: 'BoughtItems[1].price',
          group: 'BoughtItems',
          groupKind: 'list',
          field: 'price',
          itemIndex: 1,
          itemStart: 20,
          itemEnd: 30,
          insertPos: 40,
          value: 50
        }),
        index: 2
      },
      {
        row: row({
          name: 'store.Hazel.Name',
          displayName: 'Hazel.Name',
          group: 'Hazel',
          groupKind: 'object',
          field: 'Name',
          type: 'String',
          kind: 'SHORT_BINUNICODE',
          value: 'Hazel'
        }),
        index: 3
      },
      {
        row: row({
          name: 'store.Hazel.Stats.hp',
          displayName: 'Hazel.Stats.hp',
          group: 'Hazel.Stats',
          groupKind: 'object',
          field: 'hp',
          value: 10
        }),
        index: 4
      },
      {
        row: row({
          name: 'store.Hazel.Items[0]',
          displayName: 'Hazel.Items[0]',
          group: 'Hazel.Items',
          groupKind: 'list',
          itemIndex: 0,
          itemStart: 50,
          itemEnd: 55,
          insertPos: 60,
          value: 7
        }),
        index: 5
      }
    ])
    expect(outline(tree)).toEqual([
      [
        'BoughtItems',
        'list',
        [
          [
            '[0]',
            'object',
            [
              ['price', 'scalar', 'BoughtItems[0].price'],
              ['name', 'scalar', 'BoughtItems[0].name']
            ]
          ],
          ['[1]', 'object', [['price', 'scalar', 'BoughtItems[1].price']]]
        ]
      ],
      [
        'Hazel',
        'object',
        [
          ['Name', 'scalar', 'Hazel.Name'],
          ['Stats', 'object', [['hp', 'scalar', 'Hazel.Stats.hp']]],
          ['Items', 'list', [['[0]', 'scalar', 'Hazel.Items[0]']]]
        ]
      ]
    ])
    expect(tree[0].insertPos).toBe(40)
    expect(tree[0].children[0].itemStart).toBe(10)
    expect(tree[0].children[0].itemEnd).toBe(20)
    expect(tree[1].children[2].insertPos).toBe(60)
  })

  test('nests Love & Sex Second Base style layered objects, lists, and tuples', () => {
    const tree = buildSaveEditorTree([
      {
        row: row({
          name: 'store.person.name',
          displayName: 'person.name',
          group: 'person',
          groupKind: 'object',
          field: 'name',
          type: 'String',
          kind: 'SHORT_BINUNICODE',
          value: 'sasha'
        }),
        index: 0
      },
      {
        row: row({
          name: 'store.person.piercings.navel.outfits[0]',
          displayName: 'person.piercings.navel.outfits[0]',
          group: 'person.piercings.navel.outfits',
          groupKind: 'list',
          itemIndex: 0,
          type: 'String',
          kind: 'SHORT_BINUNICODE',
          value: 'naked'
        }),
        index: 1
      },
      {
        row: row({
          name: 'store.person.piercings.navel.outfits[1]',
          displayName: 'person.piercings.navel.outfits[1]',
          group: 'person.piercings.navel.outfits',
          groupKind: 'list',
          itemIndex: 1,
          type: 'String',
          kind: 'SHORT_BINUNICODE',
          value: 'swimsuit'
        }),
        index: 2
      },
      {
        row: row({
          name: 'store.n_spots[0][1].conditions[0]',
          displayName: 'n_spots[0][1].conditions[0]',
          group: 'n_spots[0][1].conditions',
          groupKind: 'list',
          itemIndex: 0,
          type: 'Object',
          kind: null,
          value: '<store ValidRooms>'
        }),
        index: 3
      },
      {
        row: row({
          name: 'store.DATA_GAME.date.day',
          displayName: 'DATA_GAME.date.day',
          group: 'DATA_GAME.date',
          groupKind: 'object',
          field: 'day',
          value: 12
        }),
        index: 4
      }
    ])
    expect(outline(tree)).toEqual([
      [
        'person',
        'object',
        [
          ['name', 'scalar', 'person.name'],
          [
            'piercings',
            'object',
            [
              [
                'navel',
                'object',
                [
                  [
                    'outfits',
                    'list',
                    [
                      ['[0]', 'scalar', 'person.piercings.navel.outfits[0]'],
                      ['[1]', 'scalar', 'person.piercings.navel.outfits[1]']
                    ]
                  ]
                ]
              ]
            ]
          ]
        ]
      ],
      [
        'n_spots',
        'list',
        [
          [
            '[0]',
            'list',
            [
              [
                '[1]',
                'object',
                [
                  [
                    'conditions',
                    'list',
                    [['[0]', 'scalar', 'n_spots[0][1].conditions[0]']]
                  ]
                ]
              ]
            ]
          ]
        ]
      ],
      ['DATA_GAME', 'object', [['date', 'object', [['day', 'scalar', 'DATA_GAME.date.day']]]]]
    ])
  })
})

describe('pathPartsFromSegments', () => {
  test('treats numeric RPG Maker array slots as list indexes', () => {
    expect(pathPartsFromSegments(['actors', '1', '_name'])).toEqual([
      { type: 'id', value: 'actors' },
      { type: 'index', value: 1 },
      { type: 'id', value: '_name' }
    ])
    expect(pathPartsFromSegments(['switches', '_data', '2'])).toEqual([
      { type: 'id', value: 'switches' },
      { type: 'id', value: '_data' },
      { type: 'index', value: 2 }
    ])
  })
})

describe('buildSaveEditorTree RPG Maker paths', () => {
  test('nests objects and array indexes from path segments', () => {
    const tree = buildSaveEditorTree(
      [
        {
          row: row({ name: 'party._gold', displayName: 'party._gold', value: 120 }),
          index: 0
        },
        {
          row: row({
            name: 'actors.1._name',
            displayName: 'actors.1._name',
            type: 'String',
            kind: 'SHORT_BINUNICODE',
            value: 'Hero'
          }),
          index: 1
        },
        {
          row: row({ name: 'actors.1._level', displayName: 'actors.1._level', value: 5 }),
          index: 2
        },
        {
          row: row({ name: 'actors.0', displayName: 'actors.0', type: 'Object', kind: null, value: null }),
          index: 3
        }
      ],
      {
        partsFor: (item) => pathPartsFromSegments(item.displayName.split('.'))
      }
    )
    expect(outline(tree)).toEqual([
      ['party', 'object', [['_gold', 'scalar', 'party._gold']]],
      [
        'actors',
        'list',
        [
          [
            '[1]',
            'object',
            [
              ['_name', 'scalar', 'actors.1._name'],
              ['_level', 'scalar', 'actors.1._level']
            ]
          ],
          ['[0]', 'scalar', 'actors.0']
        ]
      ]
    ])
  })
})

describe('sortSaveEditorTree', () => {
  test('sorts named nodes alphabetically and keeps list indexes numeric', () => {
    const tree = sortSaveEditorTree(
      buildSaveEditorTree([
        { row: row({ name: 'store.zebra', displayName: 'zebra' }), index: 0 },
        { row: row({ name: 'store.Apple.hp', displayName: 'Apple.hp', group: 'Apple', groupKind: 'object' }), index: 1 },
        {
          row: row({
            name: 'store.Apple.Name',
            displayName: 'Apple.Name',
            group: 'Apple',
            groupKind: 'object',
            field: 'Name',
            type: 'String',
            kind: 'SHORT_BINUNICODE',
            value: 'Ann'
          }),
          index: 2
        },
        {
          row: row({
            name: 'store.items[10]',
            displayName: 'items[10]',
            group: 'items',
            groupKind: 'list',
            itemIndex: 10
          }),
          index: 3
        },
        {
          row: row({
            name: 'store.items[2]',
            displayName: 'items[2]',
            group: 'items',
            groupKind: 'list',
            itemIndex: 2
          }),
          index: 4
        }
      ])
    )
    expect(outline(tree)).toEqual([
      [
        'Apple',
        'object',
        [
          ['hp', 'scalar', 'Apple.hp'],
          ['Name', 'scalar', 'Apple.Name']
        ]
      ],
      [
        'items',
        'list',
        [
          ['[2]', 'scalar', 'items[2]'],
          ['[10]', 'scalar', 'items[10]']
        ]
      ],
      ['zebra', 'scalar', 'zebra']
    ])
  })
})

describe('splitPinnedSaveEditorTree', () => {
  test('pulls pinned nodes to the top and reports missing paths', () => {
    const tree = buildSaveEditorTree([
      { row: row({ name: 'store.money', displayName: 'money' }), index: 0 },
      {
        row: row({
          name: 'store.Hazel.Name',
          displayName: 'Hazel.Name',
          group: 'Hazel',
          groupKind: 'object',
          field: 'Name'
        }),
        index: 1
      },
      {
        row: row({
          name: 'store.Hazel.hp',
          displayName: 'Hazel.hp',
          group: 'Hazel',
          groupKind: 'object',
          field: 'hp'
        }),
        index: 2
      }
    ])
    const { pinned, rest } = splitPinnedSaveEditorTree(tree, ['Hazel.Name', 'missing.var', 'money'])
    expect(pinned.map((entry) => [entry.path, entry.node?.path ?? null])).toEqual([
      ['Hazel.Name', 'Hazel.Name'],
      ['missing.var', null],
      ['money', 'money']
    ])
    expect(outline(rest)).toEqual([['Hazel', 'object', [['hp', 'scalar', 'Hazel.hp']]]])
  })

  test('does not mark a nested pin missing when its parent is already pinned', () => {
    const tree = buildSaveEditorTree([
      {
        row: row({
          name: 'store.Hazel.Name',
          displayName: 'Hazel.Name',
          group: 'Hazel',
          groupKind: 'object'
        }),
        index: 0
      }
    ])
    const { pinned, rest } = splitPinnedSaveEditorTree(tree, ['Hazel', 'Hazel.Name'])
    expect(pinned).toHaveLength(1)
    expect(pinned[0]?.path).toBe('Hazel')
    expect(rest).toEqual([])
  })
})

describe('rewriteIndexedPath', () => {
  test('rewrites only the matching list index', () => {
    expect(rewriteIndexedPath('BoughtItems[2].tags[1]', 'BoughtItems', 2, 1)).toBe('BoughtItems[1].tags[1]')
    expect(rewriteIndexedPath('store.BoughtItems[2].name', 'BoughtItems', 2, 1)).toBe('store.BoughtItems[1].name')
    expect(rewriteIndexedPath('player.items[2]', 'player.items', 2, 1)).toBe('player.items[1]')
    expect(rewriteIndexedPath('BoughtItemsBackup[2]', 'BoughtItems', 2, 1)).toBe('BoughtItemsBackup[2]')
  })
})
