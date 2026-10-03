import { BrowserWindow, ipcMain, shell } from 'electron'
import { dirname, join, resolve, sep } from 'path'
import { appIcon } from '../app-icon'
import {
  finishPlaySession,
  setHtmlPlayHooks,
  startPlaySession
} from '../play-sessions'
import { isUsableWindow } from '../windows'
import {
  htmlGameEntryUrl,
  htmlGameOrigin,
  htmlGameSession,
  mountHtmlGame,
  registerHtmlGameProtocol,
  unmountHtmlGame
} from './protocol'
import {
  htmlStorageForRestore,
  readHtmlStorageBackup,
  setHtmlLiveStorageHooks,
  writeHtmlStorageBackup
} from './saves'

type HtmlWindowRecord = {
  fileId: string
  threadId: number
  title: string
  installPath: string
  win: BrowserWindow
  closed: Promise<void>
}

const windows = new Map<string, HtmlWindowRecord>()
const restoreByContents = new Map<number, Record<string, string>>()
const recordByContents = new Map<number, HtmlWindowRecord>()
let ipcRegistered = false

const DUMP_STORAGE = `(() => {
  const data = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key != null) data[key] = localStorage.getItem(key) || ''
  }
  return data
})()`

function isInside(target: string, root: string): boolean {
  const resolved = resolve(target)
  const base = resolve(root)
  return resolved === base || resolved.startsWith(base + sep)
}

function recordForContents(contents: Electron.WebContents | null | undefined): HtmlWindowRecord | null {
  if (!contents || contents.isDestroyed()) return null
  return recordByContents.get(contents.id) ?? null
}

async function dumpWindowStorage(record: HtmlWindowRecord): Promise<Record<string, string> | null> {
  if (!isUsableWindow(record.win)) return null
  try {
    const raw = (await record.win.webContents.executeJavaScript(DUMP_STORAGE, true)) as unknown
    if (!raw || typeof raw !== 'object') return null
    const keys: Record<string, string> = {}
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof key === 'string' && typeof value === 'string') keys[key] = value
    }
    await writeHtmlStorageBackup(record.threadId, keys, record.title)
    return keys
  } catch (error) {
    console.warn('Could not backup HTML game localStorage', error)
    return null
  }
}

async function readOpenWindowStorage(fileId: string): Promise<Record<string, string> | null> {
  const record = windows.get(fileId)
  if (!record) return null
  return dumpWindowStorage(record)
}

async function removeOpenWindowKeys(fileId: string, keys: string[]): Promise<void> {
  const record = windows.get(fileId)
  if (!record || !isUsableWindow(record.win) || !keys.length) return
  const payload = JSON.stringify(keys)
  try {
    await record.win.webContents.executeJavaScript(
      `(${payload}).forEach((key) => localStorage.removeItem(key))`,
      true
    )
  } catch (error) {
    console.warn('Could not delete HTML game localStorage keys', error)
  }
}

async function clearOrigin(threadId: number): Promise<void> {
  try {
    await htmlGameSession().clearStorageData({
      origin: htmlGameOrigin(threadId),
      storages: ['localstorage', 'indexdb', 'cookies', 'cachestorage']
    })
  } catch (error) {
    console.warn('Could not clear HTML game browser storage', error)
  }
}

function detach(record: HtmlWindowRecord): void {
  windows.delete(record.fileId)
  const contentsId = record.win.isDestroyed() ? null : record.win.webContents.id
  if (contentsId != null) {
    restoreByContents.delete(contentsId)
    recordByContents.delete(contentsId)
  }
  const stillMounted = [...windows.values()].some((item) => item.threadId === record.threadId)
  if (!stillMounted) unmountHtmlGame(record.threadId)
}

export function isHtmlGameWindowOpen(fileId: string): boolean {
  const record = windows.get(fileId)
  return Boolean(record && isUsableWindow(record.win))
}

export async function closeHtmlGameWindow(fileId: string): Promise<void> {
  const record = windows.get(fileId)
  if (!record) return
  if (isUsableWindow(record.win)) {
    await dumpWindowStorage(record)
    if (isUsableWindow(record.win)) record.win.close()
  }
  await record.closed
}

