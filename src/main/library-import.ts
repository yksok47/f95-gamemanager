import { mkdir, readFile, writeFile } from 'fs/promises'
import { basename, dirname, join } from 'path'
import { engineFromPrefixIds } from '@shared/prefixes'
import { normalizePackageInstallTags, type PackageInstallTags } from '@shared/p2p'
import {
  OS_KIND_IDS,
  type CatalogGame,
  type GameFileContext,
  type LibraryImportCandidate,
  type LibraryImportGameGuess,
  type LibraryImportKind,
  type LibraryImportScanResult,
  type LibraryStorageItem
} from '@shared/types'
import { fileBytes, folderBytes, mapLimit } from './disk-usage'
import { isPathInside, pathKey, uniqueScanRoots } from './extra-library-dirs'
import { fetchCatalog } from './f95/catalog'
import { sanitizeCatalogQuery } from './f95/sanitize-query'
import { isArchivePath } from './fs-utils'
import { addImportedLibraryFile, listGameFiles } from './game-files-store'
import { hashFile } from './hash'
import { detectEngineFromInstall, isLikelyGameRoot } from './launch'
import { rebasePath } from './install-layout'
import {
  IMPORT_IDENTIFY_MIN_SCORE,
  packageHintFromParsed,
  parseImportName,
  parseInstallFolderGuess,
  scoreImportTitle
} from './library-import-parse'
import { getAppPaths } from './paths'
import { folderSearchQueries } from './renpy/save-folder-match'
import {
  getDownloadsDirSync,
  getExtraArchiveDirsSync,
  getExtraLibraryDirsSync,
  getLibraryDirSync,
  getMetadataApiEnabledSync
} from './settings-store'
import { listSubscriptions } from './subscriptions-store'
import { listDirents, pathExists } from './win-path'

const MAX_DEPTH = 5
const MAX_CANDIDATES = 400
const IDENTIFY_CATALOG_QUERIES = 3
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '$recycle.bin',
  'system volume information',
  '__macosx',
  'untrusted'
])

type KnownGame = LibraryImportGameGuess & { inLibrary: boolean; inFollowed: boolean }

type ImportStore = {
  version: 1
  items: Record<string, LibraryImportCandidate>
}

let cache: ImportStore | null = null

function emptyStore(): ImportStore {
  return { version: 1, items: {} }
}

function hostOsIds(): number[] {
  if (process.platform === 'win32') return [OS_KIND_IDS.win]
  if (process.platform === 'linux') return [OS_KIND_IDS.linux]
  if (process.platform === 'darwin') return [OS_KIND_IDS.mac]
  return []
}

async function readImportStore(): Promise<ImportStore> {
  if (cache) return cache
  try {
    const raw = await readFile(getAppPaths().libraryImportsFile, 'utf8')
    const parsed = JSON.parse(raw) as ImportStore
    cache = {
      version: 1,
      items: parsed && typeof parsed.items === 'object' && parsed.items ? parsed.items : {}
    }
  } catch {
    cache = emptyStore()
  }
  return cache
}

async function writeImportStore(store: ImportStore): Promise<void> {
  cache = store
  const file = getAppPaths().libraryImportsFile
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(store, null, 2), 'utf8')
}

export function importCandidateId(kind: LibraryImportKind, filePath: string): string {
  return `import:${kind}:${pathKey(filePath)}`
}

function shouldSkipDir(name: string): boolean {
  const lower = name.toLowerCase()
  return SKIP_DIR_NAMES.has(lower) || lower.startsWith('.')
}

function collectArchiveFiles(
  root: string,
  acc: string[],
  remaining: { n: number },
  skip: Set<string>
): void {
  function walk(dir: string, depth: number): void {
    if (remaining.n <= 0 || depth > MAX_DEPTH) return
    if (skip.has(pathKey(dir))) return
    for (const entry of listDirents(dir)) {
      if (remaining.n <= 0) return
      const child = join(dir, entry.name)
      const key = pathKey(child)
      if (entry.isDirectory()) {
        if (shouldSkipDir(entry.name) || skip.has(key) || isLikelyGameRoot(child)) continue
        walk(child, depth + 1)
        continue
      }
      if (!entry.isFile() || !isArchivePath(entry.name) || skip.has(key)) continue
      acc.push(child)
      remaining.n -= 1
    }
  }
  walk(root, 0)
}

