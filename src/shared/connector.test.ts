import { describe, expect, test } from 'bun:test'
import { pickPreferredFile, redirectUrlFromHeaders } from './connector'

describe('pickPreferredFile', () => {
  test('prefers an archive over a larger text file', () => {
    const picked = pickPreferredFile([
      { name: 'readme.txt', size: 9_000 },
      { name: 'Game.zip', size: 100 }
    ])
    expect(picked?.name).toBe('Game.zip')
  })
})

describe('redirectUrlFromHeaders', () => {
  test('resolves Location and HX-Redirect', () => {
    expect(
      redirectUrlFromHeaders(new Headers({ location: '/file.bin' }), 'https://cdn.example')
    ).toBe('https://cdn.example/file.bin')
    expect(
      redirectUrlFromHeaders(
        new Headers({ 'hx-redirect': 'https://cdn.example/Game.zip' }),
        'https://buzzheavier.com/abc'
      )
    ).toBe('https://cdn.example/Game.zip')
  })
})
