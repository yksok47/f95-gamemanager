export type AuthSession = {
  loggedIn: boolean
  userId: string | null
  username: string | null
}

export type CatalogSort = 'date' | 'likes' | 'views' | 'title' | 'rating'
export type CatalogCategory = 'games' | 'comics' | 'animations' | 'assets'
export type MatchMode = 'or' | 'and'

export type CatalogQuery = {
  page?: number
  rows?: number
  sort?: CatalogSort
  category?: CatalogCategory
  search?: string
  prefixes?: number[]
  excludePrefixes?: number[]
  prefixType?: MatchMode
  tags?: number[]
  excludeTags?: number[]
  tagType?: MatchMode
  creator?: string
  /** Browse catalog hides ignored threads; lookup must show them to load metadata. */
  ignored?: 'hide' | 'show'
}

export type CatalogLookupQuery = {
  threadId: number
  title: string
  creator?: string
}

export type CatalogGame = {
  threadId: number
  title: string
  creator: string
  version: string
  views: number
  likes: number
  rating: number
  coverUrl: string | null
  updatedAt: string
  timestamp: number
  isNew: boolean
  threadUrl: string
  prefixes: number[]
  tags: number[]
  screens: string[]
  engine?: string
}

export type CatalogPage = {
  games: CatalogGame[]
  page: number
  totalPages: number
  totalGames: number
}

export type PrefixGroup = 'status' | 'engine' | 'other'

export type CatalogPrefix = {
  id: number
  name: string
  group: PrefixGroup
}

export type CatalogTag = {
  id: number
  name: string
}

export type CatalogFilters = {
  prefixes: CatalogPrefix[]
  tags: CatalogTag[]
}

export type LoginPayload = {
  username: string
  password: string
}

export type SubscriptionSource = 'manual' | 'watched' | 'bookmark'
export type GameRarity = 'infamous' | 'regular' | 'rare' | 'epic' | 'legendary'
export type TagTier = 'bronze' | 'silver' | 'gold'

export const GAME_RARITIES: GameRarity[] = ['infamous', 'regular', 'rare', 'epic', 'legendary']
export const TAG_TIERS: TagTier[] = ['gold', 'silver', 'bronze']
/** Max ranked tags allowed in one gold/silver/bronze group. */
export const TAGS_PER_TIER_LIMIT = 10
/** F95 only honors this many include or exclude tags per request. */
export const TAG_QUERY_LIMIT = 10
/** Titles fetched per catalog page. SAM caps at 90. */
export const CATALOG_PAGE_SIZES = [15, 30, 45, 60, 75, 90] as const
export type CatalogPageSize = (typeof CATALOG_PAGE_SIZES)[number]
export const DEFAULT_CATALOG_PAGE_SIZE: CatalogPageSize = 60

export function isCatalogPageSize(value: unknown): value is CatalogPageSize {
  return typeof value === 'number' && (CATALOG_PAGE_SIZES as readonly number[]).includes(value)
}

export const RARITY_RANK: Record<GameRarity, number> = {
  infamous: 0,
  regular: 1,
  rare: 2,
  epic: 3,
  legendary: 4
}

export const TAG_TIER_RANK: Record<TagTier, number> = {
  bronze: 1,
  silver: 2,
  gold: 3
}

export type FavoriteTag = {
  id: number
  name: string
  tier: TagTier
}

export type HatedTag = {
  id: number
  name: string
}

export type AppSettings = {
  favoriteTags: FavoriteTag[]
  hatedTags: HatedTag[]
  downloadsDir: string
  libraryDir: string
  /** Extra archive folders to import from. New downloads still go to downloadsDir. */
  extraArchiveDirs: string[]
  /** Extra installed-game folders to import from. New installs still go to libraryDir. */
  extraLibraryDirs: string[]
  /** OFF by default. When on, seed all local packages via WebTorrent (main). */
  p2pEnabled: boolean
  /**
   * ON by default. When off, skip metadata REST (catalog, share-claim, flags, install reports).
   * P2P swarm / tracker still work when p2pEnabled.
   */
  metadataApiEnabled: boolean
  /** Metadata REST base (no trailing slash). Hardcoded; override via METADATA_BASE_URL. */
  metadataBaseUrl: string
  /** WebSocket tracker (wss:// preferred). Hardcoded; override via TRACKER_WEBRTC_URL. */
  trackerWebRtcUrl: string
  /** P2P upload cap in KB/s. 0 = unlimited. */
  p2pUploadLimitKBps: number
  /** Titles loaded per catalog page. */
  catalogPageSize: CatalogPageSize
}

