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

function isUsableSearchInput(el: HTMLInputElement): boolean {
  if (el.disabled || el.readOnly) return false
  if (el.closest('[hidden], [aria-hidden="true"]')) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const rect = el.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

export function findPageSearchInput(root: ParentNode = document): HTMLInputElement | null {
  const inputs = [...root.querySelectorAll<HTMLInputElement>('input[type="search"]')].filter(
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
  if (!input) return false
  event.preventDefault()
  input.focus()
  input.select()
  return true
}
