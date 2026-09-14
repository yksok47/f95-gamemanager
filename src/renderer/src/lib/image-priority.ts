/** Extra screenshot URLs wait until in-flight cover fetches drain. */

const SCREEN_CONCURRENCY = 2

let coversInFlight = 0
const queuedScreens: string[] = []
const queuedSet = new Set<string>()
const startedScreens = new Set<string>()
const activeScreens = new Map<string, HTMLImageElement>()

export function trackCoverStart(): void {
  coversInFlight += 1
  yieldToCovers()
}

export function trackCoverEnd(): void {
  coversInFlight = Math.max(0, coversInFlight - 1)
  pumpScreens()
}

export function enqueueLowPriorityScreens(urls: string[]): void {
  for (const url of urls) {
    if (!url || startedScreens.has(url) || queuedSet.has(url)) continue
    queuedSet.add(url)
    queuedScreens.push(url)
  }
  pumpScreens()
}

function yieldToCovers(): void {
  for (const [url, img] of [...activeScreens]) {
    img.onload = null
    img.onerror = null
    img.src = ''
    activeScreens.delete(url)
    startedScreens.delete(url)
    if (!queuedSet.has(url)) {
      queuedSet.add(url)
      queuedScreens.unshift(url)
    }
  }
}

function pumpScreens(): void {
  if (coversInFlight > 0) return
  while (activeScreens.size < SCREEN_CONCURRENCY && queuedScreens.length) {
    const url = queuedScreens.shift()
    if (!url) break
    queuedSet.delete(url)
    if (startedScreens.has(url)) continue
    startedScreens.add(url)
    const img = new Image()
    img.decoding = 'async'
    img.fetchPriority = 'low'
    const done = (): void => {
      activeScreens.delete(url)
      pumpScreens()
    }
    img.onload = done
    img.onerror = done
    activeScreens.set(url, img)
    img.src = url
  }
}