function collectInstallFolders(
  root: string,
  acc: string[],
  remaining: { n: number },
  skip: Set<string>
): void {
  function walk(dir: string, depth: number): void {
    if (remaining.n <= 0 || depth > MAX_DEPTH) return
    if (skip.has(pathKey(dir))) return
    if (isLikelyGameRoot(dir)) {
      acc.push(dir)
      remaining.n -= 1
      return
    }
    if (depth >= MAX_DEPTH) return
    for (const entry of listDirents(dir)) {
      if (remaining.n <= 0) return
      if (!entry.isDirectory() || shouldSkipDir(entry.name)) continue
      const child = join(dir, entry.name)
      if (skip.has(pathKey(child))) continue
      walk(child, depth + 1)
    }
  }
  walk(root, 0)
}

function importArchiveDirs(): string[] {
  return uniqueScanRoots([
    getDownloadsDirSync(),
    getLibraryDirSync(),
    ...getExtraArchiveDirsSync(),
    ...getExtraLibraryDirsSync()
  ])
}

function importInstallDirs(): string[] {
  return uniqueScanRoots([getLibraryDirSync(), ...getExtraLibraryDirsSync()])
}

function isImportSourcePath(filePath: string): boolean {
  return (
    isPathInside(filePath, getDownloadsDirSync()) ||
    isPathInside(filePath, getLibraryDirSync()) ||
    getExtraArchiveDirsSync().some((dir) => isPathInside(filePath, dir)) ||
    getExtraLibraryDirsSync().some((dir) => isPathInside(filePath, dir))
  )
}

async function knownLibraryPaths(): Promise<Set<string>> {
  const keys = new Set<string>()
  for (const file of await listGameFiles()) {
    if (file.archivePath) keys.add(pathKey(file.archivePath))
    if (file.installPath) keys.add(pathKey(file.installPath))
  }
  return keys
}

function uniqueCatalogHit(
  ranked: Array<{ game: CatalogGame | KnownGame; score: number }>
): (CatalogGame | KnownGame) | null {
  if (!ranked.length) return null
  if (ranked.length > 1 && ranked[0].score === ranked[1].score) return null
  return ranked[0].game
}

function guessFromKnown(game: KnownGame): LibraryImportGameGuess {
  return {
    threadId: game.threadId,
    title: game.title,
    coverUrl: game.coverUrl,
    creator: game.creator,
    engine: game.engine,
    version: game.version,
    rating: game.rating,
    likes: game.likes,
    views: game.views,
    threadUrl: game.threadUrl,
    prefixes: game.prefixes,
    tags: game.tags,
    timestamp: game.timestamp,
    updatedAt: game.updatedAt,
    screens: game.screens
  }
}

function guessFromCatalog(game: CatalogGame): LibraryImportGameGuess {
  return {
    threadId: game.threadId,
    title: game.title,
    coverUrl: game.coverUrl,
    creator: game.creator,
    engine: game.engine || engineFromPrefixIds(game.prefixes) || '',
    version: game.version,
    rating: game.rating,
    likes: game.likes,
    views: game.views,
    threadUrl: game.threadUrl,
    prefixes: game.prefixes,
    tags: game.tags,
    timestamp: game.timestamp,
    updatedAt: game.updatedAt,
    screens: game.screens
  }
}

