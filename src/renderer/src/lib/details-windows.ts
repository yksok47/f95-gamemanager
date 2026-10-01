/** Visible details windows. The last id is the active (top) window. */

export const WINDOW_CASCADE_STEP = 32

export function activeWindowId(stack: readonly number[]): number | null {
  return stack.length ? stack[stack.length - 1]! : null
}

export function activateWindow(stack: readonly number[], threadId: number): number[] {
  if (stack[stack.length - 1] === threadId) return stack as number[]
  return [...stack.filter((id) => id !== threadId), threadId]
}

export function minimizeWindow(stack: readonly number[], threadId: number): number[] {
  if (!stack.includes(threadId)) return stack as number[]
  return stack.filter((id) => id !== threadId)
}

/** Taskbar click: restore/focus, or minimize when it is already active. */
export function toggleWindow(stack: readonly number[], threadId: number): number[] {
  if (stack[stack.length - 1] === threadId) return minimizeWindow(stack, threadId)
  return activateWindow(stack, threadId)
}

export function windowCascadeOffset(
  openCountBefore: number,
  step = WINDOW_CASCADE_STEP
): { x: number; y: number } {
  const n = ((openCountBefore % 10) + 10) % 10
  return { x: n * step, y: n * step }
}
