import { describe, expect, test } from 'bun:test'
import {
  addTaskbarPin,
  parseTaskbarPins,
  pinFromSummary,
  pinsFromWindows,
  removeTaskbarPin,
  summaryFromPin,
  updateTaskbarPin,
  type TaskbarPin
} from './taskbar-pins'

function pin(partial: Partial<TaskbarPin> & Pick<TaskbarPin, 'threadId'>): TaskbarPin {
  return {
    title: `Game ${partial.threadId}`,
    coverUrl: null,
    creator: '',
    version: '',
    threadUrl: `https://f95zone.to/threads/${partial.threadId}/`,
    ...partial
  }
}

describe('parseTaskbarPins', () => {
  test('keeps valid pins in order and drops junk', () => {
    expect(
      parseTaskbarPins([
        { threadId: 7, title: '  Alpha  ', coverUrl: 'https://cdn.test/a.jpg', creator: 'Ann' },
        { threadId: 7, title: 'Duplicate' },
        { threadId: 0, title: 'Bad' },
        null,
        { title: 'No id' },
        { threadId: 3, title: 'Beta', version: '1.2' }
      ])
    ).toEqual([
      {
        threadId: 7,
        title: 'Alpha',
        coverUrl: 'https://cdn.test/a.jpg',
        creator: 'Ann',
        version: '',
        threadUrl: 'https://f95zone.to/threads/7/'
      },
      {
        threadId: 3,
        title: 'Beta',
        coverUrl: null,
        creator: '',
        version: '1.2',
        threadUrl: 'https://f95zone.to/threads/3/'
      }
    ])
  })

  test('returns an empty list for non-arrays', () => {
    expect(parseTaskbarPins(null)).toEqual([])
    expect(parseTaskbarPins({})).toEqual([])
  })
})

describe('taskbar pin list edits', () => {
  test('adds, updates, and removes without duplicating', () => {
    const first = pin({ threadId: 4, title: 'One' })
    const added = addTaskbarPin([], first)
    expect(addTaskbarPin(added, pin({ threadId: 4, title: 'Again' }))).toBe(added)

    const updated = updateTaskbarPin(added, pin({ threadId: 4, title: 'One', coverUrl: 'https://cdn.test/c.jpg' }))
    expect(updated[0]?.coverUrl).toBe('https://cdn.test/c.jpg')
    expect(updateTaskbarPin(updated, updated[0])).toBe(updated)

    const removed = removeTaskbarPin(updated, 4)
    expect(removed).toEqual([])
    expect(removeTaskbarPin(removed, 4)).toBe(removed)
  })
})

describe('pinsFromWindows', () => {
  test('follows the current taskbar order and keeps missing pins', () => {
    const previous = [
      pin({ threadId: 1, title: 'One' }),
      pin({ threadId: 2, title: 'Two' }),
      pin({ threadId: 3, title: 'Three' })
    ]
    const next = pinsFromWindows(
      [
        { threadId: 2, title: 'Two', coverUrl: null, creator: '', version: '', threadUrl: 'https://f95zone.to/threads/2/' },
        { threadId: 1, title: 'One', coverUrl: null, creator: '', version: '', threadUrl: 'https://f95zone.to/threads/1/' }
      ],
      new Set([1, 3, 2]),
      previous
    )
    expect(next.map((item) => item.threadId)).toEqual([2, 1, 3])
  })
})

describe('pin summary conversion', () => {
  test('round-trips the fields needed to reopen a game', () => {
    const fromSummary = pinFromSummary({
      threadId: 9,
      title: 'Nine',
      coverUrl: 'https://cdn.test/n.jpg',
      creator: 'Cee',
      version: '2.0',
      threadUrl: 'https://f95zone.to/threads/9/'
    })
    expect(fromSummary).toEqual(pin({
      threadId: 9,
      title: 'Nine',
      coverUrl: 'https://cdn.test/n.jpg',
      creator: 'Cee',
      version: '2.0'
    }))
    expect(summaryFromPin(fromSummary!)).toMatchObject({
      threadId: 9,
      title: 'Nine',
      coverUrl: 'https://cdn.test/n.jpg',
      creator: 'Cee',
      version: '2.0',
      threadUrl: 'https://f95zone.to/threads/9/'
    })
  })
})