async function loadKnownGames(): Promise<KnownGame[]> {
  const byThread = new Map<number, KnownGame>()
  const upsert = (game: KnownGame): void => {
    if (!game.threadId || !game.title) return
    const prev = byThread.get(game.threadId)
    if (!prev) {
      byThread.set(game.threadId, game)
      return
    }
    byThread.set(game.threadId, {
      ...prev,
      ...game,
      coverUrl: game.coverUrl || prev.coverUrl,
      inLibrary: prev.inLibrary || game.inLibrary,
      inFollowed: prev.inFollowed || game.inFollowed
    })
  }

  for (const file of await listGameFiles()) {
    upsert({
      threadId: file.threadId,
      title: file.title,
      coverUrl: file.coverUrl ?? null,
      creator: file.creator,
      engine: file.engine,
      version: file.version,
      rating: file.rating,
      likes: file.likes,
      views: file.views,
      threadUrl: file.threadUrl,
      prefixes: file.prefixes,
      tags: file.tags,
      timestamp: file.timestamp,
      updatedAt: file.updatedAt,
      screens: file.screens,
      inLibrary: true,
      inFollowed: false
    })
  }

  for (const game of await listSubscriptions()) {
    upsert({
      threadId: game.threadId,
      title: game.title,
      coverUrl: game.coverUrl ?? null,
      creator: game.creator,
      engine: game.engine || engineFromPrefixIds(game.prefixes) || '',
      version: game.version,
      rating: game.rating,
      likes: game.likes,
      views: game.views,
      threadUrl: game.threadUrl,
      prefixes: game.prefixes,
      tags: game.tags,
      timestamp: game.timestamp,
      updatedAt: game.updatedAt,
      screens: game.screens,
      inLibrary: false,
      inFollowed: true
    })
  }

  return [...byThread.values()]
}

async function identifyFromCatalog(title: string): Promise<CatalogGame | null> {
  const bestByThread = new Map<number, { game: CatalogGame; score: number }>()
  const queries = folderSearchQueries(title).slice(0, IDENTIFY_CATALOG_QUERIES)
  for (const search of queries) {
    if (!sanitizeCatalogQuery(search)) continue
    try {
      const page = await fetchCatalog(
        { search, rows: 90, page: 1 },
        { skipFilterFetch: true, skipSessionOptions: true }
      )
      for (const game of page.games) {
        const score = scoreImportTitle(title, game.title)
        if (score < IMPORT_IDENTIFY_MIN_SCORE) continue
        const prev = bestByThread.get(game.threadId)
        if (!prev || score > prev.score) bestByThread.set(game.threadId, { game, score })
      }
    } catch {
      /* try the next query shape */
    }
    const ranked = [...bestByThread.values()].sort(
      (a, b) => b.score - a.score || a.game.threadId - b.game.threadId
    )
    const unique = uniqueCatalogHit(ranked)
    if (unique && 'threadUrl' in unique) return unique as CatalogGame
  }
  return null
}

async function guessGame(title: string, known: KnownGame[]): Promise<LibraryImportGameGuess | null> {
  if (!title.trim()) return null
  const ranked = known
    .map((game) => ({ game, score: scoreImportTitle(title, game.title) }))
    .filter((item) => item.score >= IMPORT_IDENTIFY_MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.game.threadId - b.game.threadId)
  const local = uniqueCatalogHit(ranked)
  if (local && 'inLibrary' in local) return guessFromKnown(local)

  const catalog = await identifyFromCatalog(title)
  return catalog ? guessFromCatalog(catalog) : null
}

async function buildCandidate(
  kind: LibraryImportKind,
  filePath: string,
  known: KnownGame[]
): Promise<LibraryImportCandidate | null> {
  if (!pathExists(filePath)) return null
  const parsed = kind === 'install' ? parseInstallFolderGuess(filePath) : parseImportName(filePath)
  const bytes = kind === 'install' ? await folderBytes(filePath) : await fileBytes(filePath)
  if (bytes <= 0) return null
  const fallbackOs = kind === 'install' ? hostOsIds() : []
  const engine = kind === 'install' ? detectEngineFromInstall(filePath) : ''
  const guess = await guessGame(parsed.title, known)
  return {
    id: importCandidateId(kind, filePath),
    kind,
    path: filePath,
    filename: basename(filePath),
    bytes,
    guessedTitle: parsed.title,
    guessedEngine: engine || guess?.engine || '',
    packageTags: packageHintFromParsed(parsed, fallbackOs),
    guess
  }
}

