import { describe, expect, test } from 'bun:test'
import {
  nextHead,
  parseHead,
  parseSnapshotFileName,
  recoveryFileOrder,
  snapshotFileName,
  staleSnapshotNames,
  snapshotsToKeep,
  USER_DATA_HEAD_NAME
} from './head'

describe('snapshot file names', () => {
  test('round-trip revision and time', () => {
    const name = snapshotFileName(4, 1700000000000, 'ab12cd')
    expect(name).toBe('snapshot-4-1700000000000-ab12cd.json')
    expect(parseSnapshotFileName(name)).toEqual({ revision: 4, updatedAt: 1700000000000 })
  })
})

describe('head rotation', () => {
  test('keeps the live snapshot and previous revisions; never deletes HEAD', () => {
    const first = nextHead(null, {
      revision: 1,
      checksum: 'aaa',
      fileName: 'snapshot-1-10-a.json',
      updatedAt: 10
    })
    const second = nextHead(first, {
      revision: 2,
      checksum: 'bbb',
      fileName: 'snapshot-2-20-b.json',
      updatedAt: 20
    })
    const third = nextHead(second, {
      revision: 3,
      checksum: 'ccc',
      fileName: 'snapshot-3-30-c.json',
      updatedAt: 30
    })
    expect(third.fileName).toBe('snapshot-3-30-c.json')
    expect(third.previous.map((item) => item.fileName)).toEqual([
      'snapshot-2-20-b.json',
      'snapshot-1-10-a.json'
    ])
    const keep = snapshotsToKeep(third)
    expect(keep.has(USER_DATA_HEAD_NAME)).toBe(true)
    expect(keep.has('snapshot-3-30-c.json')).toBe(true)
    const stale = staleSnapshotNames(
      [
        USER_DATA_HEAD_NAME,
        'snapshot-1-10-a.json',
        'snapshot-2-20-b.json',
        'snapshot-3-30-c.json',
        'snapshot-0-1-old.json'
      ],
      keep
    )
    expect(stale).toEqual(['snapshot-0-1-old.json'])
  })

  test('a failed HEAD update leaves recovery pointing at the previous good snapshot', () => {
    const head = parseHead({
      version: 1,
      revision: 4,
      checksum: 'good',
      fileName: 'snapshot-4-40-d.json',
      updatedAt: 40,
      previous: [
        { revision: 3, checksum: 'prev', fileName: 'snapshot-3-30-c.json', updatedAt: 30 }
      ]
    })
    expect(head?.fileName).toBe('snapshot-4-40-d.json')
    const order = recoveryFileOrder(head, [
      'snapshot-5-50-orphan.json',
      'snapshot-4-40-d.json',
      'snapshot-3-30-c.json'
    ])
    expect(order[0]).toBe('snapshot-4-40-d.json')
    expect(order[1]).toBe('snapshot-3-30-c.json')
  })

  test('if HEAD is missing, newest leftover snapshot is tried first', () => {
    const order = recoveryFileOrder(null, [
      'snapshot-2-20-b.json',
      'head.json',
      'snapshot-8-80-z.json'
    ])
    expect(order[0]).toBe('snapshot-8-80-z.json')
    expect(order[1]).toBe('snapshot-2-20-b.json')
  })
})
