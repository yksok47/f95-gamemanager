import { describe, expect, test } from 'bun:test'
import {
  activateWindow,
  activeWindowId,
  minimizeWindow,
  toggleWindow,
  windowCascadeOffset
} from './details-windows'

describe('activateWindow', () => {
  test('opens a new window on top without hiding the others', () => {
    expect(activateWindow([1], 2)).toEqual([1, 2])
  })

  test('brings an already visible window to the front', () => {
    expect(activateWindow([1, 2, 3], 1)).toEqual([2, 3, 1])
  })

  test('returns the same stack when the window is already active', () => {
    const stack = [1, 2]
    expect(activateWindow(stack, 2)).toBe(stack)
  })
})

describe('minimizeWindow', () => {
  test('removes the window and leaves the previous one active', () => {
    expect(minimizeWindow([1, 2], 2)).toEqual([1])
    expect(activeWindowId(minimizeWindow([1, 2], 2))).toBe(1)
  })

  test('leaves other visible windows alone', () => {
    expect(minimizeWindow([1, 2, 3], 2)).toEqual([1, 3])
  })
})

describe('toggleWindow', () => {
  test('minimizes the active window', () => {
    expect(toggleWindow([1, 2], 2)).toEqual([1])
  })

  test('focuses a visible inactive window', () => {
    expect(toggleWindow([1, 2], 1)).toEqual([2, 1])
  })

  test('restores a minimized window on top', () => {
    expect(toggleWindow([1], 9)).toEqual([1, 9])
  })
})

describe('windowCascadeOffset', () => {
  test('offsets each newly opened window so it is not fully covered', () => {
    expect(windowCascadeOffset(0)).toEqual({ x: 0, y: 0 })
    expect(windowCascadeOffset(1)).toEqual({ x: 32, y: 32 })
    expect(windowCascadeOffset(2)).toEqual({ x: 64, y: 64 })
  })
})
