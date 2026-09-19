import { join, sep } from 'path'
import { describe, expect, test } from 'bun:test'
import { isPathInside, isSamePath, normalizeExtraDirs, uniqueScanRoots } from './extra-library-dirs'

const games = join(process.platform === 'win32' ? 'C:\\' : '/', 'Games')
const downloads = join(process.platform === 'win32' ? 'C:\\' : '/', 'Downloads')

describe('normalizeExtraDirs', () => {
  test('keeps unique absolute folders and drops the default destination', () => {
    expect(
      normalizeExtraDirs([games, games + sep, 'relative', games, downloads], [downloads])
    ).toEqual([games])
  })

  test('skips nested folders of an already listed root', () => {
    expect(normalizeExtraDirs([games, join(games, 'more')])).toEqual([games])
  })
})

describe('uniqueScanRoots', () => {
  test('drops duplicates and nested folders of a parent root', () => {
    expect(uniqueScanRoots([games, games + sep, join(games, 'more'), downloads, ''])).toEqual([
      games,
      downloads
    ])
  })
})

describe('path compare', () => {
  test('treats trailing separators as the same folder', () => {
    expect(isSamePath(games, games + sep)).toBe(true)
    expect(isPathInside(join(games, 'Title', '1.0'), games)).toBe(true)
    expect(isPathInside(join(process.platform === 'win32' ? 'C:\\' : '/', 'Other'), games)).toBe(
      false
    )
  })
})
