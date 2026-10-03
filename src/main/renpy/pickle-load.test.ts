import { describe, expect, test } from 'bun:test'
import { flattenStoreMap, type PyVal } from './pickle-load'

function prim(op: string, pos: number, value: boolean | number | string | null): PyVal {
  return { kind: 'prim', pos, spanStart: pos, op, prim: value }
}

describe('flattenStoreMap', () => {
  test('keeps nested objects and lists on their own paths', () => {
    const store = new Map<string, PyVal>([
      [
        'store.player',
        {
          kind: 'obj',
          pos: 1,
          state: {
            kind: 'dict',
            pos: 2,
            entries: [
              [prim('SHORT_BINUNICODE', 3, 'name'), prim('SHORT_BINUNICODE', 4, 'Ann')],
              [
                prim('SHORT_BINUNICODE', 5, 'stats'),
                {
                  kind: 'dict',
                  pos: 6,
                  entries: [[prim('SHORT_BINUNICODE', 7, 'hp'), prim('BININT1', 8, 10)]]
                }
              ],
              [
                prim('SHORT_BINUNICODE', 9, 'items'),
                {
                  kind: 'list',
                  pos: 10,
                  items: [prim('BININT1', 11, 1), prim('BININT1', 12, 2)],
                  itemSpans: [
                    { start: 11, end: 12 },
                    { start: 12, end: 13 }
                  ],
                  insertPos: 20
                }
              ]
            ]
          }
        }
      ]
    ])
    const rows = flattenStoreMap(store)
    expect(rows.map((row) => row.name)).toEqual([
      'store.player.name',
      'store.player.stats.hp',
      'store.player.items[0]',
      'store.player.items[1]'
    ])
    expect(rows[0]).toMatchObject({ group: 'player', groupKind: 'object', field: 'name' })
    expect(rows[1]).toMatchObject({ group: 'player.stats', groupKind: 'dict', field: 'hp' })
    expect(rows[2]).toMatchObject({ group: 'player.items', groupKind: 'list', itemIndex: 0, insertPos: 20 })
    expect(rows[3]).toMatchObject({ group: 'player.items', groupKind: 'list', itemIndex: 1, insertPos: 20 })
  })
})
