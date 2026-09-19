import { basename, dirname, extname } from 'path'
import { cleanThreadTitle } from './f95/parse'
import { scoreSaveFolder } from './renpy/save-folder-match'
import {
  CONTENT_KIND_IDS,
  OS_KIND_IDS,
  type ContentKind,
  type OsKind,
  type PackageTagHint
} from '@shared/types'

const OS_ALIASES: Record<string, OsKind> = {
  win: 'win',
  win32: 'win',
  win64: 'win',
  windows: 'win',
  pc: 'win',
  linux: 'linux',
  mac: 'mac',
  macos: 'mac',
  osx: 'mac',
  darwin: 'mac',
  android: 'android',
  apk: 'android',
  ios: 'ios',
  web: 'web',
  html: 'html',
  html5: 'html',
  joiplay: 'joiplay'
}

const KIND_ALIASES: Record<string, ContentKind> = {
  game: 'game',
  update: 'update',
  hotfix: 'update',
  patch: 'patch',
  patches: 'patch',
  fix: 'patch',
  bugfix: 'patch',
  uncensor: 'uncensor',
  uncensored: 'uncensor',
  unc: 'uncensor',
  mod: 'mod',
  mods: 'mod',
  translation: 'translation',
  translations: 'translation',
  tl: 'translation',
  walkthrough: 'walkthrough',
  guide: 'walkthrough',
  cheat: 'cheat',
  cheats: 'cheat',
  trainer: 'cheat',
  crack: 'crack',
  cracked: 'crack',
  save: 'save',
  saves: 'save',
  dlc: 'dlc',
  extra: 'extra',
  extras: 'extra'
}

const DROP_TOKENS = new Set([
  'f95',
  'f95zone',
  'only',
  'and',
  '32bit',
  '64bit',
  'x86',
  'x64',
  'hq',
  'lq',
  'hd',
  'sd'
])

const VERSION_TOKEN = /^(?:v)?(\d+\.\d+(?:\.\d+){0,3}[a-z]?\d*)$/i
const VERSION_IN_NAME = /(?:^|[-_. ])v?(\d+\.\d+(?:\.\d+){0,3}[a-z]?\d*)(?=[-_. ]|$)/i

export type ParsedImportName = {
  title: string
  version: string
  os: number[]
  contentKind: number
}

function tokenize(raw: string): string[] {
  return raw
    .split(/[^a-zA-Z0-9.]+/)
    .map((token) => token.trim())
    .filter(Boolean)
}

function stemName(name: string): string {
  const base = basename(name).replace(/^\[[^\]]+\]\s*/g, '')
  const ext = extname(base)
  return (ext ? base.slice(0, -ext.length) : base).trim()
}

function uniqueOs(ids: number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b)
}

export function looksLikeVersion(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  return VERSION_TOKEN.test(trimmed.replace(/^v/i, 'v'))
}

export function parseImportName(name: string): ParsedImportName {
  const stem = stemName(name)
  const tokens = tokenize(stem)
  const os: number[] = []
  let contentKind: ContentKind | null = null
  let version = ''
  const titleParts: string[] = []

  for (const token of tokens) {
    const lower = token.toLowerCase()
    const osKind = OS_ALIASES[lower]
    if (osKind) {
      os.push(OS_KIND_IDS[osKind])
      continue
    }
    const kind = KIND_ALIASES[lower]
    if (kind && kind !== 'game') {
      if (!contentKind) contentKind = kind
      continue
    }
    if (DROP_TOKENS.has(lower)) continue
    const versionHit = token.match(VERSION_TOKEN)
    if (versionHit) {
      if (!version) version = versionHit[1]
      continue
    }
    titleParts.push(token)
  }

  if (!version) {
    const fromName = stem.match(VERSION_IN_NAME)
    if (fromName) version = fromName[1]
  }

  const title = titleParts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    title: title || stem.replace(/[_-]+/g, ' ').trim() || stem,
    version,
    os: uniqueOs(os),
    contentKind: CONTENT_KIND_IDS[contentKind || 'game']
  }
}

export function parseInstallFolderGuess(dirPath: string): ParsedImportName {
  const folder = basename(dirPath)
  const parent = basename(dirname(dirPath))
  const parsed = parseImportName(folder)
  if (looksLikeVersion(folder) && parent && !looksLikeVersion(parent)) {
    const parentParsed = parseImportName(parent)
    return {
      title: parentParsed.title || parent.replace(/[_-]+/g, ' ').trim(),
      version: folder.replace(/^v/i, ''),
      os: parsed.os.length ? parsed.os : parentParsed.os,
      contentKind: parsed.contentKind
    }
  }
  if (!parsed.version && looksLikeVersion(parent)) {
    return { ...parsed, version: parent.replace(/^v/i, '') }
  }
  return parsed
}

export function packageHintFromParsed(parsed: ParsedImportName, fallbackOs: number[] = []): PackageTagHint {
  return {
    os: parsed.os.length ? parsed.os : fallbackOs,
    contentKind: parsed.contentKind,
    version: parsed.version
  }
}

export function normalizeTitleKey(value: string): string {
  return (cleanThreadTitle(value) || value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

/** Score a filename/folder guess against a catalog or library title. */
export function scoreImportTitle(name: string, gameTitle: string): number {
  const parsed = parseImportName(name)
  const needle = normalizeTitleKey(parsed.title || name)
  const title = normalizeTitleKey(gameTitle)
  if (!needle || !title || title.length < 2) return 0

  let score = 0
  if (needle === title) score = 120
  else if (needle.startsWith(title) || title.startsWith(needle)) {
    const ratio = Math.min(needle.length, title.length) / Math.max(needle.length, title.length)
    score = Math.round(90 + ratio * 20)
  } else if (needle.includes(title) || title.includes(needle)) {
    const overlap = Math.min(needle.length, title.length)
    score = 70 + Math.min(20, overlap)
  }

  const fromSave = scoreSaveFolder(parsed.title || name, gameTitle)
  return Math.max(score, fromSave)
}

export const IMPORT_IDENTIFY_MIN_SCORE = 40
