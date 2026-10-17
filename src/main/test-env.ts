import { app } from 'electron'
import { is } from '@electron-toolkit/utils'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { TestEnvInfo, TestEnvStatus } from '@shared/types'
import { persistSessionNow } from './session-store'

type TestEnvState = {
  active: string | null
  pendingDelete: string[]
}

const ID_PATTERN = /^env-\d{8}-\d{6}(-\d+)?$/

let mainUserData = ''
let activeId: string | null = null
let switching = false

function stateFile(): string {
  return join(mainUserData, 'test-env.json')
}

function envsDir(): string {
  return join(mainUserData, 'test-envs')
}

function envDir(id: string): string {
  return join(envsDir(), id)
}

function readState(): TestEnvState {
  try {
    const parsed = JSON.parse(readFileSync(stateFile(), 'utf8')) as Partial<TestEnvState>
    return {
      active: typeof parsed.active === 'string' && ID_PATTERN.test(parsed.active) ? parsed.active : null,
      pendingDelete: Array.isArray(parsed.pendingDelete)
        ? parsed.pendingDelete.filter((id): id is string => typeof id === 'string' && ID_PATTERN.test(id))
        : []
    }
  } catch {
    return { active: null, pendingDelete: [] }
  }
}

function writeState(state: TestEnvState): void {
  mkdirSync(mainUserData, { recursive: true })
  writeFileSync(stateFile(), JSON.stringify(state, null, 2), 'utf8')
}

function removeEnvDir(id: string): boolean {
  try {
    rmSync(envDir(id), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
    return true
  } catch (error) {
    console.warn(`[test-env] could not delete ${id}`, error)
    return false
  }
}

function nextEnvId(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  const base = `env-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  let id = base
  for (let n = 2; existsSync(envDir(id)); n++) id = `${base}-${n}`
  return id
}

function requireEnv(id: string): void {
  if (!ID_PATTERN.test(id) || !existsSync(envDir(id))) throw new Error(`Test env ${id} does not exist.`)
}

export function testEnvsAvailable(): boolean {
  return !app.isPackaged
}

function restartsItself(): boolean {
  return !(is.dev && process.env['ELECTRON_RENDERER_URL'])
}

export function applyTestEnvBeforeReady(): void {
  if (!testEnvsAvailable()) return
  mainUserData = app.getPath('userData')
  const state = readState()
  const pendingDelete = state.pendingDelete.filter((id) => id !== state.active && !removeEnvDir(id))
  activeId = state.active && existsSync(envDir(state.active)) ? state.active : null
  if (activeId) {
    app.setPath('userData', envDir(activeId))
    console.info(`[test-env] using ${envDir(activeId)}`)
  }
  if (activeId !== state.active || pendingDelete.length !== state.pendingDelete.length) {
    writeState({ active: activeId, pendingDelete })
  }
}

export function getTestEnvStatus(): TestEnvStatus {
  if (!testEnvsAvailable()) return { available: false, active: null, restartsItself: false, envs: [] }
  const pending = new Set(readState().pendingDelete)
  let envs: TestEnvInfo[] = []
  try {
    envs = readdirSync(envsDir(), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && ID_PATTERN.test(entry.name) && !pending.has(entry.name))
      .map((entry) => ({ id: entry.name, createdAt: statSync(envDir(entry.name)).birthtimeMs }))
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch {
    envs = []
  }
  return { available: true, active: activeId, restartsItself: restartsItself(), envs }
}

async function restartInto(state: TestEnvState): Promise<void> {
  if (switching) throw new Error('Already switching environments.')
  switching = true
  writeState(state)
  setTimeout(() => {
    if (restartsItself()) app.relaunch()
    app.quit()
  }, 150)
}

function assertAvailable(): void {
  if (!testEnvsAvailable()) throw new Error('Test envs are only available in debug builds.')
}

export async function createTestEnv(): Promise<string> {
  assertAvailable()
  await persistSessionNow().catch((error) => console.warn('[test-env] could not persist session', error))
  const id = nextEnvId()
  const dir = envDir(id)
  mkdirSync(dir, { recursive: true })
  const sessionFile = join(app.getPath('userData'), 'session.json')
  if (existsSync(sessionFile)) copyFileSync(sessionFile, join(dir, 'session.json'))
  await restartInto({ ...readState(), active: id })
  return id
}

export async function switchTestEnv(id: string | null): Promise<void> {
  assertAvailable()
  if (id) requireEnv(id)
  if (id === activeId) return
  await restartInto({ ...readState(), active: id })
}

export async function deleteTestEnv(id: string): Promise<void> {
  assertAvailable()
  requireEnv(id)
  const state = readState()
  if (id === activeId) {
    await restartInto({ active: null, pendingDelete: [...new Set([...state.pendingDelete, id])] })
    return
  }
  if (!removeEnvDir(id)) throw new Error(`Could not delete test env ${id}.`)
}
