import { describe, expect, test } from 'bun:test'
import { isPageSearchHotkey, pickActiveDialog, pickSearchCandidate, pickTopmost } from './page-search'

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

describe('pickTopmost', () => {
  test('uses the last dialog so nested overlays win', () => {
    expect(pickTopmost(['page', 'details', 'editor'])).toBe('editor')
    expect(pickTopmost([])).toBeUndefined()
  })
})

describe('pickActiveDialog', () => {
  function dialog(inactiveWindow: boolean): HTMLElement {
    return {
      closest(selector: string) {
        if (selector === '.details-window:not(.is-active)') {
          return inactiveWindow ? ({} as HTMLElement) : null
        }
        return null
      }
    } as HTMLElement
  }

  test('ignores dialogs inside inactive details windows', () => {
    const inactive = dialog(true)
    const active = dialog(false)
    expect(pickActiveDialog([inactive, active])).toBe(active)
  })

  test('prefers a global overlay after the active window', () => {
    const active = dialog(false)
    const confirm = dialog(false)
    expect(pickActiveDialog([active, confirm])).toBe(confirm)
  })
})
