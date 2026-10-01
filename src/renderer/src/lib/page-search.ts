export type SearchCandidate = {
  inDialog: boolean
  pageSearch: boolean
}

export function isPageSearchHotkey(event: KeyboardEvent): boolean {
  if (event.defaultPrevented || event.isComposing) return false
  if (event.key !== 'f' && event.key !== 'F') return false
  if (!(event.ctrlKey || event.metaKey)) return false
  if (event.altKey || event.shiftKey) return false
  return true
}

export function pickSearchCandidate<T extends SearchCandidate>(items: T[]): T | undefined {
  if (!items.length) return undefined
  const dialog = items.filter((item) => item.inDialog)
  const pool = dialog.length ? dialog : items
  return pool.find((item) => item.pageSearch) ?? pool[0]
}

/** Last visible dialog is the topmost overlay (nested or portaled). */
export function pickTopmost<T>(items: T[]): T | undefined {
  return items.length ? items[items.length - 1] : undefined
}

function isDisplayed(el: Element): boolean {
  if (el.closest('[hidden], [aria-hidden="true"]')) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function isUsableSearchInput(el: HTMLInputElement): boolean {
  if (el.disabled || el.readOnly) return false
  return isDisplayed(el)
}

export function findVisibleDialogs(root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')].filter(
    isDisplayed
  )
}

export function findPageSearchInput(root: ParentNode = document): HTMLInputElement | null {
  const dialog = pickTopmost(findVisibleDialogs(root instanceof Document ? root : document))
  const scope: ParentNode = dialog ?? root
  const inputs = [...scope.querySelectorAll<HTMLInputElement>('input[type="search"]')].filter(
    isUsableSearchInput
  )
  const picked = pickSearchCandidate(
    inputs.map((el) => ({
      el,
      inDialog: Boolean(el.closest('[role="dialog"], [role="alertdialog"]')),
      pageSearch: el.hasAttribute('data-page-search')
    }))
  )
  return picked?.el ?? null
}

export function focusPageSearchOnHotkey(event: KeyboardEvent): boolean {
  if (!isPageSearchHotkey(event)) return false
  const input = findPageSearchInput()
  if (input) {
    event.preventDefault()
    input.focus()
    input.select()
    return true
  }
  if (findVisibleDialogs().length) {
    event.preventDefault()
    return true
  }
  return false
}