export async function scanExternalLibraries(): Promise<LibraryImportScanResult> {
  const archiveDirs = importArchiveDirs()
  const installDirs = importInstallDirs()
  const remaining = { n: MAX_CANDIDATES }
  const archives: string[] = []
  const installs: string[] = []
  const knownPaths = await knownLibraryPaths()

  for (const dir of archiveDirs) {
    if (!pathExists(dir)) continue
    collectArchiveFiles(dir, archives, remaining, knownPaths)
  }
  for (const dir of installDirs) {
    if (!pathExists(dir)) continue
    collectInstallFolders(dir, installs, remaining, knownPaths)
  }

  const truncated = remaining.n <= 0
  const known = await loadKnownGames()
  const next: Record<string, LibraryImportCandidate> = {}

  const jobs: Array<{ kind: LibraryImportKind; path: string }> = []
  const seen = new Set<string>()
  const pushJob = (kind: LibraryImportKind, filePath: string): void => {
    const key = `${kind}:${pathKey(filePath)}`
    if (seen.has(key) || knownPaths.has(pathKey(filePath))) return
    seen.add(key)
    jobs.push({ kind, path: filePath })
  }
  for (const filePath of archives) pushJob('archive', filePath)
  for (const filePath of installs) pushJob('install', filePath)

  const built = await mapLimit(jobs, 4, (job) => buildCandidate(job.kind, job.path, known))
  for (const item of built) {
    if (!item) continue
    next[pathKey(item.path)] = item
  }

  await writeImportStore({ version: 1, items: next })
  return {
    found: jobs.length,
    pending: Object.keys(next).length,
    truncated
  }
}

export async function listPendingImports(): Promise<LibraryImportCandidate[]> {
  const store = await readImportStore()
  const knownPaths = await knownLibraryPaths()
  const items: LibraryImportCandidate[] = []
  let changed = false
  for (const [key, item] of Object.entries(store.items)) {
    if (!item?.path || knownPaths.has(pathKey(item.path)) || !pathExists(item.path)) {
      delete store.items[key]
      changed = true
      continue
    }
    items.push(item)
  }
  if (changed) await writeImportStore(store)
  items.sort((a, b) => b.bytes - a.bytes || a.filename.localeCompare(b.filename))
  return items
}

export function pendingImportToStorageItem(item: LibraryImportCandidate): LibraryStorageItem {
  const guess = item.guess
  return {
    id: item.id,
    kind: item.kind,
    threadId: guess?.threadId || 0,
    title: guess?.title || item.guessedTitle || item.filename,
    creator: guess?.creator || '',
    version: item.packageTags.version || guess?.version || '',
    filename: item.filename,
    coverUrl: guess?.coverUrl ?? null,
    engine: item.guessedEngine || guess?.engine || '',
    bytes: item.bytes,
    fileId: null,
    hasArchive: item.kind === 'archive',
    isInstalled: item.kind === 'install',
    pendingImport: true,
    importPath: item.path,
    packageTags: item.packageTags,
    identified: false,
    identifyFailed: !guess
  }
}

export async function getPendingImport(filePath: string): Promise<LibraryImportCandidate | null> {
  const store = await readImportStore()
  return store.items[pathKey(filePath)] || null
}

export async function identifyPendingImport(filePath: string): Promise<LibraryImportCandidate | null> {
  const store = await readImportStore()
  const existing = store.items[pathKey(filePath)]
  if (!existing) return null
  const known = await loadKnownGames()
  const next = await buildCandidate(existing.kind, existing.path, known)
  if (!next) {
    delete store.items[pathKey(filePath)]
    await writeImportStore(store)
    return null
  }
  store.items[pathKey(filePath)] = next
  await writeImportStore(store)
  return next
}