export type DownloadStatus = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'

/** Prefill for approve-tags from a parsed F95 download entry (numeric wire enums). */
export type PackageTagHint = {
  os: number[]
  contentKind: number
  version: string
}

/** Normalize a stored / wire package-tag payload; returns undefined when contentKind is missing. */
export function asPackageTagHint(value: unknown): PackageTagHint | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<PackageTagHint>
  const contentKind = Number(raw.contentKind)
  if (!Number.isFinite(contentKind)) return undefined
  const os = Array.isArray(raw.os)
    ? raw.os.map((n) => Number(n)).filter((n) => Number.isFinite(n))
    : []
  return {
    os,
    contentKind,
    version: typeof raw.version === 'string' ? raw.version : ''
  }
}

export type DownloadLibraryStatus = 'hashing' | 'pendingReview' | 'indexed' | 'error'

export type DownloadRecord = {
  id: string
  filename: string
  url: string
  savePath: string
  receivedBytes: number
  totalBytes: number
  status: DownloadStatus
  paused: boolean
  canResume: boolean
  bytesPerSecond: number
  error?: string
  startedAt: number
  updatedAt: number
  /** When the transfer reached a finished status (completed / cancelled / interrupted). */
  finishedAt?: number
  gameThreadId?: number
  gameTitle?: string
  gameVersion?: string
  gameCreator?: string
  gameCoverUrl?: string | null
  gameEngine?: string
  hash?: string
  libraryStatus?: DownloadLibraryStatus
  /** From the F95 download link that started this transfer — used when metadata API has nothing. */
  packageHint?: PackageTagHint
}

export type GameFileContext = {
  threadId: number
  title: string
  version: string
  engine?: string
  creator?: string
  coverUrl?: string | null
  rating?: number
  likes?: number
  views?: number
  threadUrl?: string
  prefixes?: number[]
  tags?: number[]
  timestamp?: number
  updatedAt?: string
  screens?: string[]
  /** OS / content kind / version inferred from the clicked download entry. */
  packageHint?: PackageTagHint
}

export type InstalledPatchRef = {
  patchId: string
  hash: string
  filename: string
  installedAt: number
  /** Folder name under `game/.uninstall/` holding instructions + backups. */
  uninstallSlot?: string
}

export type GameLibraryFile = {
  id: string
  threadId: number
  title: string
  version: string
  engine: string
  filename: string
  archivePath: string
  hash: string
  size: number
  downloadedAt: number
  installPath: string | null
  installedAt: number | null
  executablePath: string | null
  lastPlayedAt: number | null
  playtimeMs: number
  playing?: boolean
  hasArchive: boolean
  isInstalled: boolean
  installPercent: number | null
  installError?: string
  creator?: string
  coverUrl?: string | null
  rating?: number
  likes?: number
  views?: number
  threadUrl?: string
  prefixes?: number[]
  tags?: number[]
  timestamp?: number
  updatedAt?: string
  /** Folder name under %APPDATA%/RenPy (or absolute path), or null when saves live in game/saves. */
  renpySaveDirectory?: string | null
  /**
   * Uncensor patches applied into this installed game version.
   * Cleared when the game is uninstalled.
   */
  installedPatches?: InstalledPatchRef[]
  /**
   * Whether this uncensor package has a supported .rpy/.rpyc or game-folder layout.
   * Undefined until probed; false hides Install.
   */
  uncensorInstallable?: boolean
  screens?: string[]
  /** OS / content kind / version chosen when the file was approved into the library. */
  packageTags?: PackageTagHint
}

export type LibraryStorageKind = 'archive' | 'install' | 'saves'

