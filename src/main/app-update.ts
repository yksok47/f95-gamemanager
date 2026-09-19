import { createHash, timingSafeEqual } from 'crypto'
import { spawn } from 'child_process'
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
import { extractArchive } from './extract'
import { getAppPaths } from './paths'
import { pathExists, toFsPath } from './win-path'

const TEMP_PREFIX = 'f95-gamemanager-update-'
const APPLY_PREFIX = 'f95-gamemanager-apply-update-'
const API_BASE = `https://api.github.com/repos/${APP_UPDATE_GITHUB_OWNER}/${APP_UPDATE_GITHUB_REPO}`

type ApplyMode = 'nsis' | 'dir' | 'file'

type PreparedApply = {
  mode: ApplyMode
  src: string
  dst: string
  exeName: string
  tempRoot: string
  oldDir: string
  nextDir: string
  elevate: boolean
}

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

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function windowsApplyCommand(config: PreparedApply & { pid: number; version: string; resultFile: string }): string {
  return `
$ErrorActionPreference = 'Stop'
$pidToWait = ${config.pid}
$src = ${psQuote(config.src)}
$dst = ${psQuote(config.dst)}
$exeName = ${psQuote(config.exeName)}
$mode = ${psQuote(config.mode)}
$tempRoot = ${psQuote(config.tempRoot)}
$oldDir = ${psQuote(config.oldDir)}
$nextDir = ${psQuote(config.nextDir)}
$resultFile = ${psQuote(config.resultFile)}
$version = ${psQuote(config.version)}
$elevate = $${config.elevate ? 'true' : 'false'}

function Write-Result($ok, $err) {
  $okBit = if ($ok) { '1' } else { '0' }
  $safeErr = [string]$err
  $safeErr = $safeErr -replace '[\\r\\n]+', ' '
  @(
    "ok=$okBit"
    "version=$version"
    "error=$safeErr"
  ) | Set-Content -LiteralPath $resultFile -Encoding UTF8
}

function Wait-AppExit {
  for ($i = 0; $i -lt 120; $i++) {
    if (-not (Get-Process -Id $pidToWait -ErrorAction SilentlyContinue)) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Invoke-Retry([scriptblock]$action) {
  $last = $null
  for ($i = 0; $i -lt 30; $i++) {
    try { & $action; return }
    catch {
      $last = $_
      Start-Sleep -Seconds 1
    }
  }
  throw $last
}

function Start-App($path, $workDir) {
  Start-Process -FilePath $path -WorkingDirectory $workDir
}

try {
  if (-not (Wait-AppExit)) { throw 'Timed out waiting for the app to close' }
  Start-Sleep -Seconds 2

  if ($mode -eq 'nsis') {
    $argList = @('/S', '--updated')
    if ($elevate) {
      $p = Start-Process -FilePath $src -ArgumentList $argList -Verb RunAs -PassThru -Wait
    } else {
      $p = Start-Process -FilePath $src -ArgumentList $argList -PassThru -Wait
    }
    if ($null -ne $p.ExitCode -and $p.ExitCode -ne 0) { throw "Installer exited $($p.ExitCode)" }
    $exe = Join-Path $dst $exeName
    Start-App $exe $dst
    Write-Result $true ''
  }
  elseif ($mode -eq 'file') {
    Invoke-Retry {
      if (Test-Path -LiteralPath $dst) {
        Move-Item -LiteralPath $dst -Destination "$dst.old" -Force
      }
      Move-Item -LiteralPath $src -Destination $dst -Force
    }
    Remove-Item -LiteralPath "$dst.old" -Force -ErrorAction SilentlyContinue
    Start-App $dst (Split-Path -Parent $dst)
    Write-Result $true ''
  }
  else {
    $newExe = Join-Path $src $exeName
    if (-not (Test-Path -LiteralPath $newExe)) { throw 'The downloaded build is missing the app executable' }
    if (Test-Path -LiteralPath $oldDir) {
      Remove-Item -LiteralPath $oldDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    try {
      Invoke-Retry { Rename-Item -LiteralPath $dst -NewName (Split-Path $oldDir -Leaf) }
      try {
        Invoke-Retry { Rename-Item -LiteralPath $src -NewName (Split-Path $dst -Leaf) }
      } catch {
        Rename-Item -LiteralPath $oldDir -NewName (Split-Path $dst -Leaf) -ErrorAction SilentlyContinue
        throw
      }
    } catch {
      $robocopy = Start-Process -FilePath 'robocopy.exe' -ArgumentList @($src, $dst, '/MIR', '/R:20', '/W:1', '/NFL', '/NDL', '/NJH', '/NJS', '/NP') -Wait -PassThru
      if ($robocopy.ExitCode -ge 8) { throw "File replace failed ($($robocopy.ExitCode))" }
      if (Test-Path -LiteralPath $src) {
        Remove-Item -LiteralPath $src -Recurse -Force -ErrorAction SilentlyContinue
      }
    }
    Start-App (Join-Path $dst $exeName) $dst
    if (Test-Path -LiteralPath $oldDir) {
      Remove-Item -LiteralPath $oldDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Result $true ''
  }
} catch {
  Write-Result $false $_.Exception.Message
  try {
    $fallback = if ($mode -eq 'file') { $dst } else { Join-Path $dst $exeName }
    if (Test-Path -LiteralPath $fallback) { Start-App $fallback $(if ($mode -eq 'file') { Split-Path -Parent $dst } else { $dst }) }
  } catch {}
} finally {
  if ($tempRoot -and (Test-Path -LiteralPath $tempRoot)) {
    Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
  }
  if ($nextDir -and $nextDir -ne $dst -and (Test-Path -LiteralPath $nextDir)) {
    Remove-Item -LiteralPath $nextDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
`
}

