import { describe, expect, test } from 'bun:test'
import {
  APPLY_RESUME_COOLDOWN_MS,
  shouldResumePendingUpdate,
  unixApplyScript,
  unixDetachedLaunchArgs,
  windowsApplyCmdContents,
  windowsApplyCommand,
  windowsCmdStartArgs,
  windowsShellExecuteCommand,
  type ApplyHelperConfig
} from './app-update-apply'

const config: ApplyHelperConfig = {
  mode: 'dir',
  src: 'C:\\games\\win-unpacked.next',
  dst: 'C:\\games\\win-unpacked',
  exeName: 'F95GameManager.exe',
  tempRoot: 'C:\\Temp\\f95-gamemanager-update-1',
  oldDir: 'C:\\games\\win-unpacked.old',
  nextDir: 'C:\\games\\win-unpacked.next',
  elevate: false,
  pid: 4242,
  version: '1.2.3',
  resultFile: 'C:\\Users\\me\\AppData\\Roaming\\F95 Game Manager\\app-update-result.txt',
  readyFile: 'C:\\Temp\\f95-gamemanager-apply-update-1\\ready.txt'
}

describe('shouldResumePendingUpdate', () => {
  test('resumes when a staged payload exists and nothing has tried recently', () => {
    expect(
      shouldResumePendingUpdate({ hasPending: true, lastAttemptMs: null, nowMs: 10_000 })
    ).toBe(true)
  })

  test('does not resume while a recent attempt is still cooling down', () => {
    expect(
      shouldResumePendingUpdate({
        hasPending: true,
        lastAttemptMs: 1_000,
        nowMs: 1_000 + APPLY_RESUME_COOLDOWN_MS - 1
      })
    ).toBe(false)
  })

  test('resumes again after the cooldown', () => {
    expect(
      shouldResumePendingUpdate({
        hasPending: true,
        lastAttemptMs: 1_000,
        nowMs: 1_000 + APPLY_RESUME_COOLDOWN_MS
      })
    ).toBe(true)
  })

  test('does nothing when no staged payload exists', () => {
    expect(
      shouldResumePendingUpdate({ hasPending: false, lastAttemptMs: null, nowMs: 10_000 })
    ).toBe(false)
  })
})

describe('windows helper launch', () => {
  test('uses cmd start so the helper is not a child of Electron', () => {
    expect(windowsCmdStartArgs('C:\\Temp\\apply.cmd')).toEqual([
      '/c',
      'start',
      'F95Update',
      '/min',
      'C:\\Temp\\apply.cmd'
    ])
  })

  test('asks Explorer to ShellExecute the cmd script hidden', () => {
    const command = windowsShellExecuteCommand('C:\\Temp\\apply.cmd', 'C:\\Temp')
    expect(command).toContain('Shell.Application')
    expect(command).toContain('ShellExecute')
    expect(command).toContain("'C:\\Temp\\apply.cmd'")
    expect(command).toMatch(/,\s*0\)\s*$/)
  })

  test('cmd wrapper runs the powershell apply script', () => {
    expect(windowsApplyCmdContents()).toContain(
      'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0apply.ps1"'
    )
  })
})

describe('windowsApplyCommand', () => {
  test('signals ready, waits for the app pid, then swaps directories', () => {
    const script = windowsApplyCommand(config)
    expect(script).toContain('$pidToWait = 4242')
    expect(script).toContain("Set-Content -LiteralPath $readyFile -Value '1'")
    expect(script).toContain('Wait-AppExit')
    expect(script).toContain('Rename-Item')
    expect(script).toContain('Start-App')
    expect(script).not.toMatch(/\$pid\s*=/)
  })

  test('keeps the staged .next payload if apply fails', () => {
    const script = windowsApplyCommand(config)
    expect(script).toContain('Remove-Item -LiteralPath $tempRoot')
    expect(script).not.toContain('Remove-Item -LiteralPath $nextDir')
  })

  test('runs the NSIS installer silently then relaunches the app', () => {
    const script = windowsApplyCommand({ ...config, mode: 'nsis', src: 'C:\\Users\\me\\pending-app-update-setup.exe' })
    expect(script).toContain("$mode = 'nsis'")
    expect(script).toContain("'/S', '--updated'")
    expect(script).toContain('Installer finished but the app executable was not found')
    expect(script).toContain('Start-App $exe $dst')
  })
})

describe('unix helper launch', () => {
  test('starts the script with nohup so it survives Electron exit', () => {
    const launch = unixDetachedLaunchArgs('/tmp/apply.sh')
    expect(launch.command).toBe('/bin/sh')
    expect(launch.args[0]).toBe('-c')
    expect(launch.args[1]).toContain('nohup')
    expect(launch.args[1]).toContain("'/tmp/apply.sh'")
    expect(launch.args[1]).toMatch(/&\s*$/)
  })
})

describe('unixApplyScript', () => {
  test('signals ready before waiting for the app to exit', () => {
    const script = unixApplyScript({ ...config, src: '/tmp/app.next', dst: '/tmp/app' })
    expect(script).toContain('printf \'1\' > "$READY_FILE"')
    expect(script).toContain('wait_exit')
  })

  test('does not delete the staged payload on the way out', () => {
    const script = unixApplyScript({ ...config, src: '/tmp/app.next', dst: '/tmp/app' })
    expect(script).toContain('rm -rf "$TEMP_ROOT"')
    expect(script).not.toContain('rm -rf "$NEXT_DIR"')
  })
})
