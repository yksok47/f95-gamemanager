import type { PlaySessionStatus } from '@shared/types'
import { killProcessesUnder, killProcessTree, pidAlive, processesUnder } from './processes'
import { addSubscriptionPlaytime } from './subscriptions-store'
import { sendToRenderer } from './windows'

type PlaySession = {
  fileId: string
  threadId: number
  pid: number
  installPath: string
  backupSaves: boolean
  startedAt: number
  flushedAt: number
  lastSeenAt: number
  missingSince: number | null
}

const sessions = new Map<string, PlaySession>()
const FLUSH_EVERY_MS = 30_000
const GONE_GRACE_MS = 5_000
const POLL_MS = 2_000

let timer: ReturnType<typeof setInterval> | null = null

function now(): number {
  return Date.now()
}

function present(session: PlaySession): PlaySessionStatus {
  return {
    fileId: session.fileId,
    threadId: session.threadId,
    pid: session.pid,
    startedAt: session.startedAt,
    elapsedMs: Math.max(0, now() - session.startedAt)
  }
}

function broadcast(): void {
  sendToRenderer('play:sessions', [...sessions.values()].map(present))
}

async function addPlaytime(fileId: string, threadId: number, deltaMs: number): Promise<void> {
  if (deltaMs < 1000) return
  const { addFilePlaytime } = await import('./game-files-store')
  await addFilePlaytime(fileId, deltaMs)
  await addSubscriptionPlaytime(threadId, deltaMs)
}

async function backupRpgMakerSaves(session: PlaySession, skipUnstable = false): Promise<void> {
  if (!session.backupSaves) return
  try {
    const { syncRpgMakerSaves } = await import('./rpgmaker/saves')
    await syncRpgMakerSaves({
      installPath: session.installPath,
      threadId: session.threadId,
      mode: 'backup',
      skipUnstable
    })
  } catch (error) {
    console.warn('Could not backup RPG Maker saves', error)
  }
}

async function flushSession(session: PlaySession, until = now()): Promise<void> {
  const delta = until - session.flushedAt
  session.flushedAt = until
  await addPlaytime(session.fileId, session.threadId, delta)
  await backupRpgMakerSaves(session, true)
}

async function endSession(fileId: string): Promise<void> {
  const session = sessions.get(fileId)
  if (!session) return
  sessions.delete(fileId)
  await flushSession(session)
  await backupRpgMakerSaves(session, false)
  broadcast()
}

async function adoptInstallProcess(session: PlaySession): Promise<boolean> {
  const found = await processesUnder(session.installPath)
  if (!found.length) return false
  const current = found.find((item) => item.pid === session.pid) ?? found[0]
  session.pid = current.pid
  session.lastSeenAt = now()
  session.missingSince = null
  return true
}

async function poll(): Promise<void> {
  const stamp = now()
  for (const session of [...sessions.values()]) {
    if (pidAlive(session.pid)) {
      session.lastSeenAt = stamp
      session.missingSince = null
    } else {
      const adopted = await adoptInstallProcess(session)
      if (!adopted) {
        session.missingSince ??= stamp
        if (stamp - session.missingSince >= GONE_GRACE_MS) {
          await endSession(session.fileId)
          continue
        }
      }
    }
    if (stamp - session.flushedAt >= FLUSH_EVERY_MS) {
      await flushSession(session, stamp)
    }
  }
  if (sessions.size) broadcast()
}

function ensureTimer(): void {
  if (timer) return
  timer = setInterval(() => {
    void poll().catch((error) => console.warn('Play session poll failed', error))
  }, POLL_MS)
  timer.unref()
}

export function listPlaySessions(): PlaySessionStatus[] {
  return [...sessions.values()].map(present)
}

export function getPlaySession(fileId: string): PlaySessionStatus | null {
  const session = sessions.get(fileId)
  return session ? present(session) : null
}

export function startPlaySession(input: {
  fileId: string
  threadId: number
  pid: number
  installPath: string
  backupSaves?: boolean
}): void {
  const existing = sessions.get(input.fileId)
  const startedAt = existing?.startedAt ?? now()
  const flushedAt = existing?.flushedAt ?? startedAt
  sessions.set(input.fileId, {
    fileId: input.fileId,
    threadId: input.threadId,
    pid: input.pid,
    installPath: input.installPath,
    backupSaves: Boolean(input.backupSaves || existing?.backupSaves),
    startedAt,
    flushedAt,
    lastSeenAt: now(),
    missingSince: null
  })
  ensureTimer()
  broadcast()
}

export async function stopPlaySession(fileId: string): Promise<void> {
  const session = sessions.get(fileId)
  if (!session) return
  await killProcessTree(session.pid)
  await killProcessesUnder(session.installPath)
  await endSession(fileId)
}

export async function flushPlaySessions(): Promise<void> {
  for (const session of sessions.values()) {
    await flushSession(session)
    await backupRpgMakerSaves(session, false)
  }
}