function unixApplyScript(config: PreparedApply & { pid: number; version: string; resultFile: string }): string {
  return `#!/bin/sh
set -eu
PID=${config.pid}
SRC=${shQuote(config.src)}
DST=${shQuote(config.dst)}
EXE=${shQuote(config.exeName)}
MODE=${shQuote(config.mode)}
TEMP_ROOT=${shQuote(config.tempRoot)}
OLD_DIR=${shQuote(config.oldDir)}
NEXT_DIR=${shQuote(config.nextDir)}
RESULT_FILE=${shQuote(config.resultFile)}
VERSION=${shQuote(config.version)}

write_result() {
  ok="$1"
  err="$2"
  err=$(printf '%s' "$err" | tr '\\n\\r' '  ')
  {
    printf 'ok=%s\\n' "$ok"
    printf 'version=%s\\n' "$VERSION"
    printf 'error=%s\\n' "$err"
  } > "$RESULT_FILE"
}

wait_exit() {
  i=0
  while kill -0 "$PID" 2>/dev/null; do
    i=$((i + 1))
    if [ "$i" -gt 120 ]; then
      return 1
    fi
    sleep 0.5
  done
  sleep 2
  return 0
}

launch() {
  target="$1"
  workdir="$2"
  if [ "$(uname -s)" = "Darwin" ] && [ -d "$target" ]; then
    open "$target" >/dev/null 2>&1 || true
    return
  fi
  if [ "$(uname -s)" = "Darwin" ] && [ -d "$workdir" ] && printf '%s' "$workdir" | grep -q '\\.app$'; then
    open "$workdir" >/dev/null 2>&1 || true
    return
  fi
  ( cd "$workdir" && nohup "$target" >/dev/null 2>&1 & )
}

retry_mv() {
  from="$1"
  to="$2"
  i=0
  while [ "$i" -lt 30 ]; do
    if mv "$from" "$to"; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

mirror_dir() {
  from="$1"
  to="$2"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete "$from"/ "$to"/
    return
  fi
  cp -a "$from"/. "$to"/
  # Remove files left behind by the previous version.
  find "$to" -mindepth 1 | while IFS= read -r item; do
    rel=\${item#"$to"/}
    if [ ! -e "$from/$rel" ]; then
      rm -rf "$item"
    fi
  done
}

if ! wait_exit; then
  write_result 0 'Timed out waiting for the app to close'
  exit 1
fi

set +e
if [ "$MODE" = "file" ]; then
  chmod +x "$SRC" 2>/dev/null || true
  rm -f "$DST.old"
  retry_mv "$DST" "$DST.old"
  if retry_mv "$SRC" "$DST"; then
    chmod +x "$DST" 2>/dev/null || true
    rm -f "$DST.old"
    launch "$DST" "$(dirname "$DST")"
    write_result 1 ''
  else
    [ -e "$DST.old" ] && mv "$DST.old" "$DST"
    write_result 0 'Could not replace the AppImage'
    launch "$DST" "$(dirname "$DST")"
  fi
elif [ "$MODE" = "dir" ]; then
  if [ ! -e "$SRC/$EXE" ] && [ ! -d "$SRC" ]; then
    write_result 0 'The downloaded build is missing the app executable'
    exit 1
  fi
  rm -rf "$OLD_DIR"
  if retry_mv "$DST" "$OLD_DIR" && retry_mv "$SRC" "$DST"; then
    rm -rf "$OLD_DIR"
    if [ -d "$DST" ] && printf '%s' "$DST" | grep -q '\\.app$'; then
      launch "$DST" "$DST"
    else
      chmod +x "$DST/$EXE" 2>/dev/null || true
      launch "$DST/$EXE" "$DST"
    fi
    write_result 1 ''
  else
    [ -d "$OLD_DIR" ] && [ ! -e "$DST" ] && mv "$OLD_DIR" "$DST"
    if [ -d "$SRC" ] && [ -d "$DST" ]; then
      mirror_dir "$SRC" "$DST"
      rm -rf "$SRC" "$OLD_DIR"
      if [ -d "$DST" ] && printf '%s' "$DST" | grep -q '\\.app$'; then
        launch "$DST" "$DST"
      else
        launch "$DST/$EXE" "$DST"
      fi
      write_result 1 ''
    else
      write_result 0 'Could not replace the previous app files'
      if [ -d "$DST" ] && printf '%s' "$DST" | grep -q '\\.app$'; then
        launch "$DST" "$DST"
      else
        launch "$DST/$EXE" "$DST"
      fi
    fi
  fi
fi
set -e

rm -rf "$TEMP_ROOT"
if [ -n "$NEXT_DIR" ] && [ "$NEXT_DIR" != "$DST" ]; then
  rm -rf "$NEXT_DIR"
fi
rm -f "$0"
`
}

