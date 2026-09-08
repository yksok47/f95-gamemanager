import { BrowserWindow } from 'electron'

export function isUsableWindow(win: BrowserWindow | null | undefined): win is BrowserWindow {
  try {
    return Boolean(win && !win.isDestroyed() && !win.webContents.isDestroyed())
  } catch {
    return false
  }
}

export function sendToRenderer(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      if (!isUsableWindow(win)) continue
      win.webContents.send(channel, payload)
    } catch {
      // The window can close between the check and the send.
    }
  }
}
