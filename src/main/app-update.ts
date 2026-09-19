import { createHash, timingSafeEqual } from 'crypto'
import { execFile as execFileCb, spawn } from 'child_process'
import { readdirSync } from 'fs'
import {
  chmod,
  cp,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { promisify } from 'util'
import { app, BrowserWindow, net } from 'electron'
import {
  APP_EXECUTABLE_NAME,
  APP_UPDATE_GITHUB_OWNER,
  APP_UPDATE_GITHUB_REPO,
  appInstallLabel,
  appUpdateChannel,
  checksumAssetName,
  detectAppInstallKind,
  emptyAppUpdateStatus,
  isRemoteAppVersionNewer,
  locateUpdatePayloadFromEntries,
  normalizeAppVersion,
  parseChecksumFile,
  parseUpdateResultFile,
  selectReleaseAsset,
  type AppInstallKind,
  type AppUpdateStatus,
  type GithubRelease,
  type GithubReleaseAsset
} from '@shared/app-update'
import {
  type PreparedApply,
  unixApplyScript,
  unixDetachedLaunchArgs,
  windowsApplyCmdContents,
  windowsApplyCommand,
  windowsCmdStartArgs,
  windowsShellExecuteCommand,
  shouldResumePendingUpdate
} from './app-update-apply'
import { extractArchive } from './extract'
import { getAppPaths } from './paths'
import { pathExists, toFsPath } from './win-path'

const execFile = promisify(execFileCb)
const TEMP_PREFIX = 'f95-gamemanager-update-'
const APPLY_PREFIX = 'f95-gamemanager-apply-update-'
const API_BASE = `https://api.github.com/repos/${APP_UPDATE_GITHUB_OWNER}/${APP_UPDATE_GITHUB_REPO}`
const HELPER_READY_TIMEOUT_MS = 15_000
const BEFORE_EXIT_TIMEOUT_MS = 10_000

type BeforeExitHook = () => Promise<void>

let beforeExitHook: BeforeExitHook | null = null
let applyingUpdate = false

let status: AppUpdateStatus = emptyAppUpdateStatus('0.0.0', 'dev', false)
let busy = false
let lastAsset: GithubReleaseAsset | null = null
let lastChecksum:
  | {
      algorithm: 'sha512' | 'sha256'
      hash: string
    }
  | null = null

function executableName(): string {
  return process.platform === 'win32' ? `${APP_EXECUTABLE_NAME}.exe` : APP_EXECUTABLE_NAME
}

function resultFilePath(): string {
  return join(getAppPaths().userData, 'app-update-result.txt')
}

function hasUninstaller(execDir: string): boolean {
  try {
    return readdirSync(toFsPath(execDir)).some((name) => /^uninstall.+\.exe$/i.test(name))
  } catch {
    return false
  }
}

function currentInstallKind(): AppInstallKind {
  return detectAppInstallKind({
    packaged: app.isPackaged,
    platform: process.platform,
    env: process.env,
    hasUninstaller: hasUninstaller(dirname(process.execPath))
  })
}

function pathIsProgramFiles(dir: string): boolean {
  const lower = dir.toLowerCase()
  for (const key of ['ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432']) {
    const value = process.env[key]
    if (value && lower.startsWith(value.toLowerCase())) return true
  }
  return false
}

function appRootForKind(kind: AppInstallKind): string {
  if (kind === 'appimage' && process.env.APPIMAGE) return process.env.APPIMAGE
  if (kind === 'mac') {
    return resolve(process.execPath, '..', '..', '..')
  }
  return dirname(process.execPath)
}

function emitStatus(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('app-update:status', status)
  }
}

function setStatus(patch: Partial<AppUpdateStatus>): AppUpdateStatus {
  status = {
    ...status,
    ...patch,
    canInstall: Boolean(
      (patch.packaged ?? status.packaged) &&
        (patch.available ?? status.available) &&
        ['available', 'error'].includes(patch.phase ?? status.phase)
    )
  }
  emitStatus()
  return status
}

function githubHeaders(accept: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: accept,
    'User-Agent': `F95GameManager/${app.getVersion()}`,
    'X-GitHub-Api-Version': '2022-11-28'
  }
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

async function githubFetch(url: string, accept = 'application/vnd.github+json'): Promise<Response> {
  return net.fetch(url, { headers: githubHeaders(accept), redirect: 'follow' })
}

