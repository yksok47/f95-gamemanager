import { mkdir, readdir, rename, rm } from 'fs/promises'
import { join, sep } from 'path'
import { createExtractorFromFile } from 'node-unrar-js'
import { extractFull, list as list7z } from 'node-7z'
import { path7za } from '7zip-bin'
import { archiveKind } from './fs-utils'
import { makePathExecutableSync, markExtractedExecutables } from './unix-exec'
import { pathExists, toFsPath } from './win-path'

const JUNK_NAMES = new Set(['__macosx', '.ds_store', 'thumbs.db', 'desktop.ini'])
const KEEP_ROOT_DIRS = new Set(['game', 'renpy', 'lib'])

function isJunkName(name: string): boolean {
  const lower = name.toLowerCase()
  return JUNK_NAMES.has(lower) || lower.startsWith('._')
}

function isProtectedRootDir(name: string): boolean {
  return KEEP_ROOT_DIRS.has(name.toLowerCase())
}

async function unwrapSingleRoot(destDir: string): Promise<void> {
  for (;;) {
    const entries = await readdir(toFsPath(destDir), { withFileTypes: true })
    const keep = entries.filter((entry) => !isJunkName(entry.name))
    if (keep.length !== 1 || !keep[0].isDirectory() || isProtectedRootDir(keep[0].name)) break

    const wrapper = join(destDir, keep[0].name)
    const children = await readdir(toFsPath(wrapper), { withFileTypes: true })
    for (const child of children) {
      const from = join(wrapper, child.name)
      const to = join(destDir, child.name)
      if (pathExists(to)) await rm(toFsPath(to), { recursive: true, force: true })
      await rename(toFsPath(from), toFsPath(to))
    }
    await rm(toFsPath(wrapper), { recursive: true, force: true })
  }

  const leftover = await readdir(toFsPath(destDir), { withFileTypes: true }).catch(() => [])
  for (const entry of leftover) {
    if (!isJunkName(entry.name)) continue
    await rm(toFsPath(join(destDir, entry.name)), { recursive: true, force: true })
  }
}

function asarUnpacked(filePath: string): string {
  const packed = `${sep}app.asar${sep}`
  const unpacked = `${sep}app.asar.unpacked${sep}`
  return filePath.includes(unpacked) ? filePath : filePath.split(packed).join(unpacked)
}

function sevenZipBin(): string {
  const exe = process.platform === 'win32' ? '7za.exe' : '7za'
  const platformDir = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'win' : 'linux'
  const candidates = [
    join(process.resourcesPath, '7zip', platformDir, process.arch, exe),
    asarUnpacked(path7za)
  ]
  if (!path7za.includes(`${sep}app.asar${sep}`)) candidates.push(path7za)
  const found = candidates.find((bin) => pathExists(bin))
  if (!found) {
    throw new Error('The bundled 7-Zip tool is missing from the app files.')
  }
  makePathExecutableSync(found)
  return found
}

function extractWith7z(
  archivePath: string,
  destDir: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = extractFull(toFsPath(archivePath), toFsPath(destDir), {
      $bin: sevenZipBin(),
      $progress: true
    })
    stream.on('progress', (progress) => {
      const percent = Number(progress.percent)
      if (Number.isFinite(percent)) onProgress?.(Math.max(0, Math.min(100, percent)))
    })
    stream.on('end', () => resolve())
    stream.on('error', (error) => reject(error instanceof Error ? error : new Error(String(error))))
  })
}

async function extractRar(archivePath: string, destDir: string): Promise<void> {
  const extractor = await createExtractorFromFile({
    filepath: toFsPath(archivePath),
    targetPath: toFsPath(destDir)
  })
  const extracted = extractor.extract()
  // Drain the iterator so every file is written.
  for (const _file of extracted.files) {
    void _file
  }
}

function listWith7z(archivePath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const entries: string[] = []
    const stream = list7z(toFsPath(archivePath), { $bin: sevenZipBin() })
    stream.on('data', (data: { file?: string }) => {
      if (data?.file) entries.push(String(data.file))
    })
    stream.on('end', () => resolve(entries))
    stream.on('error', (error) => reject(error instanceof Error ? error : new Error(String(error))))
  })
}

async function listRar(archivePath: string): Promise<string[]> {
  const extractor = await createExtractorFromFile({
    filepath: toFsPath(archivePath)
  })
  const listed = extractor.getFileList()
  const headers = listed.fileHeaders
  const entries: string[] = []
  for (const header of headers) {
    const name = String((header as { name?: string }).name || '')
    if (name) entries.push(name)
  }
  return entries
}

/** List file paths inside a zip/7z/rar (forward-slash normalized). */
export async function listArchiveEntries(archivePath: string): Promise<string[]> {
  const kind = archiveKind(archivePath)
  if (!kind) {
    throw new Error('That file is not a zip, 7z, or rar archive.')
  }
  const raw = kind === 'rar' ? await listRar(archivePath) : await listWith7z(archivePath)
  return raw
    .map((entry) => entry.replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((entry) => {
      if (!entry || entry.endsWith('/')) return false
      const base = entry.split('/').pop() || ''
      return !isJunkName(base)
    })
}

export async function extractArchive(
  archivePath: string,
  destDir: string,
  onProgress?: (percent: number) => void,
  options?: { unwrap?: boolean }
): Promise<void> {
  const kind = archiveKind(archivePath)
  if (!kind) {
    throw new Error('That file is not a zip, 7z, or rar archive.')
  }
  await mkdir(toFsPath(destDir), { recursive: true })
  if (kind === 'rar') {
    onProgress?.(5)
    await extractRar(archivePath, destDir)
    onProgress?.(100)
  } else {
    await extractWith7z(archivePath, destDir, onProgress)
  }
  if (options?.unwrap !== false) {
    await unwrapSingleRoot(destDir)
  }
  await markExtractedExecutables(destDir)
}