async function spawnApplyHelper(config: PreparedApply, version: string): Promise<void> {
  const resultFile = resultFilePath()
  await mkdir(dirname(resultFile), { recursive: true })
  await rmrf(resultFile)
  const payload = { ...config, pid: process.pid, version, resultFile }
  const dir = join(app.getPath('temp'), `${APPLY_PREFIX}${process.pid}`)
  await mkdir(dir, { recursive: true })

  if (process.platform === 'win32') {
    const ps1 = join(dir, 'apply.ps1')
    await writeFile(ps1, windowsApplyCommand(payload), 'utf8')
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1],
      { detached: true, stdio: 'ignore', windowsHide: true, cwd: app.getPath('temp') }
    )
    child.unref()
    return
  }

  const sh = join(dir, 'apply.sh')
  await writeFile(sh, unixApplyScript(payload), 'utf8')
  await chmod(sh, 0o755)
  const child = spawn('/bin/sh', [sh], {
    detached: true,
    stdio: 'ignore',
    cwd: app.getPath('temp')
  })
  child.unref()
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
  await cleanupNamed(`${root}.next`)
  await cleanupNamed(`${root}.new`)
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
    return {
      mode: 'nsis',
      src: archivePath,
      dst: dirname(process.execPath),
      exeName,
      tempRoot,
      oldDir: '',
      nextDir: '',
      elevate: pathIsProgramFiles(dirname(process.execPath))
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
  if (!status.available || !lastAsset) {
    const checked = await checkForAppUpdate()
    if (!checked.available || !lastAsset) return checked
  }
  const asset = lastAsset
  if (!asset) {
    return setStatus({ phase: 'error', error: 'No update file is available for this system.' })
  }

  busy = true
  const tempRoot = join(app.getPath('temp'), `${TEMP_PREFIX}${process.pid}-${Date.now()}`)
  try {
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
    const prepared = await preparePayload(currentInstallKind(), dest, tempRoot)
    setStatus({ phase: 'restarting', percent: 100 })
    await spawnApplyHelper(prepared, status.latestVersion || app.getVersion())
    releaseAppDirLock()
    app.quit()
    return status
  } catch (error) {
    await rmrf(tempRoot)
    busy = false
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
  void checkForAppUpdate().catch((error) => {
    console.warn('[app-update] check failed', error)
  })
}
