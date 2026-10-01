import { describe, expect, test } from 'bun:test'
import { coalesceInflight, f95InflightGetKey } from './inflight'

describe('f95InflightGetKey', () => {
  test('coalesces GET/HEAD and ignores cache-buster timestamps', () => {
    expect(
      f95InflightGetKey(
        'GET',
        'https://f95zone.to/account/ignored?key=thread'
      )
    ).toBe('GET https://f95zone.to/account/ignored?key=thread')
    expect(
      f95InflightGetKey(
        'get',
        'https://f95zone.to/sam/latest_alpha/latest_data.php?cmd=list&page=1&_=1790882193009'
      )
    ).toBe(
      f95InflightGetKey(
        'GET',
        'https://f95zone.to/sam/latest_alpha/latest_data.php?cmd=list&page=1&_=1790882193011'
      )
    )
    expect(f95InflightGetKey('HEAD', 'https://f95zone.to/threads/1/')).toBe(
      'HEAD https://f95zone.to/threads/1/'
    )
  })

  test('does not coalesce mutating methods', () => {
    expect(f95InflightGetKey('POST', 'https://f95zone.to/sam/latest_alpha/latest_data.php?cmd=options')).toBe(
      null
    )
    expect(f95InflightGetKey('PUT', 'https://f95zone.to/threads/1/')).toBe(null)
  })
})

describe('coalesceInflight', () => {
  test('overlapping callers share one start()', async () => {
    const map = new Map<string, Promise<number>>()
    let starts = 0
    let release!: (value: number) => void
    const gate = new Promise<number>((resolve) => {
      release = resolve
    })

    const first = coalesceInflight(map, 'ignored', async () => {
      starts += 1
      return gate
    })
    const second = coalesceInflight(map, 'ignored', async () => {
      starts += 1
      return 99
    })

    expect(starts).toBe(1)
    release(7)
    expect(await Promise.all([first, second])).toEqual([7, 7])
    expect(map.size).toBe(0)

    const third = coalesceInflight(map, 'ignored', async () => {
      starts += 1
      return 3
    })
    expect(await third).toBe(3)
    expect(starts).toBe(2)
  })
})