export type LibraryStorageItem = {
  id: string
  kind: LibraryStorageKind
  threadId: number
  title: string
  creator: string
  version: string
  filename: string
  coverUrl: string | null
  engine: string
  bytes: number
  fileId: string | null
  hasArchive: boolean
  isInstalled: boolean
  /** Absolute path to the save folder, when this row is a save entry. */
  savePath?: string | null
  /** Directory name under the engine saves root (or a short label). */
  saveFolderName?: string | null
  /** Absolute path of an installed game folder. */
  installPath?: string | null
  /** Canonical `{libraryDir}/{title}/{version}` path for this install. */
  expectedInstallPath?: string | null
  /** Installed folder is not at the canonical title/version location. */
  layoutMismatch?: boolean
  inLibrary?: boolean
  inFollowed?: boolean
  /** We know which game this folder belongs to (live match or stored). */
  identified?: boolean
  /** Identify was tried and did not find a unique game. */
  identifyFailed?: boolean
  /** Archive or install from a library folder, waiting for review. */
  pendingImport?: boolean
  /** Absolute path of a pending import (archive file or install folder). */
  importPath?: string | null
  /** Guessed OS / content kind / version for a pending import. */
  packageTags?: PackageTagHint
}

export type LibraryImportKind = 'archive' | 'install'

export type LibraryImportGameGuess = {
  threadId: number
  title: string
  coverUrl: string | null
  creator?: string
  engine?: string
  version?: string
  rating?: number
  likes?: number
  views?: number
  threadUrl?: string
  prefixes?: number[]
  tags?: number[]
  timestamp?: number
  updatedAt?: string
  screens?: string[]
}

export type LibraryImportCandidate = {
  id: string
  kind: LibraryImportKind
  path: string
  filename: string
  bytes: number
  guessedTitle: string
  guessedEngine: string
  packageTags: PackageTagHint
  guess: LibraryImportGameGuess | null
}

export type LibraryImportScanResult = {
  found: number
  pending: number
  truncated: boolean
}

/** Remembered save-folder → thread mapping, including catalog snapshot for library tiles. */
export type IdentifiedSaveFolder = {
  title: string
  threadId: number
  coverUrl: string | null
  savePath: string
  folderName: string
  identifiedAt: number
  creator?: string
  engine?: string
  version?: string
  rating?: number
  likes?: number
  views?: number
  threadUrl?: string
  prefixes?: number[]
  tags?: number[]
  timestamp?: number
  updatedAt?: string
  screens?: string[]
}

export type SaveFolderPeekShot = {
  label: string
  page: string
  saveName?: string
  thumbnailUrl: string
  modifiedAt: number
}

export type LibraryStorageGame = {
  threadId: number
  title: string
  creator: string
  coverUrl: string | null
  engine: string
  archiveBytes: number
  installBytes: number
  saveBytes: number
  totalBytes: number
  archiveIds: string[]
  installIds: string[]
  saveFileId: string | null
  savePath?: string | null
}

export type LibraryStorageStats = {
  archiveBytes: number
  installBytes: number
  saveBytes: number
  totalBytes: number
  games: LibraryStorageGame[]
  items: LibraryStorageItem[]
}

export type LibraryStorageScan = {
  scanning: boolean
  scannedAt: number | null
  error: string | null
  stats: LibraryStorageStats | null
}

export type PlaySessionStatus = {
  fileId: string
  threadId: number
  pid: number
  startedAt: number
  elapsedMs: number
}

export type UnRenAction = 'extract' | 'decompile'

export type RenpyToolId =
  | 'console'
  | 'quick'
  | 'skip'
  | 'rollback'
  | 'transitions'
  | 'after-choices'
  | 'fullscreen'
  | 'save-naming'

export type RenpySaveKind = 'slot' | 'auto' | 'quick' | 'persistent' | 'other'

export type RenpySaveFile = {
  name: string
  label: string
  path: string
  size: number
  modifiedAt: number
  kind: RenpySaveKind
  page: string
  slot: number | null
  saveName?: string
  gameVersion?: string
  renpyVersion?: string
  savedAt?: number
  thumbnailUrl?: string
}

export type RenpyArchiveFile = {
  name: string
  path: string
  size: number
}

export type RenpyScriptStatus = {
  gameRoot: string
  gameDir: string
  pythonPath: string | null
  rpaCount: number
  rpaBytes: number
  rpaFiles: RenpyArchiveFile[]
  rpycCount: number
  rpyCount: number
  rpycWithoutRpy: number
  optionsRpy: boolean
  optionsRpyc: boolean
  packed: boolean
  unpacked: boolean
  compiled: boolean
  alreadyUnpacked: boolean
  alreadyDecompiled: boolean
  needsUnpack: boolean
  needsDecompile: boolean
}

export type RenpyLastRun = {
  action: UnRenAction | 'locate'
  startedAt: number
  finishedAt: number | null
  ok: boolean
  summary: string
  log: string
  error: string | null
  done: number
  total: number
  skipped: number
  failed: number
}

