import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { safeRendererFile } from './renderer-server'

const root = join('C:', 'app', 'out', 'renderer')

describe('safeRendererFile', () => {
  test('serves index and assets under the renderer root', () => {
    expect(safeRendererFile(root, '/')).toBe(join(root, 'index.html'))
    expect(safeRendererFile(root, '/assets/index.js')).toBe(join(root, 'assets', 'index.js'))
  })

  test('rejects path traversal', () => {
    expect(safeRendererFile(root, '/../main/index.js')).toBeNull()
    expect(safeRendererFile(root, '/assets/../../secret')).toBeNull()
  })
})
