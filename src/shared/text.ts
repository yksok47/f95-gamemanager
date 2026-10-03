/** Coerce catalog/store fields that JSON sometimes emits as numbers (e.g. title `365`). */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}
