import { basename, join } from 'path'
import type { RenpyLastRun, RenpyStatus, UnRenAction } from '@shared/types'
import { pathExists, stripNamespace } from '../win-path'
import { sendToRenderer } from '../windows'
import { gameDirFromRoot, listRpycNeedingDecompile, scanScripts } from './scan'
import {
  detectGamePython,
  isUnRenCancelled,
  runGamePython,
  runGamePythonScript,
  throwIfUnRenCancelled,
  type GamePython
} from './runtime'
import { getTrackedCounts, recordNewGameFiles, retractTrackedFiles, snapshotGameRels } from './unren-files'
import { getUnrenVendor, removeUnrpycStage, stageUnrpycTree } from './vendor'

const MAX_LOG = 80_000

type UnRenJob = {
  fileId: string
  gameRoot: string
  action: UnRenAction
  abort: AbortController
  promise: Promise<RenpyLastRun>
}

const jobsByRoot = new Map<string, UnRenJob>()
const jobsByFile = new Map<string, UnRenJob>()
const lastRunByFile = new Map<string, RenpyLastRun>()
const liveByFile = new Map<string, RenpyStatus>()

export function getLastUnRenRun(fileId: string): RenpyLastRun | null {
  return lastRunByFile.get(fileId) ?? null
}

export function getLiveUnRenStatus(fileId: string): RenpyStatus | null {
  return liveByFile.get(fileId) ?? null
}

export function replayUnRenStatus(fileId: string): void {
  const live = liveByFile.get(fileId)
  if (live) sendToRenderer('renpy:status', live)
}

function clipLog(log: string): string {
  if (log.length <= MAX_LOG) return log
  return log.slice(log.length - MAX_LOG)
}

function broadcast(fileId: string, next: RenpyStatus): void {
  liveByFile.set(fileId, next)
  sendToRenderer('renpy:status', next)
}

function emit(
  fileId: string,
  action: UnRenAction | 'locate',
  message: string,
  extra: Partial<RenpyStatus> = {}
): void {
  const previous = liveByFile.get(fileId)
  const log =
    extra.log != null
      ? clipLog(extra.log)
      : clipLog(`${previous?.log || ''}${message.endsWith('\n') ? message : `${message}\n`}`)
  broadcast(fileId, {
    fileId,
    running: extra.running ?? true,
    cancelling: extra.cancelling ?? previous?.cancelling ?? false,
    action,
    message,
    log,
    error: extra.error ?? previous?.error ?? null,
    done: extra.done ?? previous?.done ?? 0,
    total: extra.total ?? previous?.total ?? 0,
    percent: extra.percent ?? previous?.percent ?? null
  })
}

function finish(fileId: string, run: RenpyLastRun): RenpyLastRun {
  lastRunByFile.set(fileId, run)
  broadcast(fileId, {
    fileId,
    running: false,
    cancelling: false,
    action: run.action,
    message: run.summary,
    log: run.log,
    error: run.error,
    done: run.done,
    total: run.total,
    percent: 100
  })
  return run
}

function outputText(result: { stdout: string; stderr: string }): string {
  return `${result.stdout}${result.stderr ? `\n${result.stderr}` : ''}`.trim()
}

function cancelledSummary(action: UnRenAction, done: number, total: number, added: number): string {
  const noun = action === 'extract' ? 'archive(s)' : 'script(s)'
  const work = total
    ? `Finished ${done}/${total} ${noun} before stopping.`
    : 'Stopped before any files were written.'
  const extra = added ? ` ${added} file(s) were written and can be removed.` : ''
  return `Stopped. ${work}${extra}`
}

async function extractArchive(
  runtime: GamePython,
  vendor: ReturnType<typeof getUnrenVendor>,
  archivePath: string,
  gameDir: string,
  signal?: AbortSignal
): Promise<void> {
  const archive = stripNamespace(archivePath)
  const outDir = stripNamespace(gameDir)
  const primary = await runGamePython(runtime, [vendor.rpatool, '-x', archive, '-o', outDir], outDir, [], 180_000, signal)
  if (primary.code === 0) return
  throwIfUnRenCancelled(signal)
  const fallback = await runGamePython(runtime, [vendor.fallback, archive], outDir, [], 180_000, signal)
  if (fallback.code === 0) return
  throw new Error(outputText(fallback) || outputText(primary) || `exit ${primary.code}`)
}

