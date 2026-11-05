import { afterEach, describe, expect, test } from 'bun:test'

type Callback = (entries: Array<{ target: object; isIntersecting: boolean }>) => void

class FakeObserver {
  static all: FakeObserver[] = []
  readonly root: object | null
  readonly watched = new Set<object>()
  disconnected = false

  constructor(
    readonly callback: Callback,
    options: { root?: object | null }
  ) {
    this.root = options.root ?? null
    FakeObserver.all.push(this)
  }

  observe(el: object): void {
    this.watched.add(el)
  }

  unobserve(el: object): void {
    this.watched.delete(el)
  }

  disconnect(): void {
    this.disconnected = true
    this.watched.clear()
  }

  fire(el: object, isIntersecting = true): void {
    if (this.watched.has(el)) this.callback([{ target: el, isIntersecting }])
  }
}

class FakeElement {}

let scrollRoot: object | null = null
const globals = globalThis as Record<string, unknown>
globals.Element = FakeElement
globals.IntersectionObserver = FakeObserver
globals.document = { querySelector: () => scrollRoot }

const { observeNear } = await import('./viewport')

afterEach(() => {
  FakeObserver.all = []
})

describe('observeNear', () => {
  test('keeps working after the app shell remounts', () => {
    const firstMain = new FakeElement()
    scrollRoot = firstMain
    const oldCard = new FakeElement()
    const stopOld = observeNear(oldCard, () => undefined)
    expect(FakeObserver.all.at(-1)?.root).toBe(firstMain)
    stopOld()

    const secondMain = new FakeElement()
    scrollRoot = secondMain
    const card = new FakeElement()
    const seen: boolean[] = []
    observeNear(card, (near) => seen.push(near))

    const current = FakeObserver.all.at(-1)
    expect(current?.root).toBe(secondMain)
    expect(FakeObserver.all[0].disconnected).toBe(true)
    current?.fire(card)
    expect(seen).toEqual([true])
  })

  test('moves cards that were waiting onto the new scroll root', () => {
    scrollRoot = null
    const early = new FakeElement()
    const seen: boolean[] = []
    observeNear(early, (near) => seen.push(near))

    scrollRoot = new FakeElement()
    observeNear(new FakeElement(), () => undefined)

    const current = FakeObserver.all.at(-1)
    expect(current?.root).toBe(scrollRoot)
    current?.fire(early)
    expect(seen).toEqual([true])
  })
})