export type RenpySaveLocation = {
  savePath: string
  folderName: string
}

export type RenpyInfo = {
  fileId: string
  gameRoot: string | null
  saveDirectory: string | null
  savePath: string | null
  savePathExists: boolean
  saveFolderBytes: number
  /** Identified / assigned save folders for this game, active path first. */
  saveLocations: RenpySaveLocation[]
  optionsFound: boolean
  /** When true, option toggles follow the global Ren'Py prefs (per-game overrides locked). */
  optionsGlobal: boolean
  tools: Record<RenpyToolId, boolean>
  saves: RenpySaveFile[]
  scripts: RenpyScriptStatus | null
  lastRun: RenpyLastRun | null
  message?: string
}

export type RenpyStatus = {
  fileId: string
  running: boolean
  action: UnRenAction | 'locate' | null
  message: string
  log: string
  error: string | null
  done: number
  total: number
  percent: number | null
}

export type RpgMakerSaveKind = 'slot' | 'auto' | 'quick' | 'config' | 'global' | 'other'

export type RpgMakerSaveFile = {
  name: string
  label: string
  path: string
  size: number
  modifiedAt: number
  kind: RpgMakerSaveKind
  slot: number | null
}

export type RpgMakerInfo = {
  fileId: string
  threadId: number
  gameSavePath: string | null
  gameSavePathExists: boolean
  backupPath: string
  backupPathExists: boolean
  saveFolderBytes: number
  copiedToGame: number
  copiedToBackup: number
  saves: RpgMakerSaveFile[]
  message?: string
}

/**
 * Per-version history for a game (survives uninstall/remove of that build).
 * Entries may be unplayed — e.g. versions discovered when refreshing metadata.
 */
export type VersionPlayStatus = 'unplayed' | 'played' | 'skipped'

export type VersionPlayStat = {
  version: string
  /** F95 / catalog release (or thread-update) time for this version, when known. */
  releasedAt: number
  lastPlayedAt: number
  playtimeMs: number
  /**
   * User-set attention state. When omitted, inferred from play activity.
   * Explicit `unplayed` can override recorded playtime (e.g. launched but unfinished).
   */
  status?: VersionPlayStatus
}

export type Subscription = {
  threadId: number
  title: string
  creator: string
  version: string
  coverUrl: string | null
  rating: number
  likes: number
  views: number
  updatedAt: string
  timestamp: number
  threadUrl: string
  source: SubscriptionSource
  addedAt: number
  rarity: GameRarity
  tags: number[]
  prefixes: number[]
  engine: string
  lastPlayedVersion: string
  lastPlayedAt: number
  playtimeMs: number
  /** Cumulative play stats keyed by version string. */
  playedVersions: VersionPlayStat[]
  checkedAt: number
  screens: string[]
  /** Hidden from the followed list unless the archive switch is on. */
  archived: boolean
}

/** Games the user currently intends to play (independent of follow). */
export type RosterGame = {
  threadId: number
  title: string
  creator: string
  version: string
  coverUrl: string | null
  rating: number
  likes: number
  views: number
  updatedAt: string
  timestamp: number
  threadUrl: string
  prefixes: number[]
  tags: number[]
  screens: string[]
  engine?: string
  addedAt: number
}

export type ImportResult = {
  source: Exclude<SubscriptionSource, 'manual'>
  found: number
  added: number
  alreadyFollowed: number
}

export type GameSummary = {
  threadId: number
  title: string
  creator: string
  version: string
  coverUrl: string | null
  rating: number
  likes?: number
  views?: number
  threadUrl: string
  updatedAt?: string
  timestamp?: number
  prefixes?: number[]
  tags?: number[]
  engine?: string
  screens?: string[]
  rarity?: GameRarity
  lastPlayedVersion?: string
  lastPlayedAt?: number
  playtimeMs?: number
  playedVersions?: VersionPlayStat[]
  checkedAt?: number
  archived?: boolean
}

export type FollowSyncStatus = {
  running: boolean
  lastRunAt: number | null
  lastError: string | null
  checked: number
  updated: number
  pending: number
  cancelled: boolean
}

export type ThreadField = {
  label: string
  value: string
}

export type ThreadLink = {
  label: string
  url: string
}