async function decompileFile(
  runtime: GamePython,
  script: string,
  scriptDir: string,
  rpycPath: string,
  signal?: AbortSignal
): Promise<void> {
  const source = stripNamespace(rpycPath)
  const rpy = source.replace(/\.rpyc$/i, '.rpy')
  const attempts = [['--init-offset', source], ['--init-offset', '--try-harder', source]]
  const errors: string[] = []
  for (const args of attempts) {
    throwIfUnRenCancelled(signal)
    const result = await runGamePythonScript(runtime, script, args, [scriptDir], scriptDir, 90_000, signal)
    if (pathExists(rpy)) return
    const text = outputText(result)
    if (text) errors.push(text)
  }
  throw new Error(errors.join('\n') || `Could not decompile ${basename(source)}`)
}

async function runExtract(
  gameRoot: string,
  fileId: string,
  startedAt: number,
  signal: AbortSignal
): Promise<RenpyLastRun> {
  const gameDir = gameDirFromRoot(gameRoot)
  const before = await scanScripts(gameRoot)
  const archives = before.rpaFiles
  let log = `Python ${before.pythonPath || 'missing'}\nGame ${gameRoot}\n`
  const snapshot = await snapshotGameRels(gameDir)
  const snapshotStart = snapshot.size

  if (!archives.length) {
    const summary = before.unpacked
      ? `Already uncompressed. ${before.rpyCount + before.rpycCount} script files are on disk and there are no .rpa archives.`
      : 'No .rpa archives found, and there are no loose scripts either.'
    emit(fileId, 'extract', summary, { log: `${log}${summary}\n`, done: 0, total: 0, percent: 100 })
    return finish(fileId, {
      action: 'extract',
      startedAt,
      finishedAt: Date.now(),
      ok: before.unpacked,
      summary,
      log: log + summary,
      error: before.unpacked ? null : 'Nothing to extract.',
      done: 0,
      total: 0,
      skipped: 0,
      failed: 0
    })
  }

  log += before.unpacked
    ? `Already uncompressed (${before.rpyCount} rpy, ${before.rpycCount} rpyc). Extracting ${archives.length} archive(s) anyway.\n`
    : `Still compressed. Extracting ${archives.length} archive(s).\n`
  emit(fileId, 'extract', `Extracting 0/${archives.length}…`, { log, done: 0, total: archives.length, percent: 0 })

  const runtime = await detectGamePython(gameRoot, signal)
  const vendor = getUnrenVendor(runtime)
  log += `Using Python ${runtime.major} (${runtime.python})\n`
  emit(fileId, 'extract', `Using Python ${runtime.major}`, { log, done: 0, total: archives.length, percent: 0 })

  let done = 0
  let failed = 0
  let cancelled = false
  try {
    for (const archive of archives) {
      throwIfUnRenCancelled(signal)
      const label = basename(archive.path)
      emit(fileId, 'extract', `Extracting ${done + failed + 1}/${archives.length}: ${label}`, {
        log: `${log}Extracting ${label}…\n`,
        done: done + failed,
        total: archives.length,
        percent: Math.round(((done + failed) / archives.length) * 100)
      })
      try {
        await extractArchive(runtime, vendor, archive.path, gameDir, signal)
        done += 1
        log += `Unpacked ${label}\n`
      } catch (error) {
        if (isUnRenCancelled(error)) throw error
        failed += 1
        log += `Failed ${label}: ${error instanceof Error ? error.message : String(error)}\n`
      }
      await recordNewGameFiles(gameRoot, 'extract', snapshot)
      emit(fileId, 'extract', `Extracting ${done + failed}/${archives.length}`, {
        log,
        done: done + failed,
        total: archives.length,
        percent: Math.round(((done + failed) / archives.length) * 100)
      })
    }
  } catch (error) {
    if (!isUnRenCancelled(error)) throw error
    cancelled = true
    log += 'Stopped.\n'
  }

  await recordNewGameFiles(gameRoot, 'extract', snapshot)
  const written = snapshot.size - snapshotStart
  const after = await scanScripts(gameRoot)
  if (cancelled) {
    const summary = cancelledSummary('extract', done, archives.length, written)
    return finish(fileId, {
      action: 'extract',
      startedAt,
      finishedAt: Date.now(),
      ok: false,
      cancelled: true,
      summary,
      log: log + summary,
      error: null,
      done,
      total: archives.length,
      skipped: 0,
      failed
    })
  }

  const summary =
    failed && !done
      ? `Failed to extract ${failed} archive(s).`
      : `Extracted ${done} archive(s)${failed ? `, ${failed} failed` : ''}. ${after.rpyCount + after.rpycCount} script files on disk.`
  return finish(fileId, {
    action: 'extract',
    startedAt,
    finishedAt: Date.now(),
    ok: failed === 0 && (done > 0 || after.unpacked),
    summary,
    log,
    error: failed ? `Failed to extract ${failed} archive(s).` : null,
    done,
    total: archives.length,
    skipped: 0,
    failed
  })
}

