import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import { pathIsInside } from './processes'

describe('pathIsInside', () => {
  test('treats a nested file as inside the install folder', () => {
    const root = join('library', 'Game', '1.0')
    expect(pathIsInside(root, join(root, 'Game.sh'))).toBe(true)
    expect(pathIsInside(root, join(root, 'lib', 'python'))).toBe(true)
  })

  test('rejects a sibling folder', () => {
    const root = join('library', 'Game', '1.0')
    expect(pathIsInside(root, join('library', 'Game', '2.0', 'Game.sh'))).toBe(false)
    expect(pathIsInside(root, join('library', 'Other', 'Game.sh'))).toBe(false)
  })

  test('treats the folder itself as inside', () => {
    const root = join('library', 'Game', '1.0')
    expect(pathIsInside(root, root)).toBe(true)
  })
})
