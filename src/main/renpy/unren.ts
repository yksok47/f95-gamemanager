import { writeFile } from 'fs/promises'
import { basename, join } from 'path'
import type { RenpyLastRun, RenpyStatus, UnRenAction, UnRenStatusAction } from '@shared/types'
import { mapLimit, yieldToEventLoop } from '../disk-usage'
import { pathExistsAsync, stripNamespace } from '../win-path'
import { sendToRenderer } from '../windows'
import { gameDirFromRoot, scanScripts, scanScriptsWithPending } from './scan'
import {
  detectGamePython,
  isUnRenCancelled,
  runGamePython,
  runGamePythonScript,
  throwIfUnRenCancelled,
  type GamePython
} from './runtime'
import {
  addTrackedFiles,
  discardSourceFiles,
  getTrackedCounts,
  recordNewGameFiles,
  retractTrackedFiles,
  setExtractMode,
  shouldTrackRel,
  snapshotGameRels,
  toPosixRel
} from './unren-files'
import {
  countDecompileStarts,
  decompileTimeoutMs,
  decompileWorkerCount,
  extractParallelism,
  extractTimeoutMs,
  partitionByWeight,
  rpyPathFromRpyc,
  type WeightedPath
} from './unren-work'
import { getUnrenVendor, removeUnrpycStage, stageUnrpycTree } from './vendor'

const MAX_LOG = 80_000
const YIELD_EVERY = 64

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
  action: UnRenStatusAction,
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
  const noun = action === 'decompile' ? 'script(s)' : 'archive(s)'
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
  threads: number,
  timeoutMs: number,
  scriptsOnly: boolean,
  signal?: AbortSignal
): Promise<void> {
  const archive = stripNamespace(archivePath)
  const outDir = stripNamespace(gameDir)
  const extraEnv = {
    F95_UNREN_WORKERS: String(threads),
    ...(scriptsOnly ? { F95_UNREN_SCRIPTS_ONLY: '1' } : {})
  }
  const args = [vendor.rpatool, '-x', archive, '-o', outDir]
  if (scriptsOnly) args.push('--scripts')
  const primary = await runGamePython(
    runtime,
    args,
    outDir,
    [],
    timeoutMs,
    signal,
    extraEnv
  )
  if (primary.code === 0) return
  throwIfUnRenCancelled(signal)
  const fallback = await runGamePython(runtime, [vendor.fallback, archive], outDir, [], timeoutMs, signal, extraEnv)
  if (fallback.code === 0) return
  throw new Error(outputText(fallback) || outputText(primary) || `exit ${primary.code}`)
}

async function filesMissingRpy(files: WeightedPath[]): Promise<WeightedPath[]> {
  const missing: WeightedPath[] = []
  let ops = 0
  for (const file of files) {
    ops += 1
    if (ops >= YIELD_EVERY) {
      ops = 0
      await yieldToEventLoop()
    }
    if (!(await pathExistsAsync(rpyPathFromRpyc(file.path)))) missing.push(file)
  }
  return missing
}

async function trackDecompiled(
  gameRoot: string,
  gameDir: string,
  snapshot: Set<string>,
  files: WeightedPath[]
): Promise<number> {
  const added: string[] = []
  let ops = 0
  for (const file of files) {
    ops += 1
    if (ops >= YIELD_EVERY) {
      ops = 0
      await yieldToEventLoop()
    }
    const rel = toPosixRel(gameDir, rpyPathFromRpyc(file.path))
    if (!rel || !shouldTrackRel(rel) || snapshot.has(rel)) continue
    snapshot.add(rel)
    added.push(rel)
  }
  if (added.length) await addTrackedFiles(gameRoot, 'decompile', added)
  return added.length
}

async function decompileBatch(
  runtime: GamePython,
  script: string,
  scriptDir: string,
  files: WeightedPath[],
  listPath: string,
  tryHarder: boolean,
  signal: AbortSignal,
  onOutput: (chunk: string) => void
): Promise<void> {
  if (!files.length) return
  await writeFile(listPath, `${files.map((file) => stripNamespace(file.path)).join('\n')}\n`, 'utf8')
  const args = tryHarder
    ? ['--init-offset', '--try-harder', '--file-list', stripNamespace(listPath)]
    : ['--init-offset', '--file-list', stripNamespace(listPath)]
  await runGamePythonScript(
    runtime,
    script,
    args,
    [scriptDir],
    scriptDir,
    decompileTimeoutMs(files.length),
    signal,
    undefined,
    onOutput
  )
}