async function githubJson<T>(url: string): Promise<T> {
  const response = await githubFetch(url)
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}`)
  }
  return JSON.parse(body) as T
}

async function fetchLatestRelease(): Promise<GithubRelease> {
  try {
    const latest = await githubJson<GithubRelease>(`${API_BASE}/releases/latest`)
    if (!latest?.tag_name) throw new Error('GitHub latest release is missing a tag')
    return latest
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!/404/.test(message)) throw error
    const list = await githubJson<GithubRelease[]>(`${API_BASE}/releases?per_page=10`)
    const pick = list.find((item) => !item.draft && !item.prerelease) ?? list.find((item) => !item.draft)
    if (!pick) throw new Error('No GitHub releases were found')
    return pick
  }
}

function hashesMatch(expected: string, actual: string): boolean {
  try {
    const left = Buffer.from(expected.trim().toLowerCase(), 'hex')
    const right = Buffer.from(actual.trim().toLowerCase(), 'hex')
    if (!left.length || left.length !== right.length) return false
    return timingSafeEqual(left, right)
  } catch {
    return false
  }
}

async function writeResponseToFile(
  response: Response,
  dest: string,
  onProgress?: (received: number, total: number) => void
): Promise<string> {
  const total = Number(response.headers.get('content-length')) || 0
  await mkdir(dirname(dest), { recursive: true })
  const handle = await open(toFsPath(dest), 'w')
  const hash = createHash('sha512')
  let received = 0
  try {
    const reader = response.body?.getReader()
    if (!reader) throw new Error('The download was empty')
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue
      hash.update(value)
      received += value.byteLength
      let offset = 0
      while (offset < value.byteLength) {
        const { bytesWritten } = await handle.write(value, offset, value.byteLength - offset)
        if (!bytesWritten) throw new Error('Could not write the download to disk')
        offset += bytesWritten
      }
      onProgress?.(received, total)
    }
  } finally {
    await handle.close()
  }
  return hash.digest('hex')
}

async function downloadAsset(
  url: string,
  dest: string,
  onProgress?: (received: number, total: number) => void
): Promise<string> {
  const response = await githubFetch(url, 'application/octet-stream')
  if (!response.ok) {
    throw new Error(`Download failed (${response.status})`)
  }
  return writeResponseToFile(response, dest, onProgress)
}

async function fetchChecksums(release: GithubRelease): Promise<Map<string, { algorithm: 'sha512' | 'sha256'; hash: string }>> {
  const asset = release.assets.find((item) => checksumAssetName(item.name))
  if (!asset) return new Map()
  const response = await githubFetch(asset.browser_download_url, 'application/octet-stream')
  if (!response.ok) return new Map()
  return parseChecksumFile(await response.text())
}

async function rmrf(target: string): Promise<void> {
  await rm(toFsPath(target), { recursive: true, force: true }).catch(() => undefined)
}

async function copyOrRename(from: string, to: string): Promise<void> {
  await rmrf(to)
  try {
    await rename(toFsPath(from), toFsPath(to))
  } catch {
    await mkdir(dirname(to), { recursive: true })
    await cp(toFsPath(from), toFsPath(to), { recursive: true, force: true })
    await rmrf(from)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function withTimeout(task: Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      task,
      new Promise<void>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timed out')), ms)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitForPath(target: string, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (pathExists(target)) return true
    await delay(100)
  }
  return pathExists(target)
}

function applyAttemptPath(): string {
  return join(getAppPaths().userData, 'app-update-apply-attempt.txt')
}

function pendingNsisSetupPath(): string {
  return join(getAppPaths().userData, 'pending-app-update-setup.exe')
}

async function readApplyAttemptMs(): Promise<number | null> {
  try {
    const raw = (await readFile(toFsPath(applyAttemptPath()), 'utf8')).trim()
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  } catch {
    return null
  }
}

async function writeApplyAttempt(): Promise<void> {
  const file = applyAttemptPath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(toFsPath(file), String(Date.now()), 'utf8')
}

export function setAppUpdateBeforeExitHook(hook: BeforeExitHook): void {
  beforeExitHook = hook
}

export function isApplyingAppUpdate(): boolean {
  return applyingUpdate
}

async function spawnDetached(command: string, args: string[], options: { cwd: string; windowsHide?: boolean }): Promise<void> {
  await new Promise<void>((resolveSpawn, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      cwd: options.cwd,
      windowsHide: options.windowsHide
    })
    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolveSpawn()
    })
  })
}

async function launchWindowsApplyHelper(cmdPath: string, readyFile: string): Promise<void> {
  const workDir = dirname(cmdPath)
  try {
    await execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', windowsShellExecuteCommand(cmdPath, workDir)],
      { windowsHide: true, timeout: 20_000 }
    )
  } catch (error) {
    console.warn('[app-update] ShellExecute helper launch failed, using cmd start', error)
  }
  if (await waitForPath(readyFile, 8_000)) return
  await spawnDetached('cmd.exe', windowsCmdStartArgs(cmdPath), {
    cwd: workDir,
    windowsHide: false
  })
}

async function spawnApplyHelper(config: PreparedApply, version: string): Promise<string> {
  const resultFile = resultFilePath()
  await mkdir(dirname(resultFile), { recursive: true })
  await rmrf(resultFile)
  const dir = join(app.getPath('temp'), `${APPLY_PREFIX}${process.pid}`)
  await mkdir(dir, { recursive: true })
  const readyFile = join(dir, 'ready.txt')
  await rmrf(readyFile)
  const payload = { ...config, pid: process.pid, version, resultFile, readyFile }

  if (process.platform === 'win32') {
    const ps1 = join(dir, 'apply.ps1')
    const cmd = join(dir, 'apply.cmd')
    await writeFile(ps1, `\uFEFF${windowsApplyCommand(payload)}`, 'utf8')
    await writeFile(cmd, windowsApplyCmdContents(), 'utf8')
    await launchWindowsApplyHelper(cmd, readyFile)
    return readyFile
  }

  const sh = join(dir, 'apply.sh')
  await writeFile(sh, unixApplyScript(payload), 'utf8')
  await chmod(sh, 0o755)
  const launch = unixDetachedLaunchArgs(sh)
  await spawnDetached(launch.command, launch.args, { cwd: app.getPath('temp') })
  return readyFile
}

async function runApplyAndExit(config: PreparedApply, version: string): Promise<void> {
  applyingUpdate = true
  await writeApplyAttempt()
  if (beforeExitHook) {
    await withTimeout(beforeExitHook(), BEFORE_EXIT_TIMEOUT_MS).catch((error) => {
      console.warn('[app-update] pre-exit cleanup failed', error)
    })
  }
  const readyFile = await spawnApplyHelper(config, version)
  releaseAppDirLock()
  if (!(await waitForPath(readyFile, HELPER_READY_TIMEOUT_MS))) {
    applyingUpdate = false
    throw new Error('The update helper did not start. The current app was left running.')
  }
  app.exit(0)
}

async function pendingPreparedApply(kind: AppInstallKind): Promise<PreparedApply | null> {
  const exeName = executableName()
  if (kind === 'dev') return null
  if (kind === 'nsis') {
    const src = pendingNsisSetupPath()
    if (!pathExists(src)) return null
    const dst = dirname(process.execPath)
    return {
      mode: 'nsis',
      src,
      dst,
      exeName,
      tempRoot: '',
      oldDir: '',
      nextDir: src,
      elevate: pathIsProgramFiles(dst)
    }
  }
  if (kind === 'appimage') {
    const dst = process.env.APPIMAGE || appRootForKind(kind)
    const next = `${dst}.new`
    if (!pathExists(next)) return null
    return {
      mode: 'file',
      src: next,
      dst,
      exeName,
      tempRoot: '',
      oldDir: `${dst}.old`,
      nextDir: next,
      elevate: false
    }
  }
  const root = appRootForKind(kind)
  const nextDir = `${root}.next`
  if (!pathExists(join(nextDir, exeName))) return null
  return {
    mode: 'dir',
    src: nextDir,
    dst: root,
    exeName,
    tempRoot: '',
    oldDir: `${root}.old`,
    nextDir,
    elevate: false
  }
}

function releaseAppDirLock(): void {
  try {
    process.chdir(app.getPath('temp'))
  } catch {
    try {
      process.chdir(tmpdir())
    } catch {
      /* ignore */
    }
  }
}

async function consumeUpdateResult(): Promise<void> {
  const file = resultFilePath()
  try {
    const parsed = parseUpdateResultFile(await readFile(toFsPath(file), 'utf8'))
    await rmrf(file)
    if (!parsed.ok) {
      setStatus({
        phase: 'error',
        error: parsed.error || 'The previous update failed',
        latestVersion: parsed.version || status.latestVersion
      })
    }
  } catch {
    /* no leftover result */
  }
}

async function cleanupNamed(target: string): Promise<void> {
  if (!target || !pathExists(target)) return
  await rmrf(target)
}

export async function cleanupStaleAppUpdates(): Promise<void> {
  const kind = currentInstallKind()
  const root = appRootForKind(kind)
  await cleanupNamed(`${root}.old`)
  const temp = app.getPath('temp')
  try {
    const names = await readdir(temp)
    await Promise.all(
      names
        .filter((name) => name.startsWith(TEMP_PREFIX) || name.startsWith(APPLY_PREFIX))
        .map((name) => rmrf(join(temp, name)))
    )
  } catch {
    /* ignore */
  }
}

export async function resumeInterruptedAppUpdate(): Promise<boolean> {
  if (!app.isPackaged || busy) return false
  const pending = await pendingPreparedApply(currentInstallKind())
  if (!pending) return false
  const lastAttemptMs = await readApplyAttemptMs()
  if (
    !shouldResumePendingUpdate({
      hasPending: true,
      lastAttemptMs,
      nowMs: Date.now()
    })
  ) {
    return false
  }
  busy = true
  setStatus({ phase: 'restarting', percent: 100, error: null })
  try {
    await runApplyAndExit(pending, status.latestVersion || app.getVersion())
    return true
  } catch (error) {
    busy = false
    applyingUpdate = false
    setStatus({
      phase: 'error',
      available: true,
      canInstall: true,
      error: error instanceof Error ? error.message : String(error)
    })
    return false
  }
}

function resetStatus(): void {
  const kind = currentInstallKind()
  status = emptyAppUpdateStatus(app.getVersion(), kind, app.isPackaged)
}

export function getAppUpdateStatus(): AppUpdateStatus {
  return status
}

export async function checkForAppUpdate(): Promise<AppUpdateStatus> {
  if (busy && (status.phase === 'downloading' || status.phase === 'preparing' || status.phase === 'restarting')) {
    return status
  }
  busy = true
  lastAsset = null
  lastChecksum = null
  setStatus({ phase: 'checking', error: null, percent: 0, bytesReceived: 0, bytesTotal: 0 })
  try {
    const release = await fetchLatestRelease()
    const latestVersion = normalizeAppVersion(release.tag_name)
    const kind = currentInstallKind()
    const available = isRemoteAppVersionNewer(app.getVersion(), latestVersion)
    const asset = available
      ? selectReleaseAsset(release.assets, {
          platform: process.platform as 'win32' | 'linux' | 'darwin',
          arch: process.arch,
          kind: appUpdateChannel(kind, process.platform)
        })
      : null
    if (available && asset) {
      lastAsset = asset
      const checksums = await fetchChecksums(release)
      lastChecksum = checksums.get(asset.name) ?? null
    }
    const error =
      available && !asset
        ? 'A newer version is on GitHub, but there is no build for this system yet.'
        : null
    return setStatus({
      currentVersion: app.getVersion(),
      latestVersion,
      available: Boolean(available && asset),
      packaged: app.isPackaged,
      installKind: kind,
      installLabel: appInstallLabel(kind),
      phase: error ? 'error' : available && asset ? 'available' : 'upToDate',
      assetName: asset?.name ?? null,
      releaseUrl: release.html_url,
      bytesTotal: asset?.size ?? 0,
      error
    })
  } catch (error) {
    return setStatus({
      phase: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    busy = false
  }
}

async function preparePayload(kind: AppInstallKind, archivePath: string, tempRoot: string): Promise<PreparedApply> {
  const exeName = executableName()
  const root = appRootForKind(kind)

  if (kind === 'nsis') {
    const pending = pendingNsisSetupPath()
    await copyOrRename(archivePath, pending)
    const dst = dirname(process.execPath)
    return {
      mode: 'nsis',
      src: pending,
      dst,
      exeName,
      tempRoot,
      oldDir: '',
      nextDir: pending,
      elevate: pathIsProgramFiles(dst)
    }
  }

  if (kind === 'appimage') {
    const dst = process.env.APPIMAGE || root
    const next = `${dst}.new`
    await copyOrRename(archivePath, next)
    await chmod(next, 0o755).catch(() => undefined)
    return {
      mode: 'file',
      src: next,
      dst,
      exeName,
      tempRoot,
      oldDir: `${dst}.old`,
      nextDir: next,
      elevate: false
    }
  }

  const extracted = join(tempRoot, 'extracted')
  await mkdir(extracted, { recursive: true })
  await extractArchive(archivePath, extracted, (percent) => {
    setStatus({ phase: 'preparing', percent: Math.min(99, 70 + Math.round(percent * 0.2)) })
  }, { unwrap: false })

  const entries: string[] = []
  async function walk(dir: string, prefix: string): Promise<void> {
    const names = await readdir(toFsPath(dir), { withFileTypes: true })
    for (const entry of names) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      const full = join(dir, entry.name)
      if (entry.isDirectory()) await walk(full, rel)
      else entries.push(rel)
    }
  }
  await walk(extracted, '')
  const located = locateUpdatePayloadFromEntries(entries, {
    platform: process.platform,
    executableName: APP_EXECUTABLE_NAME
  })
  if (!located) {
    throw new Error('The downloaded archive did not contain the app files')
  }
  const payload = located.root ? join(extracted, located.root) : extracted
  const nextDir = `${root}.next`
  await copyOrRename(payload, nextDir)
  return {
    mode: 'dir',
    src: nextDir,
    dst: root,
    exeName,
    tempRoot,
    oldDir: `${root}.old`,
    nextDir,
    elevate: false
  }
}

export async function downloadAndInstallAppUpdate(): Promise<AppUpdateStatus> {
  if (busy) return status
  if (!app.isPackaged) {
    return setStatus({ phase: 'error', error: 'Packaged builds can install updates. Dev mode is already running from source.' })
  }
  const kind = currentInstallKind()
  const pending = await pendingPreparedApply(kind)
  if (!pending) {
    if (!status.available || !lastAsset) {
      const checked = await checkForAppUpdate()
      if (!checked.available || !lastAsset) return checked
    }
    if (!lastAsset) {
      return setStatus({ phase: 'error', error: 'No update file is available for this system.' })
    }
  }

  busy = true
  const tempRoot = pending ? '' : join(app.getPath('temp'), `${TEMP_PREFIX}${process.pid}-${Date.now()}`)
  try {
    let prepared = pending
    if (!prepared) {
      const asset = lastAsset
      if (!asset) {
        throw new Error('No update file is available for this system.')
      }
      await mkdir(tempRoot, { recursive: true })
      const dest = join(tempRoot, asset.name)
      setStatus({
        phase: 'downloading',
        percent: 0,
        bytesReceived: 0,
        bytesTotal: asset.size,
        error: null
      })
      const digest = await downloadAsset(asset.browser_download_url, dest, (received, total) => {
        const bytesTotal = total || asset.size
        const percent = bytesTotal > 0 ? Math.min(69, Math.round((received / bytesTotal) * 69)) : 0
        if (percent === status.percent && received !== bytesTotal) return
        setStatus({
          phase: 'downloading',
          bytesReceived: received,
          bytesTotal,
          percent
        })
      })
      if (lastChecksum) {
        let actual = digest
        if (lastChecksum.algorithm === 'sha256') {
          actual = createHash('sha256').update(await readFile(toFsPath(dest))).digest('hex')
        }
        if (!hashesMatch(lastChecksum.hash, actual)) {
          throw new Error('The downloaded update failed checksum verification')
        }
      }
      const size = (await stat(toFsPath(dest))).size
      if (asset.size > 0 && size !== asset.size) {
        throw new Error('The downloaded update is the wrong size')
      }

      setStatus({ phase: 'preparing', percent: 75 })
      prepared = await preparePayload(kind, dest, tempRoot)
    } else {
      setStatus({ phase: 'preparing', percent: 90, error: null })
    }
    setStatus({ phase: 'restarting', percent: 100 })
    await runApplyAndExit(prepared, status.latestVersion || app.getVersion())
    return status
  } catch (error) {
    if (tempRoot) await rmrf(tempRoot)
    busy = false
    applyingUpdate = false
    return setStatus({
      phase: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export function initAppUpdateStatus(): void {
  resetStatus()
}

export async function startAppUpdateService(): Promise<void> {
  resetStatus()
  await consumeUpdateResult()
  emitStatus()
  await checkForAppUpdate().catch((error) => {
    console.warn('[app-update] check failed', error)
  })
  if (await pendingPreparedApply(currentInstallKind())) {
    setStatus({
      available: true,
      phase: status.phase === 'error' ? 'error' : 'available',
      error:
        status.phase === 'error'
          ? status.error || 'The last update downloaded but did not replace the app files. Click Update and restart to finish applying it.'
          : null
    })
  }
}
