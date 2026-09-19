import { describe, expect, test } from 'bun:test'
import { isPageSearchHotkey, pickSearchCandidate } from './page-search'

function key(
  partial: Partial<KeyboardEvent> & Pick<KeyboardEvent, 'key'>
): KeyboardEvent {
  return {
    defaultPrevented: false,
    isComposing: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...partial
  } as KeyboardEvent
}

describe('isPageSearchHotkey', () => {
  test('matches Ctrl+F and Cmd+F', () => {
    expect(isPageSearchHotkey(key({ key: 'f', ctrlKey: true }))).toBe(true)
    expect(isPageSearchHotkey(key({ key: 'F', metaKey: true }))).toBe(true)
  })

  test('ignores other modifiers and keys', () => {
    expect(isPageSearchHotkey(key({ key: 'f' }))).toBe(false)
    expect(isPageSearchHotkey(key({ key: 'f', ctrlKey: true, shiftKey: true }))).toBe(false)
    expect(isPageSearchHotkey(key({ key: 'f', ctrlKey: true, altKey: true }))).toBe(false)
    expect(isPageSearchHotkey(key({ key: 'g', ctrlKey: true }))).toBe(false)
  })
})

describe('pickSearchCandidate', () => {
  test('prefers a dialog search when a dialog is open', () => {
    const picked = pickSearchCandidate([
      { inDialog: false, pageSearch: true, id: 'page' },
      { inDialog: true, pageSearch: false, id: 'dialog' }
    ])
    expect(picked?.id).toBe('dialog')
  })

  test('prefers the page search over nested searches', () => {
    const picked = pickSearchCandidate([
      { inDialog: false, pageSearch: false, id: 'tags' },
      { inDialog: false, pageSearch: true, id: 'page' }
    ])
    expect(picked?.id).toBe('page')
  })

  test('falls back to the first visible search', () => {
    const picked = pickSearchCandidate([{ inDialog: false, pageSearch: false, id: 'only' }])
    expect(picked?.id).toBe('only')
  })
})
