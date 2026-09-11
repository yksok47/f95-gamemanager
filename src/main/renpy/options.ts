import { readFileSync, statSync } from 'fs'
import { mkdir, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { inflateSync } from 'zlib'
import type { RenpyToolId } from '@shared/types'
import { childPath, listDirents, pathExists, toFsPath } from '../win-path'
import { isLegacyUnrenToolScript, MANAGED_OPTIONS_FILE, removeLegacyUnrenTools } from './tools'

const SKIP_DIRS = new Set(['lib', 'renpy', 'cache', '__pycache__', 'tmp', 'temp', 'decompiler', '.f95-unren', '.f95-unren-old'])

export const EMPTY_OPTIONS: Record<RenpyToolId, boolean> = {
  console: false,
  quick: true,
  skip: false,
  rollback: true,
  transitions: false,
  'after-choices': false
}

const OPTION_IDS: RenpyToolId[] = ['console', 'quick', 'skip', 'rollback', 'transitions', 'after-choices']

type OptionValues = Record<RenpyToolId, boolean>

function managedPath(gameDir: string): string {
  return join(gameDir, MANAGED_OPTIONS_FILE)
}

function readText(filePath: string): string {
  try {
    return readFileSync(toFsPath(filePath), 'utf8')
  } catch {
    return ''
  }
}

function listRpyFiles(gameDir: string): string[] {
  const files: string[] = []

  function walk(dir: string, depth: number): void {
    if (depth > 8) return
    for (const entry of listDirents(dir)) {
      const full = childPath(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name.toLowerCase())) continue
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.rpy')) continue
      if (isLegacyUnrenToolScript(entry.name)) continue
      files.push(full)
    }
  }

  if (pathExists(gameDir)) walk(gameDir, 0)
  return files.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

function lastMatch(source: string, pattern: RegExp): string | null {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  const re = new RegExp(pattern.source, flags)
  let last: string | null = null
  let match: RegExpExecArray | null
  while ((match = re.exec(source))) last = match[1] ?? match[0]
  return last
}

function parseBool(value: string | null): boolean | null {
  if (!value) return null
  const text = value.trim()
  if (/^true$/i.test(text)) return true
  if (/^false$/i.test(text)) return false
  if (/^['"]auto['"]$/i.test(text)) return false
  return null
}

function parseTransitions(value: string | null): boolean | null {
  if (!value) return null
  const bool = parseBool(value)
  if (bool != null) return !bool
  const number = Number(value.trim())
  if (!Number.isFinite(number)) return null
  return number === 0
}

function parseQuick(source: string): boolean | null {
  const events: Array<{ index: number; on: boolean }> = []
  const keymap = /keymap\s*\[\s*['"]quick_?(?:save|load)['"]\s*\]\s*=\s*(\[[^\]]*\]|None|Quick(?:Save|Load)\s*\([^)]*\))/gi
  let match: RegExpExecArray | null
  while ((match = keymap.exec(source))) {
    const raw = match[1].trim()
    const on = !/^None$/i.test(raw) && !/^\[\s*\]$/.test(raw)
    events.push({ index: match.index, on })
  }
  const enable = /\bQuick(?:Save|Load)\s*\(/g
  while ((match = enable.exec(source))) events.push({ index: match.index, on: true })
  if (!events.length) return null
  events.sort((a, b) => a.index - b.index)
  return events[events.length - 1].on
}

function parseSource(source: string): Partial<OptionValues> {
  const next: Partial<OptionValues> = {}
  const developer = parseBool(
    lastMatch(source, /(?:renpy\.)?config\.developer\s*=\s*(True|False|true|false|['"]auto['"])/)
  )
  const console = parseBool(
    lastMatch(source, /(?:renpy\.)?config\.console\s*=\s*(True|False|true|false)/)
  )
  if (developer != null || console != null) next.console = Boolean(developer || console)

  const skip = parseBool(
    lastMatch(
      source,
      /(?:(?:renpy\.game\.)?(?:_preferences|preferences)\.skip_unseen\s*=\s*|_f95gm_pref\(\s*['"]skip_unseen['"]\s*,\s*)(True|False|true|false)/
    )
  )
  if (skip != null) next.skip = skip

  const rollback = parseBool(
    lastMatch(source, /(?:renpy\.)?config\.rollback_enabled\s*=\s*(True|False|true|false)/)
  )
  if (rollback != null) next.rollback = rollback

  const transitions = parseTransitions(
    lastMatch(
      source,
      /(?:(?:_preferences|preferences)\.transitions\s*=\s*|_f95gm_pref\(\s*['"]transitions['"]\s*,\s*)(True|False|true|false|-?\d+)/
    )
  )
  if (transitions != null) next.transitions = transitions

  const afterChoices = parseBool(
    lastMatch(
      source,
      /(?:(?:renpy\.game\.)?(?:_preferences|preferences)\.skip_after_choices\s*=\s*|_f95gm_pref\(\s*['"]skip_after_choices['"]\s*,\s*)(True|False|true|false)/
    )
  )
  if (afterChoices != null) next['after-choices'] = afterChoices

  const quick = parseQuick(source)
  if (quick != null) next.quick = quick
  return next
}

function parseManaged(source: string): Partial<OptionValues> {
  if (!source.trim()) return {}
  return parseSource(source)
}

function pyBool(value: boolean): string {
  return value ? 'True' : 'False'
}

function configBlock(id: RenpyToolId, enabled: boolean): string | null {
  if (id === 'console') {
    return `    config.developer = ${pyBool(enabled)}
    config.console = ${pyBool(enabled)}`
  }
  if (id === 'skip') {
    return `    renpy.config.allow_skipping = True
    renpy.config.fast_skipping = ${pyBool(enabled)}`
  }
  if (id === 'rollback') {
    if (!enabled) return `    renpy.config.rollback_enabled = False`
    return `    renpy.config.rollback_enabled = True
    renpy.config.hard_rollback_limit = 256
    renpy.config.rollback_length = 256
    def _f95gm_noblock(*args, **kwargs):
        return
    renpy.block_rollback = _f95gm_noblock
    try:
        config.keymap['rollback'] = [ 'K_PAGEUP', 'repeat_K_PAGEUP', 'K_AC_BACK', 'mousedown_4' ]
    except:
        pass`
  }
  if (id === 'quick') {
    if (enabled) {
      return `    try:
        config.underlay[0].keymap['quickSave'] = QuickSave()
        config.keymap['quickSave'] = 'K_F5'
        config.underlay[0].keymap['quickLoad'] = QuickLoad()
        config.keymap['quickLoad'] = 'K_F9'
        config.keymap['quick_save'] = [ 'K_F5' ]
        config.keymap['quick_load'] = [ 'K_F9' ]
    except:
        pass`
    }
    return `    try:
        config.keymap['quickSave'] = []
        config.keymap['quickLoad'] = []
        config.keymap['quick_save'] = []
        config.keymap['quick_load'] = []
    except:
        pass`
  }
  return null
}

function preferenceLines(id: RenpyToolId, enabled: boolean): string[] {
  if (id === 'skip') return [`        _f95gm_pref('skip_unseen', ${pyBool(enabled)})`]
  if (id === 'transitions') return [`        _f95gm_pref('transitions', ${enabled ? 0 : 2})`]
  if (id === 'after-choices') return [`        _f95gm_pref('skip_after_choices', ${pyBool(enabled)})`]
  return []
}

function buildManagedFile(overrides: Partial<OptionValues>): string {
  const ids = OPTION_IDS.filter((id) => overrides[id] != null)
  if (!ids.length) return ''
  const config = ids
    .map((id) => configBlock(id, Boolean(overrides[id])))
    .filter((block): block is string => Boolean(block))
  const prefs = ids.flatMap((id) => preferenceLines(id, Boolean(overrides[id])))
  const parts = [...config]
  if (prefs.length) {
    parts.push(`    def _f95gm_pref(name, value):
        objs = []
        try:
            objs.append(_preferences)
        except:
            pass
        try:
            objs.append(renpy.game.preferences)
        except:
            pass
        try:
            objs.append(store._preferences)
        except:
            pass
        for obj in objs:
            try:
                setattr(obj, name, value)
            except:
                pass
    def _f95gm_apply_prefs(*args, **kwargs):
${prefs.join('\n')}
    _f95gm_apply_prefs()
    config.start_callbacks.append(_f95gm_apply_prefs)
    try:
        config.after_load_callbacks.append(_f95gm_apply_prefs)
    except:
        pass`)
  }
  return `# F95 Game Manager runtime options. Safe to delete.\ninit 999 python:\n${parts.join('\n')}\n`
}

function fileMtime(filePath: string): number {
  try {
    return statSync(toFsPath(filePath)).mtimeMs
  } catch {
    return 0
  }
}

function skipPickleMemo(data: Buffer, index: number): number {
  let i = index
  while (i < data.length) {
    if (data[i] === 0x94) {
      i += 1
      continue
    }
    if (data[i] === 0x71 && i + 1 < data.length) {
      i += 2
      continue
    }
    if (data[i] === 0x72 && i + 4 < data.length) {
      i += 5
      continue
    }
    break
  }
  return i
}

function valueOffsetAfterKey(data: Buffer, keyAt: number, keyLen: number): number | null {
  if (keyAt >= 2 && (data[keyAt - 2] === 0x8c || data[keyAt - 2] === 0x55) && data[keyAt - 1] === keyLen) {
    return skipPickleMemo(data, keyAt + keyLen)
  }
  if (
    keyAt >= 5 &&
    (data[keyAt - 5] === 0x58 || data[keyAt - 5] === 0x54) &&
    data.readUInt32LE(keyAt - 4) === keyLen
  ) {
    return skipPickleMemo(data, keyAt + keyLen)
  }
  if (keyAt >= 2 && data[keyAt - 2] === 0x53 && (data[keyAt - 1] === 0x27 || data[keyAt - 1] === 0x22)) {
    let i = keyAt + keyLen
    if (i < data.length && (data[i] === 0x27 || data[i] === 0x22)) i += 1
    if (i < data.length && data[i] === 0x0a) i += 1
    if (i < data.length && data[i] === 0x70) {
      const nl = data.indexOf(0x0a, i)
      if (nl >= 0) i = nl + 1
    }
    return i
  }
  if (keyAt >= 1 && data[keyAt - 1] === 0x56) {
    let i = keyAt + keyLen
    if (i < data.length && data[i] === 0x0a) i += 1
    if (i < data.length && data[i] === 0x70) {
      const nl = data.indexOf(0x0a, i)
      if (nl >= 0) i = nl + 1
    }
    return i
  }
  return null
}

function parsePickleScalar(data: Buffer, index: number): { bool?: boolean; int?: number } | null {
  if (index >= data.length) return null
  const op = data[index]
  if (op === 0x88) return { bool: true, int: 1 }
  if (op === 0x89) return { bool: false, int: 0 }
  if (op === 0x4b && index + 1 < data.length) {
    const value = data[index + 1]
    return { int: value, bool: value !== 0 }
  }
  if (op === 0x49) {
    const end = data.indexOf(0x0a, index + 1)
    if (end < 0) return null
    const text = data.subarray(index + 1, end).toString('ascii').trim()
    if (text === '01' || text === '1') return { bool: true, int: 1 }
    if (text === '00' || text === '0') return { bool: false, int: 0 }
    const value = Number(text)
    if (!Number.isFinite(value)) return null
    return { int: value, bool: value !== 0 }
  }
  return null
}

function lastKeyedScalar(data: Buffer, key: string): { bool?: boolean; int?: number } | null {
  const needle = Buffer.from(key, 'utf8')
  let from = 0
  let last: { bool?: boolean; int?: number } | null = null
  while (from <= data.length - needle.length) {
    const at = data.indexOf(needle, from)
    if (at < 0) break
    const valueAt = valueOffsetAfterKey(data, at, needle.length)
    if (valueAt != null) {
      const parsed = parsePickleScalar(data, valueAt)
      if (parsed) last = parsed
    } else if (at > 0 && data[at - 1] === 0x22 && data[at + needle.length] === 0x22) {
      const slice = data.subarray(at + needle.length + 1, at + needle.length + 48).toString('latin1')
      const match = slice.match(/^\s*:\s*(true|false|-?\d+)/i)
      if (match) {
        if (/^true$/i.test(match[1])) last = { bool: true, int: 1 }
        else if (/^false$/i.test(match[1])) last = { bool: false, int: 0 }
        else {
          const value = Number(match[1])
          if (Number.isFinite(value)) last = { int: value, bool: value !== 0 }
        }
      }
    }
    from = at + 1
  }
  return last
}

function inflatePayloads(data: Buffer): Buffer[] {
  const payloads = [data]
  const tryInflate = (bytes: Buffer): void => {
    try {
      payloads.push(inflateSync(bytes))
    } catch {
      // Not zlib-compressed.
    }
  }
  tryInflate(data)
  if (data.length > 16) {
    tryInflate(data.subarray(16))
    tryInflate(data.subarray(0, data.length - 16))
  }
  return payloads
}

function parseSavedPreferences(data: Buffer): Partial<OptionValues> {
  const next: Partial<OptionValues> = {}
  for (const payload of inflatePayloads(data)) {
    const skip = lastKeyedScalar(payload, 'skip_unseen')
    if (skip?.bool != null) next.skip = skip.bool
    const after = lastKeyedScalar(payload, 'skip_after_choices')
    if (after?.bool != null) next['after-choices'] = after.bool
    const transitions = lastKeyedScalar(payload, 'transitions')
    if (transitions?.int != null && transitions.int >= 0 && transitions.int <= 2) {
      next.transitions = transitions.int === 0
    }
  }
  return next
}

function savedPreferenceFiles(gameDir: string, savePath?: string | null): Array<{ path: string; mtime: number }> {
  const files: Array<{ path: string; mtime: number }> = []
  const seen = new Set<string>()
  const dirs = [savePath, join(gameDir, 'saves')].filter((dir): dir is string => Boolean(dir))
  for (const dir of dirs) {
    if (!pathExists(dir)) continue
    for (const entry of listDirents(dir)) {
      if (!entry.isFile()) continue
      const lower = entry.name.toLowerCase()
      if (!lower.startsWith('persistent')) continue
      const full = childPath(dir, entry.name)
      const key = full.replace(/\\/g, '/').toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      const mtime = fileMtime(full)
      if (mtime) files.push({ path: full, mtime })
    }
  }
  return files.sort((a, b) => a.mtime - b.mtime)
}

function readSavedPreferences(
  gameDir: string,
  savePath?: string | null
): { mtime: number; values: Partial<OptionValues> } | null {
  let best: { mtime: number; values: Partial<OptionValues> } | null = null
  for (const file of savedPreferenceFiles(gameDir, savePath)) {
    try {
      const values = parseSavedPreferences(readFileSync(toFsPath(file.path)))
      if (!Object.keys(values).length) continue
      best = { mtime: file.mtime, values }
    } catch {
      // Skip unreadable persistent files.
    }
  }
  return best
}

function readOverrides(gameDir: string): {
  game: Partial<OptionValues>
  managed: Partial<OptionValues>
  managedMtime: number
} {
  const managedFile = managedPath(gameDir)
  let managedSource = ''
  const gameParts: string[] = []
  for (const file of listRpyFiles(gameDir)) {
    const source = readText(file)
    if (!source) continue
    if (file.replace(/\\/g, '/').toLowerCase().endsWith(`/${MANAGED_OPTIONS_FILE}`)) {
      managedSource = source
      continue
    }
    gameParts.push(source)
  }
  if (!managedSource && pathExists(managedFile)) managedSource = readText(managedFile)
  return {
    game: parseSource(gameParts.join('\n')),
    managed: parseManaged(managedSource),
    managedMtime: managedSource ? fileMtime(managedFile) : 0
  }
}

export function readRenpyOptions(gameDir: string, savePath?: string | null): OptionValues {
  const { game, managed, managedMtime } = readOverrides(gameDir)
  const persistent = readSavedPreferences(gameDir, savePath)
  const layers = [
    { mtime: 0, values: game },
    ...(persistent ? [persistent] : []),
    ...(managedMtime || Object.keys(managed).length ? [{ mtime: managedMtime, values: managed }] : [])
  ]
  layers.sort((a, b) => a.mtime - b.mtime)
  return layers.reduce((acc, layer) => ({ ...acc, ...layer.values }), { ...EMPTY_OPTIONS })
}

export async function setRenpyOptions(
  gameDir: string,
  updates: Partial<OptionValues>,
  savePath?: string | null
): Promise<OptionValues> {
  await mkdir(gameDir, { recursive: true })
  await removeLegacyUnrenTools(gameDir)
  const { managed } = readOverrides(gameDir)
  const next: Partial<OptionValues> = { ...managed }
  for (const [key, value] of Object.entries(updates) as Array<[RenpyToolId, boolean | undefined]>) {
    if (value == null) continue
    next[key] = value
  }
  const file = managedPath(gameDir)
  const source = buildManagedFile(next)
  if (!source) {
    if (pathExists(file)) await unlink(file)
  } else {
    await writeFile(toFsPath(file), source, 'utf8')
  }
  return { ...readRenpyOptions(gameDir, savePath), ...next }
}

export async function setRenpyOption(gameDir: string, id: RenpyToolId, enabled: boolean): Promise<OptionValues> {
  return setRenpyOptions(gameDir, { [id]: enabled })
}

export async function setAllRenpyOptions(gameDir: string, enabled: boolean): Promise<OptionValues> {
  const updates = Object.fromEntries(OPTION_IDS.map((id) => [id, enabled])) as OptionValues
  return setRenpyOptions(gameDir, updates)
}