async function runExtract(
  gameRoot: string,
  fileId: string,
  startedAt: number,
  signal: AbortSignal,
  scriptsOnly: boolean
): Promise<RenpyLastRun> {
  const extractAction = scriptsOnly ? 'extract' : 'extract-all'
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
    emit(fileId, extractAction, summary, { log: `${log}${summary}\n`, done: 0, total: 0, percent: 100 })
    return finish(fileId, {
      action: extractAction,
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

  log += scriptsOnly
    ? `Extracting scripts only from ${archives.length} archive(s). Images and audio stay packed.\n`
    : `Extracting every file from ${archives.length} archive(s). Loose assets make startup slower.\n`
  log += before.unpacked
    ? `Scripts already on disk (${before.rpyCount} rpy, ${before.rpycCount} rpyc).\n`
    : `Still compressed.\n`
  emit(fileId, extractAction, `Extracting 0/${archives.length}…`, { log, done: 0, total: archives.length, percent: 0 })

  const runtime = await detectGamePython(gameRoot, signal)
  const vendor = getUnrenVendor(runtime)
  const parallel = extractParallelism(archives.length)
  log += `Using Python ${runtime.major} (${runtime.python})\n`
  log += `Unpacking with ${parallel.archives} archive worker(s), ${parallel.threads} thread(s) each.\n`
  emit(fileId, extractAction, `Using Python ${runtime.major}`, { log, done: 0, total: archives.length, percent: 0 })

  let done = 0
  let failed = 0
  let doneBytes = 0
  const totalBytes = archives.reduce((sum, archive) => sum + Math.max(0, archive.size), 0)
  let cancelled = false
  const percentOf = (): number => {
    if (totalBytes > 0) return Math.round((doneBytes / totalBytes) * 100)
    return Math.round(((done + failed) / archives.length) * 100)
  }
  try {
    await mapLimit(archives, parallel.archives, async (archive) => {
      throwIfUnRenCancelled(signal)
      const label = basename(archive.path)
      emit(fileId, extractAction, `Extracting ${done + failed + 1}/${archives.length}: ${label}`, {
        log: `${log}Extracting ${label}…\n`,
        done: done + failed,
        total: archives.length,
        percent: percentOf()
      })
      try {
        await extractArchive(
          runtime,
          vendor,
          archive.path,
          gameDir,
          parallel.threads,
          extractTimeoutMs(archive.size),
          scriptsOnly,
          signal
        )
        done += 1
        log += `Unpacked ${label}\n`
      } catch (error) {
        if (isUnRenCancelled(error)) throw error
        failed += 1
        log += `Failed ${label}: ${error instanceof Error ? error.message : String(error)}\n`
      }
      doneBytes += Math.max(0, archive.size)
      emit(fileId, extractAction, `Extracting ${done + failed}/${archives.length}`, {
        log,
        done: done + failed,
        total: archives.length,
        percent: percentOf()
      })
    })
  } catch (error) {
    if (!isUnRenCancelled(error)) throw error
    cancelled = true
    log += 'Stopped.\n'
  }

  await recordNewGameFiles(gameRoot, 'extract', snapshot)
  if (!cancelled && done > 0) await setExtractMode(gameRoot, scriptsOnly ? 'scripts' : 'all')
  const written = snapshot.size - snapshotStart
  let scriptCount = 0
  for (const rel of snapshot) {
    if (/\.rpyc?$/i.test(rel)) scriptCount += 1
  }
  if (cancelled) {
    const summary = cancelledSummary(extractAction, done, archives.length, written)
    return finish(fileId, {
      action: extractAction,
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
      : scriptsOnly
        ? `Extracted scripts from ${done} archive(s)${failed ? `, ${failed} failed` : ''}. ${scriptCount} script files on disk. Assets remain in the archives.`
        : `Extracted ${done} archive(s)${failed ? `, ${failed} failed` : ''}. ${scriptCount} script files on disk.`
  return finish(fileId, {
    action: scriptsOnly ? 'extract' : 'extract-all',
    startedAt,
    finishedAt: Date.now(),
    ok: failed === 0 && (done > 0 || before.unpacked),
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
  const scanned = await scanScriptsWithPending(gameRoot)
  const scripts = scanned.status
  const pending = scanned.pendingRpyc
  let log = `Python ${scripts.pythonPath || 'missing'}\nGame ${gameRoot}\n`
  const gameDir = gameDirFromRoot(gameRoot)
  const snapshot = await snapshotGameRels(gameDir)
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
  const workers = decompileWorkerCount(pending.length)
  log += `Using Python ${runtime.major} (${runtime.python})\n`
  emit(fileId, 'decompile', `Using Python ${runtime.major}`, { log, done: 0, total: pending.length, percent: 0 })

  const stage = stageUnrpycTree(gameRoot, vendor.unrpycDir)
  const script = join(stage, 'unrpyc.py')
  log += `unrpyc ${stage}\nDecompiling with ${workers} Python worker(s).\n`
  emit(fileId, 'decompile', `Decompiling 0/${pending.length}…`, { log, done: 0, total: pending.length, percent: 0 })

  let processed = 0
  let lastEmit = 0
  let lastLabel = ''
  let cancelled = false

  const emitProgress = (force = false): void => {
    const now = Date.now()
    if (!force && now - lastEmit < 80) return
    lastEmit = now
    const seen = Math.min(processed, pending.length)
    emit(fileId, 'decompile', `Decompiling ${seen}/${pending.length}${lastLabel ? `: ${lastLabel}` : ''}`, {
      log,
      done: seen,
      total: pending.length,
      percent: Math.round((seen / pending.length) * 100)
    })
  }

  const onOutput = (chunk: string): void => {
    const started = countDecompileStarts(chunk)
    if (!started.count) return
    processed += started.count
    if (started.lastLabel) lastLabel = started.lastLabel
    emitProgress()
  }

  const runPass = async (files: WeightedPath[], tryHarder: boolean, prefix: string): Promise<void> => {
    if (!files.length) return
    const chunks = partitionByWeight(files, workers, (file) => file.size)
    await mapLimit(chunks, chunks.length, async (chunk, index) => {
      throwIfUnRenCancelled(signal)
      await decompileBatch(
        runtime,
        script,
        stage,
        chunk,
        join(stage, `${prefix}-${index}.txt`),
        tryHarder,
        signal,
        onOutput
      )
    })
  }

  try {
    await runPass(pending, false, 'batch')
    const leftover = await filesMissingRpy(pending)
    if (leftover.length) {
      log += `${leftover.length} script(s) need a slower retry.\n`
      emitProgress(true)
      await runPass(leftover, true, 'hard')
    }
  } catch (error) {
    if (!isUnRenCancelled(error)) throw error
    cancelled = true
    log += 'Stopped.\n'
  } finally {
    await removeUnrpycStage(gameRoot)
  }

  const missing = await filesMissingRpy(pending)
  const missingPaths = new Set(missing.map((file) => file.path))
  const succeeded = pending.filter((file) => !missingPaths.has(file.path))
  const done = succeeded.length
  const failed = cancelled ? 0 : missing.length
  if (!cancelled && missing.length) {
    log += `${missing.map((file) => `Failed ${basename(file.path)}`).join('\n')}\n`
  }
  await trackDecompiled(gameRoot, gameDir, snapshot, succeeded)
  const written = snapshot.size - snapshotStart
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
      : `Decompiled ${done} script(s)${failed ? `, ${failed} failed` : ''}. ${scripts.rpyCount + done} .rpy files on disk.`
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
  action: UnRenAction,
  fileId: string,
  signal: AbortSignal
): Promise<RenpyLastRun> {
  const startedAt = Date.now()
  emit(fileId, action, action === 'decompile' ? 'Preparing decompile…' : 'Preparing extract…', {
    log: '',
    error: null,
    cancelling: false,
    done: 0,
    total: 0,
    percent: 0
  })
  try {
    return action === 'decompile'
      ? await runDecompile(stripNamespace(gameRoot), fileId, startedAt, signal)
      : await runExtract(stripNamespace(gameRoot), fileId, startedAt, signal, action !== 'extract-all')
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

export async function runUnRen(gameRoot: string, action: UnRenAction, fileId: string): Promise<RenpyLastRun> {
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

export async function discardUnRen(gameRoot: string, action: UnRenAction, fileId: string): Promise<RenpyLastRun> {
  const root = stripNamespace(gameRoot)
  if (jobsByRoot.has(root)) {
    throw new Error('Wait for the current unpack to finish, or stop it first.')
  }
  const startedAt = Date.now()
  const kind = action === 'decompile' ? 'decompile' : 'extract'
  const statusAction: UnRenStatusAction = kind === 'extract' ? 'delete-archives' : 'delete-compiled'
  const noun = kind === 'extract' ? 'archives' : 'compiled scripts'
  emit(fileId, statusAction, `Deleting ${noun}…`, {
    log: '',
    error: null,
    cancelling: false,
    done: 0,
    total: 0,
    percent: 0
  })
  try {
    const result = await discardSourceFiles(root, kind)
    const leftover = await getTrackedCounts(root)
    const summary = result.removed
      ? `Deleted ${result.removed} ${noun}.`
      : `No ${noun} were left to delete.`
    const extra =
      kind === 'extract' && leftover.extract
        ? ` Extracted files can no longer be removed.`
        : kind === 'decompile' && leftover.decompile
          ? ` Decompiled scripts can no longer be removed.`
          : ''
    return finish(fileId, {
      action: statusAction,
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
    const message = error instanceof Error ? error.message : `Could not delete ${noun}.`
    return finish(fileId, {
      action: statusAction,
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