export type RelatedGame = {
  threadId: number
  title: string
  url: string
}

/** OS keys shared by F95 downloads UI and P2P metadata votes. */
export type OsKind =
  | 'win'
  | 'linux'
  | 'mac'
  | 'android'
  | 'ios'
  | 'web'
  | 'html'
  | 'joiplay'

/** @deprecated Prefer OsKind — same values. */
export type DownloadSystem = OsKind

export const OS_KIND_IDS = {
  win: 0,
  linux: 1,
  mac: 2,
  android: 3,
  ios: 4,
  web: 5,
  html: 6,
  joiplay: 7
} as const satisfies Record<OsKind, number>

export type OsKindId = (typeof OS_KIND_IDS)[OsKind]

export const OS_KIND_BY_ID: Record<OsKindId, OsKind> = {
  0: 'win',
  1: 'linux',
  2: 'mac',
  3: 'android',
  4: 'ios',
  5: 'web',
  6: 'html',
  7: 'joiplay'
}

export const OS_KIND_LABELS: Record<OsKind, string> = {
  win: 'Windows',
  linux: 'Linux',
  mac: 'Mac',
  android: 'Android',
  ios: 'iOS',
  web: 'Web',
  html: 'HTML',
  joiplay: 'JoiPlay'
}

export function osKindFromNavigator(platform: string, userAgent = ''): OsKind | null {
  const hay = `${platform} ${userAgent}`
  if (/Android/i.test(hay)) return 'android'
  if (/Win/i.test(platform) || /Windows/i.test(userAgent)) return 'win'
  if (/Mac/i.test(platform) || /Mac OS|Macintosh/i.test(userAgent)) return 'mac'
  if (/Linux/i.test(hay)) return 'linux'
  return null
}

export function downloadMatchesHostOs(systems: OsKind[], host: OsKind | null): boolean {
  if (!host || !systems.length) return false
  return systems.includes(host)
}

export function downloadHostPreference(systems: OsKind[], host: OsKind | null): number {
  if (!host) return 0
  if (systems.includes(host)) return 3
  if (systems.includes('web') || systems.includes('html')) return 2
  if (!systems.length) return 1
  return 0
}

/** Content kind keys shared by F95 downloads UI and P2P metadata votes. */
export type ContentKind =
  | 'other'
  | 'game'
  | 'update'
  | 'patch'
  | 'uncensor'
  | 'mod'
  | 'translation'
  | 'walkthrough'
  | 'cheat'
  | 'crack'
  | 'save'
  | 'dlc'
  | 'extra'

/** @deprecated Prefer ContentKind — same values. */
export type DownloadContentType = ContentKind

export const CONTENT_KIND_IDS = {
  other: 0,
  game: 1,
  update: 2,
  patch: 3,
  uncensor: 4,
  mod: 5,
  translation: 6,
  walkthrough: 7,
  cheat: 8,
  crack: 9,
  save: 10,
  dlc: 11,
  extra: 12
} as const satisfies Record<ContentKind, number>

export type ContentKindId = (typeof CONTENT_KIND_IDS)[ContentKind]

export const CONTENT_KIND_BY_ID: Record<ContentKindId, ContentKind> = {
  0: 'other',
  1: 'game',
  2: 'update',
  3: 'patch',
  4: 'uncensor',
  5: 'mod',
  6: 'translation',
  7: 'walkthrough',
  8: 'cheat',
  9: 'crack',
  10: 'save',
  11: 'dlc',
  12: 'extra'
}

export const CONTENT_KIND_LABELS: Record<ContentKind, string> = {
  other: 'Other',
  game: 'Game',
  update: 'Update',
  patch: 'Patch',
  uncensor: 'Uncensor patch',
  mod: 'Mod',
  translation: 'Translation',
  walkthrough: 'Walkthrough',
  cheat: 'Cheat',
  crack: 'Crack',
  save: 'Save',
  dlc: 'DLC',
  extra: 'Extra'
}

/**
 * Display order for file-library sections. "Other" is last; untagged legacy rows map to Game.
 */
export const LIBRARY_FILE_SECTION_ORDER: ContentKind[] = [
  'game',
  'update',
  'patch',
  'uncensor',
  'mod',
  'translation',
  'walkthrough',
  'cheat',
  'crack',
  'save',
  'dlc',
  'extra',
  'other'
]

