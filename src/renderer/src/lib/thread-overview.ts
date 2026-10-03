import type { ThreadField } from '@shared/types'
import { isRelativeDate } from '@shared/updates'

export function filterOverviewFields(fields: ThreadField[]): ThreadField[] {
  return fields.filter(
    (field) =>
      !/thread updated|thread update|^updated$|last updated|release date|^released$|publication date/i.test(
        field.label
      ) &&
      !/other games|related games|more games|also (?:try|check|play)/i.test(field.label) &&
      !/^genre$/i.test(field.label)
  )
}

export function formatThreadDate(value: string): string {
  if (!value || isRelativeDate(value)) return value || ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
