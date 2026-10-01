/** Share one in-flight promise per key so overlapping callers (React Strict Mode) hit the network once. */
export function coalesceInflight<T>(
  map: Map<string, Promise<T>>,
  key: string,
  start: () => Promise<T>
): Promise<T> {
  const existing = map.get(key)
  if (existing) return existing
  const pending = start().finally(() => {
    if (map.get(key) === pending) map.delete(key)
  })
  map.set(key, pending)
  return pending
}

/** GET/HEAD key with `_` cache-busters removed. Null for mutating methods. */
export function f95InflightGetKey(method: string, url: string): string | null {
  const verb = method.toUpperCase()
  if (verb !== 'GET' && verb !== 'HEAD') return null
  try {
    const parsed = new URL(url)
    parsed.searchParams.delete('_')
    parsed.hash = ''
    return `${verb} ${parsed.toString()}`
  } catch {
    return `${verb} ${url}`
  }
}