/**
 * Full game packages are installable. Untagged legacy library rows stay installable.
 * Mods / patches / extras / etc. are kept in the library but not extracted as installs.
 */
export function isInstallableLibraryPackage(tags?: PackageTagHint | null): boolean {
  if (!tags || !Number.isFinite(tags.contentKind)) return true
  return tags.contentKind === CONTENT_KIND_IDS.game
}

/** Ren'Py uncensor overlays that can be applied into an installed game `/game` folder. */
export function isRenpyUncensorPackage(tags?: PackageTagHint | null): boolean {
  return Boolean(tags && tags.contentKind === CONTENT_KIND_IDS.uncensor)
}

/** Whether an installed game already has this uncensor patch applied (by hash or library id). */
export function gameHasInstalledPatch(
  game: { installedPatches?: InstalledPatchRef[] | null },
  patch: { id: string; hash: string }
): boolean {
  const list = game.installedPatches
  if (!list?.length) return false
  return list.some((item) => item.patchId === patch.id || (patch.hash && item.hash === patch.hash))
}

/** Max length for version strings sent to / accepted by the metadata API. */
export const VERSION_NAME_MAX_LEN = 64

/** Extra / other packages are not tied to an OS. */
export function contentKindAllowsOs(contentKind: number): boolean {
  return contentKind !== CONTENT_KIND_IDS.other && contentKind !== CONTENT_KIND_IDS.extra
}

/** Extra / other packages are not tied to a game version. */
export function contentKindAllowsVersion(contentKind: number): boolean {
  return contentKind !== CONTENT_KIND_IDS.other && contentKind !== CONTENT_KIND_IDS.extra
}

/** OS is required whenever the content kind allows it. */
export function contentKindRequiresOs(contentKind: number): boolean {
  return contentKindAllowsOs(contentKind)
}

/**
 * Version is optional for patch-like add-ons (any known version may be chosen).
 * Base packages (game, update, …) still require a version when allowed.
 */
export function contentKindRequiresVersion(contentKind: number): boolean {
  if (!contentKindAllowsVersion(contentKind)) return false
  switch (contentKind) {
    case CONTENT_KIND_IDS.patch:
    case CONTENT_KIND_IDS.uncensor:
    case CONTENT_KIND_IDS.mod:
    case CONTENT_KIND_IDS.cheat:
    case CONTENT_KIND_IDS.crack:
      return false
    default:
      return true
  }
}

export type DownloadSectionKind =
  | 'current'
  | 'split'
  | 'archive'
  | 'edition'
  | 'patches'
  | 'extras'
  | 'other'

export type DownloadMirror = {
  label: string
  url: string
}

export type DownloadPart = {
  index: number
  total: number | null
  label: string
  mirrors: DownloadMirror[]
}

export type DownloadEntry = {
  contentType: ContentKind
  systems: OsKind[]
  variants: string[]
  version: string | null
  title: string | null
  unofficial: boolean
  mirrors: DownloadMirror[]
  parts: DownloadPart[]
}

export type DownloadSection = {
  title: string | null
  kind: DownloadSectionKind
  sections: DownloadSection[]
  entries: DownloadEntry[]
}

export type ThreadReview = {
  author: string
  rating: number
  date: string
  html: string
}

export type ThreadReviewsPage = {
  threadId: number
  page: number
  totalPages: number
  total: number
  reviews: ThreadReview[]
}

export type ChangelogEntry = {
  version: string
  text: string
}

export type NoteSection = {
  title: string
  html: string
}

/** A thread hidden via F95zone's Ignore Content list. */
export type IgnoredThread = {
  threadId: number
  title: string
  threadUrl: string
  /** Confirmation-page link from the ignored list, when present. */
  unignoreHref: string | null
}

export type ThreadDetails = {
  threadId: number
  threadUrl: string
  title: string
  creator: string
  version: string
  coverUrl: string | null
  tags: string[]
  fields: ThreadField[]
  creatorLinks: ThreadLink[]
  relatedGames: RelatedGame[]
  releaseDate: string
  updatedAt: string
  descriptionHtml: string
  notes: NoteSection[]
  changelog: ChangelogEntry[]
  gallery: string[]
  downloads: DownloadSection[]
  reviews: ThreadReview[]
  reviewsTotal: number
  reviewsTotalPages: number
  engine: string
  likes: number
  views: number
  /** True when this account has ignored the thread on F95zone. */
  ignored: boolean
}