function contextFromGuess(
  game: LibraryImportGameGuess,
  tags: PackageInstallTags
): GameFileContext {
  return {
    threadId: game.threadId,
    title: game.title,
    version: tags.version || game.version || '',
    engine: game.engine,
    creator: game.creator,
    coverUrl: game.coverUrl,
    rating: game.rating,
    likes: game.likes,
    views: game.views,
    threadUrl: game.threadUrl,
    prefixes: game.prefixes,
    tags: game.tags,
    timestamp: game.timestamp,
    updatedAt: game.updatedAt,
    screens: game.screens,
    packageHint: {
      os: tags.os,
      contentKind: tags.contentKind,
      version: tags.version
    }
  }
}

async function reportInstallTags(contentHash: string, tags: PackageInstallTags): Promise<void> {
  if (!getMetadataApiEnabledSync() || !contentHash) return
  const { buildInstallClaimMessage, reportPackageInstall } = await import('./p2p/metadata-client')
  const { signMessageBytes } = await import('./p2p/identity')
  const ts = Math.floor(Date.now() / 1000)
  const msg = buildInstallClaimMessage(contentHash, ts, tags)
  const { seederPubkey, signature } = await signMessageBytes(msg)
  await reportPackageInstall(contentHash, {
    seederPubkey,
    ts,
    signature,
    tags
  })
}

export async function dismissPendingImport(filePath: string): Promise<void> {
  const store = await readImportStore()
  const key = pathKey(filePath)
  if (!store.items[key]) return
  delete store.items[key]
  await writeImportStore(store)
}

export async function approvePendingImport(
  filePath: string,
  game: LibraryImportGameGuess,
  tags: PackageInstallTags
): Promise<void> {
  const pending = await getPendingImport(filePath)
  if (!pending) throw new Error('That file is not waiting to be imported.')
  if (!game.threadId || !game.title.trim()) throw new Error('Pick a game before importing.')
  const normalized = normalizePackageInstallTags(tags)
  const context = contextFromGuess(game, normalized)
  const size =
    pending.kind === 'install' ? pending.bytes : (await fileBytes(pending.path)) || pending.bytes
  let hash = ''
  if (pending.kind === 'archive') {
    hash = await hashFile(pending.path)
  } else {
    context.engine = context.engine || pending.guessedEngine || detectEngineFromInstall(pending.path)
  }

  await addImportedLibraryFile({
    kind: pending.kind,
    path: pending.path,
    hash,
    size,
    context
  })

  if (hash) {
    void import('./p2p/controller')
      .then(({ onLibraryPackageAdded }) =>
        onLibraryPackageAdded({
          filePath: pending.path,
          contentHash: hash,
          gameName: context.title,
          gameVersion: normalized.version,
          f95ThreadId: context.threadId,
          f95ThreadUrl: context.threadUrl
        })
      )
      .catch((error) => {
        console.warn('[library] auto-seed after import failed', error)
      })
    void reportInstallTags(hash, normalized).catch((error) => {
      console.warn('[library] install report after import failed', error)
    })
  }

  await dismissPendingImport(pending.path)
}

export async function rebasePendingImportPaths(fromRoot: string, toRoot: string): Promise<void> {
  if (!fromRoot || !toRoot) return
  const store = await readImportStore()
  const items: Record<string, LibraryImportCandidate> = {}
  let changed = false
  for (const item of Object.values(store.items)) {
    if (!item?.path) continue
    const nextPath = rebasePath(item.path, fromRoot, toRoot)
    if (pathKey(nextPath) !== pathKey(item.path)) changed = true
    const next: LibraryImportCandidate = {
      ...item,
      path: nextPath,
      id: importCandidateId(item.kind, nextPath)
    }
    items[pathKey(next.path)] = next
  }
  if (!changed) return
  await writeImportStore({ version: 1, items })
}

export async function revealImportPath(filePath: string): Promise<void> {
  const pending = await getPendingImport(filePath)
  if (!pending && !isImportSourcePath(filePath)) {
    throw new Error('That path is not in a library folder.')
  }
  const { shell } = await import('electron')
  shell.showItemInFolder(filePath)
}