async function runDecompile(
  gameRoot: string,
  fileId: string,
  startedAt: number,
  signal: AbortSignal
): Promise<RenpyLastRun> {
  const pending = await listRpycNeedingDecompile(gameRoot)
  const scripts = await scanScripts(gameRoot)
  let log = `Python ${scripts.pythonPath || 'missing'}\nGame ${gameRoot}\n`
  const snapshot = await snapshotGameRels(gameDirFromRoot(gameRoot))
  const snapshotStart = snapshot.size

  if (!pending.length) {
    const ok = scripts.alreadyDecompiled || (scripts.rpyCount > 0 && scripts.rpycWithoutRpy === 0)
    const summary = ok
      ? `Already decompiled. ${scripts.rpyCount} .rpy files on disk.`
      : scripts.packed && !scripts.unpacked
        ? 'No .rpyc files on disk. Extract the .rpa archives first.'
        : 'No compiled scripts found to decompile.'
    emit(fileId, 'decompile', summary, { log: `${log}${summary}\n`, done: 0, total: 0, percent: 100 })
    return finish(fileId, {
      action: 'decompile',
      startedAt,
      finishedAt: Date.now(),
      ok,
      summary,
      log: log + summary,
      error: ok ? null : summary,
      done: 0,
      total: 0,
      skipped: scripts.rpycCount,
      failed: 0
    })
  }

  log += `${pending.length} compiled script(s) need decompiling (${scripts.rpyCount} already have .rpy).\n`
  emit(fileId, 'decompile', `Decompiling 0/${pending.length}…`, { log, done: 0, total: pending.length, percent: 0 })

  const runtime = await detectGamePython(gameRoot, signal)
  const vendor = getUnrenVendor(runtime)
  log += `Using Python ${runtime.major} (${runtime.python})\n`
  emit(fileId, 'decompile', `Using Python ${runtime.major}`, { log, done: 0, total: pending.length, percent: 0 })

  const stage = stageUnrpycTree(gameRoot, vendor.unrpycDir)
  log += `unrpyc ${stage}\n`

  let done = 0
  let failed = 0
  let cancelled = false
  try {
    for (const rpyc of pending) {
      throwIfUnRenCancelled(signal)
      const label = basename(rpyc)
      emit(fileId, 'decompile', `Decompiling ${done + failed + 1}/${pending.length}: ${label}`, {
        log: `${log}Decompiling ${label}…\n`,
        done: done + failed,
        total: pending.length,
        percent: Math.round(((done + failed) / pending.length) * 100)
      })
      try {
        await decompileFile(runtime, join(stage, 'unrpyc.py'), stage, rpyc, signal)
        done += 1
        log += `Decompiled ${label}\n`
      } catch (error) {
        if (isUnRenCancelled(error)) throw error
        failed += 1
        log += `Failed ${label}: ${error instanceof Error ? error.message : String(error)}\n`
      }
      if ((done + failed) % 20 === 0) await recordNewGameFiles(gameRoot, 'decompile', snapshot)
      emit(fileId, 'decompile', `Decompiling ${done + failed}/${pending.length}`, {
        log,
        done: done + failed,
        total: pending.length,
        percent: Math.round(((done + failed) / pending.length) * 100)
      })
    }
  } catch (error) {
    if (!isUnRenCancelled(error)) throw error
    cancelled = true
    log += 'Stopped.\n'
  } finally {
    removeUnrpycStage(gameRoot)
  }

  await recordNewGameFiles(gameRoot, 'decompile', snapshot)
  const written = snapshot.size - snapshotStart
  const after = await scanScripts(gameRoot)
  if (cancelled) {
    const summary = cancelledSummary('decompile', done, pending.length, written)
    return finish(fileId, {
      action: 'decompile',
      startedAt,
      finishedAt: Date.now(),
      ok: false,
      cancelled: true,
      summary,
      log: log + summary,
      error: null,
      done,
      total: pending.length,
      skipped: Math.max(0, scripts.rpycCount - pending.length),
      failed
    })
  }

  const summary =
    failed && !done
      ? `Failed to decompile ${failed} script(s).`
      : `Decompiled ${done} script(s)${failed ? `, ${failed} failed` : ''}. ${after.rpyCount} .rpy files on disk.`
  return finish(fileId, {
    action: 'decompile',
    startedAt,
    finishedAt: Date.now(),
    ok: failed === 0,
    summary,
    log,
    error: failed ? `Failed to decompile ${failed} script(s).` : null,
    done,
    total: pending.length,
    skipped: Math.max(0, scripts.rpycCount - pending.length),
    failed
  })
}

