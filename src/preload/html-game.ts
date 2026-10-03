import { ipcRenderer } from 'electron'

try {
  const backup = ipcRenderer.sendSync('html-game:storage-pull') as unknown
  if (backup && typeof backup === 'object') {
    for (const [key, value] of Object.entries(backup as Record<string, unknown>)) {
      if (typeof key !== 'string' || typeof value !== 'string') continue
      if (localStorage.getItem(key) == null) localStorage.setItem(key, value)
    }
  }
} catch {
  // Restore is best-effort; the game can still run without a backup.
}

function push(): void {
  const data: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (key != null) data[key] = localStorage.getItem(key) || ''
  }
  ipcRenderer.send('html-game:storage-push', data)
}

setInterval(push, 30_000)
window.addEventListener('pagehide', push)
window.addEventListener('beforeunload', push)