export async function launchHtmlGame(input: {
  fileId: string
  threadId: number
  title: string
  version?: string
  installPath: string
  htmlPath: string
  parent?: BrowserWindow | null
}): Promise<{ pid: number }> {
  const existing = windows.get(input.fileId)
  if (existing && isUsableWindow(existing.win)) {
    existing.win.maximize()
    existing.win.show()
    existing.win.focus()
    return { pid: existing.win.webContents.getOSProcessId() || 1 }
  }

  for (const record of [...windows.values()]) {
    if (record.threadId !== input.threadId || record.fileId === input.fileId) continue
    await closeHtmlGameWindow(record.fileId)
  }

  const root = isInside(input.htmlPath, input.installPath) ? input.installPath : dirname(input.htmlPath)
  mountHtmlGame(input.threadId, root, input.htmlPath)
  const backup = await readHtmlStorageBackup(input.threadId)
  const restoreKeys = htmlStorageForRestore(backup)

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    title: input.title || 'HTML game',
    icon: appIcon,
    backgroundColor: '#12141a',
    parent: isUsableWindow(input.parent) ? input.parent : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/html-game.js'),
      session: htmlGameSession(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  let resolveClosed: () => void = () => undefined
  const closed = new Promise<void>((resolvePromise) => {
    resolveClosed = resolvePromise
  })
  const record: HtmlWindowRecord = {
    fileId: input.fileId,
    threadId: input.threadId,
    title: input.title,
    installPath: input.installPath,
    win,
    closed
  }
  windows.set(input.fileId, record)
  restoreByContents.set(win.webContents.id, restoreKeys)
  recordByContents.set(win.webContents.id, record)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(htmlGameOrigin(input.threadId))) return
    if (/^https?:/i.test(url)) {
      event.preventDefault()
      void shell.openExternal(url)
      return
    }
    event.preventDefault()
  })

  win.on('closed', () => {
    detach(record)
    void finishPlaySession(input.fileId).finally(resolveClosed)
  })
  win.on('ready-to-show', () => {
    if (win.isDestroyed()) return
    win.maximize()
    win.show()
  })

  const pid = 1
  startPlaySession({
    fileId: input.fileId,
    threadId: input.threadId,
    version: input.version,
    pid,
    installPath: input.installPath,
    kind: 'html'
  })

  const url = htmlGameEntryUrl(input.threadId, root, input.htmlPath)
  await win.loadURL(url)
  if (!win.isDestroyed()) {
    const livePid = win.webContents.getOSProcessId()
    if (livePid) {
      startPlaySession({
        fileId: input.fileId,
        threadId: input.threadId,
        version: input.version,
        pid: livePid,
        installPath: input.installPath,
        kind: 'html'
      })
    }
  }
  return { pid: win.isDestroyed() ? pid : win.webContents.getOSProcessId() || pid }
}

export function registerHtmlGameRuntime(): void {
  registerHtmlGameProtocol()
  setHtmlPlayHooks({
    isOpen: isHtmlGameWindowOpen,
    close: closeHtmlGameWindow,
    backup: async (fileId) => {
      const record = windows.get(fileId)
      if (!record) return
      await dumpWindowStorage(record)
    }
  })
  setHtmlLiveStorageHooks({
    read: readOpenWindowStorage,
    removeKeys: removeOpenWindowKeys,
    clearOrigin
  })
  if (ipcRegistered) return
  ipcRegistered = true
  ipcMain.on('html-game:storage-pull', (event) => {
    event.returnValue = restoreByContents.get(event.sender.id) ?? {}
  })
  ipcMain.on('html-game:storage-push', (event, payload: unknown) => {
    const record = recordForContents(event.sender)
    if (!record || !payload || typeof payload !== 'object') return
    const keys: Record<string, string> = {}
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof key === 'string' && typeof value === 'string') keys[key] = value
    }
    void writeHtmlStorageBackup(record.threadId, keys, record.title)
  })
}
