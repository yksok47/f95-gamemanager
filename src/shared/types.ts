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
export type GameRarity = 'regular' | 'rare' | 'epic' | 'legendary'
export type TagTier = 'bronze' | 'silver' | 'gold'

export const GAME_RARITIES: GameRarity[] = ['regular', 'rare', 'epic', 'legendary']
export const TAG_TIERS: TagTier[] = ['gold', 'silver', 'bronze']
/** Max ranked tags allowed in one gold/silver/bronze group. */
export const TAGS_PER_TIER_LIMIT = 10
/** F95 only honors this many include or exclude tags per request. */
export const TAG_QUERY_LIMIT = 10

export const RARITY_RANK: Record<GameRarity, number> = {
  regular: 0,
  rare: 1,
  epic: 2,
  legendary: 3
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
  /** OFF by default. When on, seed all local packages via WebTorrent (main). */
  p2pEnabled: boolean
  /** Metadata REST base (no trailing slash needed). Default http://localhost:8080 */
  metadataBaseUrl: string
  /** WebSocket tracker (ws:// or wss://). Peer list + ICE signaling. */
  trackerWebRtcUrl: string
  /** P2P upload cap in KB/s. 0 = unlimited. */
  p2pUploadLimitKBps: number
}

export type DownloadStatus = 'progressing' | 'paused' | 'completed' | 'cancelled' | 'interrupted'

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
  gameThreadId?: number
  gameTitle?: string
  gameVersion?: string
  hash?: string
  libraryStatus?: 'hashing' | 'indexed' | 'error'
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
  /** Folder name under %APPDATA%/RenPy, or null when saves live in game/saves. */
  renpySaveDirectory?: string | null
  screens?: string[]
}

export type PlaySessionStatus = {
  fileId: string
  threadId: number
  pid: number
  startedAt: number
  elapsedMs: number
}

export type UnRenAction = 'extract' | 'decompile'

export type RenpyToolId = 'console' | 'quick' | 'skip' | 'rollback' | 'transitions' | 'after-choices'

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

export type RenpyInfo = {
  fileId: string
  gameRoot: string | null
  saveDirectory: string | null
  savePath: string | null
  savePathExists: boolean
  saveFolderBytes: number
  optionsFound: boolean
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
  checkedAt: number
  screens: string[]
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
  checkedAt?: number
}

export type FollowSyncStatus = {
  running: boolean
  lastRunAt: number | null
  lastError: string | null
  checked: number
  updated: number
  pending: number
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

export type ThreadDownloadLink = {
  label: string
  url: string
}

export type ThreadDownloadGroup = {
  title: string
  links: ThreadDownloadLink[]
}

export type ThreadReview = {
  author: string
  rating: number
  date: string
  body: string
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
  html: string
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
  changelog: ChangelogEntry[]
  gallery: string[]
  downloads: ThreadDownloadGroup[]
  reviews: ThreadReview[]
  reviewsTotal: number
  reviewsTotalPages: number
  engine: string
  likes: number
  views: number
}