async function runJob(
  gameRoot: string,
  action: 'extract' | 'decompile',
  fileId: string,
  signal: AbortSignal
): Promise<RenpyLastRun> {
  const startedAt = Date.now()
  emit(fileId, action, action === 'extract' ? 'Preparing extract…' : 'Preparing decompile…', {
    log: '',
    error: null,
    cancelling: false,
    done: 0,
    total: 0,
    percent: 0
  })
  try {
    return action === 'extract'
      ? await runExtract(stripNamespace(gameRoot), fileId, startedAt, signal)
      : await runDecompile(stripNamespace(gameRoot), fileId, startedAt, signal)
  } catch (error) {
    if (isUnRenCancelled(error)) {
      const summary = cancelledSummary(action, 0, 0, 0)
      const log = clipLog(`${liveByFile.get(fileId)?.log || ''}\n${summary}`)
      return finish(fileId, {
        action,
        startedAt,
        finishedAt: Date.now(),
        ok: false,
        cancelled: true,
        summary,
        log,
        error: null,
        done: 0,
        total: 0,
        skipped: 0,
        failed: 0
      })
    }
    const message = error instanceof Error ? error.message : 'Script tool failed.'
    return finish(fileId, {
      action,
      startedAt,
      finishedAt: Date.now(),
      ok: false,
      summary: message,
      log: clipLog(`${liveByFile.get(fileId)?.log || ''}\n${message}`),
      error: message,
      done: 0,
      total: 0,
      skipped: 0,
      failed: 1
    })
  }
}

export async function runUnRen(gameRoot: string, action: 'extract' | 'decompile', fileId: string): Promise<RenpyLastRun> {
  const root = stripNamespace(gameRoot)
  const pending = jobsByRoot.get(root)
  if (pending) await pending.promise.catch(() => undefined)
  const abort = new AbortController()
  const promise = runJob(root, action, fileId, abort.signal)
  const job: UnRenJob = { fileId, gameRoot: root, action, abort, promise }
  jobsByRoot.set(root, job)
  jobsByFile.set(fileId, job)
  try {
    return await promise
  } finally {
    if (jobsByRoot.get(root) === job) jobsByRoot.delete(root)
    if (jobsByFile.get(fileId) === job) jobsByFile.delete(fileId)
  }
}

export function requestUnRenCancel(fileId: string): boolean {
  const job = jobsByFile.get(fileId)
  if (!job || job.abort.signal.aborted) return false
  job.abort.abort()
  emit(fileId, job.action, 'Stopping…', { cancelling: true, running: true })
  return true
}

export async function retractUnRen(gameRoot: string, action: UnRenAction, fileId: string): Promise<RenpyLastRun> {
  const root = stripNamespace(gameRoot)
  if (jobsByRoot.has(root)) {
    throw new Error('Wait for the current unpack to finish, or stop it first.')
  }
  const startedAt = Date.now()
  const kind = action === 'decompile' ? 'decompile' : 'extract'
  const noun = kind === 'extract' ? 'extracted files' : 'decompiled scripts'
  emit(fileId, action, `Removing ${noun}…`, { log: '', error: null, cancelling: false, done: 0, total: 0, percent: 0 })
  try {
    const result = await retractTrackedFiles(root, kind)
    const leftover = await getTrackedCounts(root)
    const summary = result.removed
      ? `Removed ${result.removed} ${noun}.`
      : `No ${noun} were left to remove.`
    const extra =
      kind === 'extract' && leftover.decompile
        ? ` ${leftover.decompile} decompiled script(s) are still tracked.`
        : kind === 'decompile' && leftover.extract
          ? ` ${leftover.extract} extracted file(s) are still tracked.`
          : ''
    return finish(fileId, {
      action,
      startedAt,
      finishedAt: Date.now(),
      ok: true,
      summary: summary + extra,
      log: summary + extra,
      error: null,
      done: result.removed,
      total: result.removed,
      skipped: 0,
      failed: 0
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : `Could not remove ${noun}.`
    return finish(fileId, {
      action,
      startedAt,
      finishedAt: Date.now(),
      ok: false,
      summary: message,
      log: message,
      error: message,
      done: 0,
      total: 0,
      skipped: 0,
      failed: 1
    })
  }
}
