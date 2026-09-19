export type ApplyMode = 'nsis' | 'dir' | 'file'

export type PreparedApply = {
  mode: ApplyMode
  src: string
  dst: string
  exeName: string
  tempRoot: string
  oldDir: string
  nextDir: string
  elevate: boolean
}

export type ApplyHelperConfig = PreparedApply & {
  pid: number
  version: string
  resultFile: string
  readyFile: string
}

export const APPLY_RESUME_COOLDOWN_MS = 5 * 60 * 1000

export function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function shouldResumePendingUpdate(input: {
  hasPending: boolean
  lastAttemptMs: number | null
  nowMs: number
}): boolean {
  if (!input.hasPending) return false
  if (input.lastAttemptMs == null) return true
  return input.nowMs - input.lastAttemptMs >= APPLY_RESUME_COOLDOWN_MS
}

export function windowsApplyCmdContents(): string {
  return [
    '@echo off',
    'cd /d "%~dp0"',
    'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0apply.ps1"',
    ''
  ].join('\r\n')
}

export function windowsShellExecuteCommand(file: string, workDir: string): string {
  return [
    '(New-Object -ComObject Shell.Application).ShellExecute(',
    `${psQuote(file)},`,
    `'',`,
    `${psQuote(workDir)},`,
    `'open',`,
    '0)'
  ].join(' ')
}

export function windowsCmdStartArgs(cmdPath: string): string[] {
  return ['/c', 'start', 'F95Update', '/min', cmdPath]
}

export function unixDetachedLaunchArgs(scriptPath: string): { command: string; args: string[] } {
  return {
    command: '/bin/sh',
    args: ['-c', `nohup ${shQuote(scriptPath)} >/dev/null 2>&1 &`]
  }
}

export function trashAsarName(filePath: string): string | null {
  const base = filePath.split(/[/\\]/).pop() || ''
  if (!/\.asar$/i.test(base)) return null
  return `${filePath}.trash`
}

export function windowsApplyCommand(config: ApplyHelperConfig): string {
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
$readyFile = ${psQuote(config.readyFile)}
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

function Wait-Unlocked($path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return $true }
  for ($i = 0; $i -lt 80; $i++) {
    try {
      $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
      $fs.Close()
      return $true
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  return $false
}

function Wait-ExeReleased($exePath) {
  if (-not $exePath) { return $true }
  $leaf = [System.IO.Path]::GetFileNameWithoutExtension($exePath)
  if (-not $leaf) { return $true }
  for ($i = 0; $i -lt 60; $i++) {
    $busy = $false
    Get-Process -Name $leaf -ErrorAction SilentlyContinue | ForEach-Object {
      try {
        if ($_.Path -and [string]::Equals($_.Path, $exePath, [System.StringComparison]::OrdinalIgnoreCase)) {
          $busy = $true
        }
      } catch {}
    }
    if (-not $busy) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

function Wait-AsarsUnlocked($root) {
  $resources = Join-Path $root 'resources'
  if (-not (Test-Path -LiteralPath $resources)) { return }
  Get-ChildItem -LiteralPath $resources -File -Force -Filter *.asar -ErrorAction SilentlyContinue | ForEach-Object {
    Wait-Unlocked $_.FullName | Out-Null
  }
}

function Neutralize-Asars($root) {
  Get-ChildItem -LiteralPath $root -Recurse -File -Force -Filter *.asar -ErrorAction SilentlyContinue | ForEach-Object {
    Wait-Unlocked $_.FullName | Out-Null
    try { Move-Item -LiteralPath $_.FullName -Destination ($_.FullName + '.trash') -Force } catch {}
  }
}

function Start-DelayedRemove($path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return }
  $inner = 'ping 127.0.0.1 -n 20 >nul & rmdir /s /q "' + $path + '" & del /f /q "' + $path + '"'
  Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $inner) -WindowStyle Hidden
}

function Remove-OldTree($path) {
  if (-not $path -or -not (Test-Path -LiteralPath $path)) { return }
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    Wait-Unlocked $path | Out-Null
    try { Remove-Item -LiteralPath $path -Force -ErrorAction Stop; return } catch {}
    Start-DelayedRemove $path
    return
  }
  Wait-AsarsUnlocked $path
  Neutralize-Asars $path
  for ($i = 0; $i -lt 8; $i++) {
    try {
      Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
      return
    } catch {
      Start-Sleep -Milliseconds 750
    }
  }
  Start-DelayedRemove $path
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

Set-Content -LiteralPath $readyFile -Value '1' -Encoding ASCII

try {
  if (-not (Wait-AppExit)) { throw 'Timed out waiting for the app to close' }
  Start-Sleep -Seconds 2
  if ($mode -ne 'file') {
    Wait-ExeReleased (Join-Path $dst $exeName) | Out-Null
    Wait-Unlocked (Join-Path $dst $exeName) | Out-Null
    Wait-AsarsUnlocked $dst
  } else {
    Wait-Unlocked $dst | Out-Null
  }

  if ($mode -eq 'nsis') {
    $argList = @('/S', '--updated')
    $installerDir = Split-Path $src
    if ($elevate) {
      $p = Start-Process -FilePath $src -ArgumentList $argList -WorkingDirectory $installerDir -Verb RunAs -PassThru -Wait
    } else {
      $p = Start-Process -FilePath $src -ArgumentList $argList -WorkingDirectory $installerDir -PassThru -Wait
    }
    if ($null -ne $p.ExitCode -and $p.ExitCode -ne 0) { throw "Installer exited $($p.ExitCode)" }
    $exe = Join-Path $dst $exeName
    if (-not (Test-Path -LiteralPath $exe)) { throw 'Installer finished but the app executable was not found' }
    Wait-Unlocked $exe | Out-Null
    Start-App $exe $dst
    Remove-Item -LiteralPath $src -Force -ErrorAction SilentlyContinue
    Write-Result $true ''
  }
  elseif ($mode -eq 'file') {
    Invoke-Retry {
      if (Test-Path -LiteralPath $dst) {
        Move-Item -LiteralPath $dst -Destination $oldDir -Force
      }
      Move-Item -LiteralPath $src -Destination $dst -Force
    }
    Remove-OldTree $oldDir
    Start-App $dst (Split-Path -Parent $dst)
    Start-DelayedRemove $oldDir
    Write-Result $true ''
  }
  else {
    $newExe = Join-Path $src $exeName
    if (-not (Test-Path -LiteralPath $newExe)) { throw 'The downloaded build is missing the app executable' }
    if (Test-Path -LiteralPath $oldDir) {
      Remove-OldTree $oldDir
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
    Remove-OldTree $oldDir
    Start-App (Join-Path $dst $exeName) $dst
    Start-DelayedRemove $oldDir
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
}
`
}

export function unixApplyScript(config: ApplyHelperConfig): string {
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
READY_FILE=${shQuote(config.readyFile)}
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

printf '1' > "$READY_FILE"

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
rm -f "$0"
`
}
